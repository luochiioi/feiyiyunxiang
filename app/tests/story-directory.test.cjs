const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

const pageSource = readFileSync(join(__dirname, '../packages/story/story/story.uvue'), 'utf8')
const script = pageSource.split('<script setup lang="uts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
const directory = new Function('ref', 'onLoad', 'onShow', 'decodePageId', 'session', 'api', 'secured',
  'readLegacyStorm', 'legacyStormAccess', 'openCultureActivity', 'openPage', 'openRouteDetail',
  stripTypeScriptTypes(script) + '\nreturn { load, openChapter, chapterFor, chapterGate, hasAction }')

const routeA = { id: 'route-a', chapters: [{ act: 4, activityId: 'tileQuiz', gateText: '新版门槛' }] }
const routeB = { id: 'route-b', cultureUpgrade: true, chapters: [{ act: 3 }, { act: 4 }] }
const otherChapter = { act: 4, routeId: 'route-b', runId: 'other-run', unlocked: true, started: true }

async function openDirectory({ routeId, library, progress = null, catalog = [routeA, routeB] }) {
  const links = []
  const requests = []
  const page = directory(value => ({ value }), onLoad => onLoad({ routeId }), () => {}, value => value,
    { value: { uid: 'member' } }, async () => catalog, async (action, params) => {
      requests.push([action, params])
      return action === 'storyLibrary' ? library : progress
    }, async () => null, () => null,
    (...args) => links.push(['activity', ...args]), url => links.push(['page', url]), id => links.push(['route', id]))
  await page.load()
  return { page, links, requests }
}

test('route story directory uses the old run for a locked task and never borrows another route chapter', async () => {
  const oldChapter = { act: 3, routeId: 'route-a', runId: 'old-run', unlocked: false, nextActivityId: 'tile', gateText: '旧版门槛' }
  const { page, links, requests } = await openDirectory({ routeId: 'route-a', library: [oldChapter, otherChapter] })

  assert.equal(page.chapterGate(3), '旧版门槛')
  assert.equal(page.hasAction(4), false)
  assert.equal(page.chapterGate(4), '')
  page.openChapter(3)
  page.openChapter(4)

  assert.deepEqual(links, [['activity', 'route-a', 'tile', 'old-run']])
  assert.deepEqual(requests, [['storyLibrary', undefined]])
})

test('an exploration without chapters cannot borrow its own newer publication or the combined route', async () => {
  const { page, links, requests } = await openDirectory({
    routeId: 'route-a', library: [otherChapter], progress: { runId: 'old-run' }
  })

  assert.equal(page.hasAction(4), false)
  assert.equal(page.chapterGate(4), '')
  page.openChapter(4)
  assert.deepEqual(links, [])
  assert.deepEqual(requests.at(-1), ['routeProgress', { routeId: 'route-a' }])
})

test('a route without an exploration uses its current published guide', async () => {
  const { page, links } = await openDirectory({ routeId: 'route-a', library: [otherChapter] })

  assert.equal(page.chapterGate(4), '新版门槛')
  page.openChapter(4)
  assert.deepEqual(links, [['activity', 'route-a', 'tileQuiz', null]])
})

test('the general directory still opens unlocked chapters from the combined route', async () => {
  const { page, links } = await openDirectory({ library: [otherChapter] })

  page.openChapter(1)
  page.openChapter(4)
  assert.deepEqual(links, [
    ['page', '/packages/story/reader/reader?act=1'],
    ['page', '/packages/story/reader/reader?act=4&runId=other-run']
  ])
})
