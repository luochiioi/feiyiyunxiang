const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

const source = readFileSync(join(__dirname, '../packages/story/legacy-story.uts'), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import .*\r?\n/gm, ''))
const moduleUrl = 'data:text/javascript,' + encodeURIComponent(script + '\nexport function bind(deps) { ({ api, secured, session, uni } = deps) }\nlet api, secured, session, uni')

const points = ['first', 'second', 'third'].map(id => ({ id }))
const progress = {
  runId: 'run1', routeId: 'macau', version: 'published-v2',
  snapshot: { id: 'macau', region: '澳门', testOnly: true, nodes: points },
  completed: ['second', 'third']
}

test('legacy storm counts verified points from the same Macau test run, including out-of-order check-ins', async () => {
  const { legacyStormAccess } = await import(moduleUrl)
  const access = legacyStormAccess(progress, 'member')
  assert.equal(access.unlocked, true)
  assert.notEqual(access.storageKey, legacyStormAccess(progress, 'other').storageKey)
  assert.notEqual(access.storageKey, legacyStormAccess({ ...progress, version: 'other' }, 'member').storageKey)
  assert.equal(legacyStormAccess({ ...progress, completed: [] }, 'member').unlocked, false)
  assert.equal(legacyStormAccess({ ...progress, completed: ['other-route-point'] }, 'member').unlocked, false)
  assert.equal(legacyStormAccess(null, 'member'), null)
  assert.equal(legacyStormAccess(progress, ''), null)
  for (const changes of [{ testOnly: false }, { region: '湖南' }, { activities: [{ id: 'tile' }] }]) {
    assert.equal(legacyStormAccess({ ...progress, snapshot: { ...progress.snapshot, ...changes } }, 'member'), null)
  }
})

test('directory reads the existing exploration when the device has no active run', async () => {
  const { bind, readLegacyStorm } = await import(moduleUrl)
  const calls = []
  const session = { value: { uid: 'member' } }
  bind({
    session,
    uni: { getStorageSync: () => '' },
    api: async action => { calls.push(action); return [progress.snapshot] },
    secured: async (action, payload) => { calls.push([action, payload]); return progress }
  })
  assert.equal((await readLegacyStorm('', '')).unlocked, true)
  assert.deepEqual(calls, ['catalog', ['routeProgress', { routeId: 'macau' }]])
  assert.equal((await readLegacyStorm('', 'run1')).unlocked, true)
  assert.deepEqual(calls.at(-1), ['progress', { runId: 'run1' }])

  session.value = null
  assert.equal(await readLegacyStorm('', 'run1'), null)
})

test('scripted opening keeps existing guest checkpoints and restores the new branch', () => {
  const source = readFileSync(join(__dirname, '../packages/story/story-content.uts'), 'utf8')
  const script = stripTypeScriptTypes(source.replace(/^export /gm, ''))
  const data = new Map()
  const uni = { getStorageSync: key => data.get(key), removeStorageSync: key => data.delete(key) }
  const { openingReadingKey, savedOpeningPath, openingStorageKey, scriptedOpeningStorageKey, scriptedOpening } =
    new Function('uni', script + '\nreturn { openingReadingKey, savedOpeningPath, openingStorageKey, scriptedOpeningStorageKey, scriptedOpening }')(uni)
  assert.equal(openingReadingKey(), scriptedOpeningStorageKey)
  assert.deepEqual(scriptedOpening.scenes.find(scene => scene.id === 'gallery-choice').choices.map(choice => choice.nextSceneId), ['glass', 'stroll'])
  data.set(openingStorageKey, JSON.stringify(['map', 'choose', 'tile']))
  assert.equal(openingReadingKey(), openingStorageKey)
  assert.deepEqual(savedOpeningPath(), ['map', 'choose', 'tile'])
  data.set(openingStorageKey, JSON.stringify(['map']))
  assert.equal(openingReadingKey(), openingStorageKey)
  assert.deepEqual(savedOpeningPath(), ['map'])
  data.set(scriptedOpeningStorageKey, JSON.stringify(['gallery', 'gallery-choice', 'stroll', 'glass']))
  assert.equal(openingReadingKey(), scriptedOpeningStorageKey)
  assert.deepEqual(savedOpeningPath(), ['gallery', 'gallery-choice', 'stroll', 'glass'])
})
