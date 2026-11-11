const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

// Run the actual UTS reducer using its TypeScript-compatible subset.
const source = () => {
  const uts = readFileSync(join(__dirname, '../features/exploration/map-state.uts'), 'utf8')
  const js = stripTypeScriptTypes(uts.replace(/^import type .*\r?\n/m, ''))
  return import('data:text/javascript,' + encodeURIComponent(js))
}

const viewport = { latitude: 28.2, longitude: 113.01, scale: 17 }

test('starts collapsed without a route and ignores a panel toggle', async () => {
  const { initialMapState, reduceMapState } = await source()
  const state = initialMapState()
  assert.equal(state.routeId, null)
  assert.equal(state.panelExpanded, false)
  assert.equal(reduceMapState(state, { type: 'toggle-panel' }), state)
})

test('selecting a node preserves the route and the viewport', async () => {
  const { initialMapState, reduceMapState } = await source()
  const state = reduceMapState(initialMapState(), { type: 'select-route', routeId: 'hun', viewport })
  const next = reduceMapState(state, { type: 'select-node', nodeId: 'museum' })
  assert.equal(next.routeId, 'hun')
  assert.equal(next.selectedNodeId, 'museum')
  assert.deepEqual(next.viewport, viewport)
})

test('returning from a child keeps the gesture viewport, selected marker and panel', async () => {
  const { initialMapState, reduceMapState } = await source()
  const route = reduceMapState(initialMapState(), { type: 'select-route', routeId: 'hun', viewport })
  const selected = reduceMapState(route, { type: 'select-node', nodeId: 'museum' })
  const dragged = { latitude: 28.201, longitude: 113.016, scale: 18 }
  const panned = reduceMapState(selected, { type: 'set-viewport', viewport: dragged })
  const expanded = reduceMapState(panned, { type: 'toggle-panel' })
  assert.deepEqual(expanded, { routeId: 'hun', selectedNodeId: 'museum', viewport: dragged, panelExpanded: true })
})

test('clearing a route removes its selected marker and collapses the panel', async () => {
  const { initialMapState, reduceMapState } = await source()
  const route = reduceMapState(initialMapState(), { type: 'select-route', routeId: 'hun', viewport })
  const state = reduceMapState({ ...route, selectedNodeId: 'museum', panelExpanded: true }, { type: 'clear-route' })
  assert.deepEqual(state, { routeId: null, selectedNodeId: null, viewport, panelExpanded: false })
})

test('reselecting the active route keeps its current view', async () => {
  const { initialMapState, reduceMapState } = await source()
  const selection = { type: 'select-route', routeId: 'hun', viewport }
  const route = reduceMapState(initialMapState(), selection)
  const dragged = { ...viewport, scale: 19 }
  const panned = reduceMapState(route, { type: 'set-viewport', viewport: dragged })
  assert.equal(reduceMapState(panned, selection), panned)
})

test('switching regions clears selection, collapses the panel and recenters', async () => {
  const { initialMapState, reduceMapState } = await source()
  const route = reduceMapState(initialMapState(), { type: 'select-route', routeId: 'macau', viewport })
  const open = { ...route, selectedNodeId: 'macau-museum', panelExpanded: true }
  const hunanViewport = { latitude: 28.21, longitude: 112.99, scale: 16 }
  assert.deepEqual(reduceMapState(open, { type: 'select-route', routeId: 'hun', viewport: hunanViewport }), {
    routeId: 'hun', selectedNodeId: null, viewport: hunanViewport, panelExpanded: false
  })
})

const markerSource = () => {
  const uts = readFileSync(join(__dirname, '../features/exploration/map-markers.uts'), 'utf8')
  const js = stripTypeScriptTypes(uts.replace(/^import type .*\r?\n/m, ''))
  return import('data:text/javascript,' + encodeURIComponent(js))
}

const macauNode = { id: 'macau-museum', markerId: 102, routeId: 'macau', latitude: 22.19689, longitude: 113.54098, checked: false }
const hunanNode = { id: 'hunan-museum', markerId: 201, routeId: 'hunan', latitude: 28.2102, longitude: 112.9904, checked: true }
const nodes = [macauNode, hunanNode]

test('shows available check-in pins before choosing a route, then filters to the chosen route', async () => {
  const { visibleMapNodes } = await markerSource()
  assert.deepEqual(visibleMapNodes(nodes, null), nodes)
  assert.deepEqual(visibleMapNodes(nodes, 'hunan'), [hunanNode])
  assert.deepEqual(visibleMapNodes([], null), [])
})

test('marks an authorized location separately and preserves both check-in icon states', async () => {
  const { buildMapMarkers, locationMarkerId } = await markerSource()
  const pins = buildMapMarkers(nodes, macauNode.id, null)
  assert.equal(pins.length, 2)
  assert.match(pins[0].iconPath, /marker_default_selected\.png$/)
  assert.match(pins[1].iconPath, /marker_checked\.png$/)
  const location = { latitude: 22.1973, longitude: 113.541 }
  const markers = buildMapMarkers(nodes, macauNode.id, location)
  assert.deepEqual(markers.slice(0, 2), pins)
  assert.equal(markers[2].id, locationMarkerId)
  assert.equal(markers[2].latitude, location.latitude)
  assert.equal(markers[2].longitude, location.longitude)
  assert.match(markers[2].iconPath, /position-dot\.png$/)
})

test('resolves both WeChat marker event forms and ignores the location dot', async () => {
  const { resolveNodeId, locationMarkerId } = await markerSource()
  assert.equal(resolveNodeId(nodes, { detail: { markerId: 102 } }), macauNode.id)
  assert.equal(resolveNodeId(nodes, { markerId: 201 }), hunanNode.id)
  assert.equal(resolveNodeId(nodes, { detail: { markerId: locationMarkerId } }), null)
  assert.equal(resolveNodeId(nodes, {}), null)
})
