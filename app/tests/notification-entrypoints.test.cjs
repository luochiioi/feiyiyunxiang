const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { clientScript } = require('./helpers/client-script.cjs')
function home(refresh) {
  let source = fs.readFileSync(path.join(__dirname, '../pages/index/index.uvue'), 'utf8').match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
  source = source.replace(/^import .+$/gm, '').replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  const show = [], hide = [], unload = [], timers = new Map(); let next = 0
  const context = vm.createContext({
    ref: value => ({ value }), shallowRef: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch() {},
    uni: { getWindowInfo: () => ({ statusBarHeight: 20 }) }, mapState: { value: { routeId: null, viewport: {} } },
    findRoute: () => null, listNodes: () => [], findNode: () => null, published: { value: [] }, refreshCatalog: async () => {},
    session: { value: null }, refreshNotificationsSummary: refresh,
    onShow: fn => show.push(fn), onHide: fn => hide.push(fn), onUnload: fn => unload.push(fn),
    setInterval(fn, delay) { assert.equal(delay, 30000); timers.set(++next, fn); return next }, clearInterval: id => timers.delete(id)
  })
  vm.runInContext(stripTypeScriptTypes(source), context)
  return { show: () => Promise.all(show.map(fn => fn())), hide: () => hide.forEach(fn => fn()), unload: () => unload.forEach(fn => fn()), timers }
}
test('home refreshes unread on entry and while visible, with one timer and no hidden requests', async () => {
  let calls = 0
  const h = home(async () => { calls++ })
  await h.show(); await h.show(); assert.equal(calls, 2); assert.equal(h.timers.size, 1)
  const tick = [...h.timers.values()][0]; await tick(); assert.equal(calls, 3)
  h.hide(); assert.equal(h.timers.size, 0); await tick(); assert.equal(calls, 3)
  await h.show(); assert.equal(calls, 4); h.unload(); assert.equal(h.timers.size, 0)
})
test('home does not overlap slow unread refreshes', async () => {
  let release, calls = 0
  const h = home(() => { calls++; return new Promise(resolve => { release = resolve }) })
  await h.show(); await [...h.timers.values()][0](); assert.equal(calls, 1)
  release(); await new Promise(resolve => setImmediate(resolve)); const pending = [...h.timers.values()][0](); assert.equal(calls, 2)
  release(); await pending; h.hide()
})
test('one related-action routes friend requests and exact owner versions, but never unavailable content', () => {
  const urls = [], s = clientScript('packages/profile/message-detail/message-detail.uvue', { session: { value: { uid: 'A' } }, openPage: url => urls.push(url) })
  s.run("detail.value={kind:'friend.request.received',friend:{status:'pending'},target:null};openRelated()")
  assert.equal(urls.pop(), '/packages/partner/partner/partner'); assert.match(s.run('relatedLabel.value'), /处理好友申请/)
  s.run("detail.value={kind:'community.post.removed',target:{postId:'post',revisionId:'revision',preview:true}};openRelated()")
  assert.equal(urls.pop(), '/packages/community/community-post/community-post?postId=post&revisionId=revision')
  s.run("detail.value={kind:'community.comment.approved',target:{postId:'post',revisionId:'revision',preview:false}};openRelated()")
  assert.equal(urls.pop(), '/packages/community/community-post/community-post?postId=post')
  s.run('detail.value.target=null;openRelated()'); assert.equal(urls.length, 0); assert.equal(s.run('canOpenRelated.value'), false)
})
