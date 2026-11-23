const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')

const source = file => readFileSync(join(__dirname, '..', file), 'utf8')

test('My offers direct entries for personal posts and full step history; community stays on the map', () => {
  const account = source('packages/profile/account/account.uvue')
  const map = source('components/exploration/MapSideActions.uvue')
  const community = source('packages/community/community/community.uvue')
  assert.match(account, /openPage\(myPostsPath\)/)
  assert.match(account, /openPage\(stepsPath\)/)
  assert.doesNotMatch(account, />社区<\/text>/)
  assert.match(map, /label: '社区'/)
  assert.doesNotMatch(community, /<StepPanel/)
})

test('direct My Posts opens only the personal feed and does not trigger step sync', async () => {
  const calls = []
  let loadPage, showPage
  const session = { value: { uid: 'member' } }
  const page = clientScript('packages/community/community/community.uvue', {
    onLoad: callback => { loadPage = callback }, onShow: callback => { showPage = callback }, onHide() {},
    session, refreshReviewNotices() {},
    syncWechatSteps: async () => { calls.push(['steps']) },
    secured: async (action, payload) => { calls.push([action, payload?.tab]); return { items: [], next: '' } }
  })
  loadPage({ tab: 'mine' })
  await showPage()
  assert.equal(page.run('mineOnly.value'), true)
  assert.deepEqual(calls, [['communityFeed', 'mine']])
})

test('opening public community offers background sync only while community is visible', async () => {
  let loadPage, showPage, hidePage, canSync
  const calls = []
  clientScript('packages/community/community/community.uvue', {
    onLoad: callback => { loadPage = callback }, onShow: callback => { showPage = callback },
    onHide: callback => { hidePage = callback },
    session: { value: { uid: 'member' } }, refreshReviewNotices() {},
    syncWechatSteps: async (uid, automatic, visible) => { calls.push([uid, automatic]); canSync = visible },
    publicRead: async () => ({ items: [], next: '' })
  })
  loadPage({})
  await showPage()
  assert.deepEqual(calls, [['member', true]])
  assert.equal(canSync(), true)
  hidePage()
  assert.equal(canSync(), false)
})
