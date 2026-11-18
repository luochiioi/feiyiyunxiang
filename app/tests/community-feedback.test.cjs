const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')

function script(file, globals) {
  let source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  if (file.endsWith('.uvue')) source = source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
  source = source.replace(/^import .+$/gm, '').replace(/export /g, '')
  const context = vm.createContext({
    ref: value => ({ value }),
    computed: read => ({ get value() { return read() } }),
    watch() {}, onUnmounted() {},
    ...globals
  })
  vm.runInContext(stripTypeScriptTypes(source), context)
  return expression => vm.runInContext(expression, context)
}

test('review gallery automatically fetches nine ordered thumbnails, limits concurrency and retries only the failed image', async () => {
  let active = 0, max = 0, failed = false
  const calls = [], previews = []
  const read = script('../admin/pages/index/ReviewGallery.uvue', {
    defineProps: () => ({ postId: 'post', revisionId: 'selected', imageCount: 9 }),
    api: async (_, payload) => {
      calls.push(payload)
      max = Math.max(max, ++active)
      await new Promise(resolve => setImmediate(resolve))
      active--
      if (payload.index === 4 && !failed) { failed = true; throw new Error('NETWORK') }
      return { src: 'image-' + payload.index }
    },
    uni: { previewImage: value => previews.push(value) }
  })
  await read('loadGallery()')
  assert.equal(calls.length, 9)
  assert.equal(max, 3)
  assert.equal(read('photos.value[4].status'), 'failed')
  await read('loadPhoto(photos.value[4])')
  assert.equal(calls.length, 10)
  assert.equal(calls.at(-1).index, 4)
  assert.deepEqual(Array.from(read('photos.value.map(p => p.src)')), Array.from({ length: 9 }, (_, i) => 'image-' + i))
  read('preview(photos.value[8])')
  assert.equal(previews[0].current, 'image-8')
  assert.equal(previews[0].urls.length, 9)
})

test('switching review records discards in-flight thumbnails from the preceding version', async () => {
  const deferred = []
  const props = { postId: 'old-post', revisionId: 'old-version', imageCount: 3 }
  const read = script('../admin/pages/index/ReviewGallery.uvue', {
    defineProps: () => props,
    api: async (_, payload) => {
      if (payload.revisionId === 'old-version') return new Promise(resolve => deferred.push(() => resolve({ src: 'old-private' })))
      return { src: 'new-' + payload.index }
    }
  })
  const old = read('loadGallery()')
  props.postId = 'new-post'; props.revisionId = 'new-version'
  await read('loadGallery()')
  deferred.forEach(resolve => resolve())
  await old
  assert.deepEqual(Array.from(read('photos.value.map(p => p.src)')), ['new-0', 'new-1', 'new-2'])
})

test('review red dot clears only after a successful read and ignores responses from a preceding account', async () => {
  const session = { value: { uid: 'A' } }
  let fail = false, deferred = null, count = 1
  const read = script('features/community/review-notices.uts', {
    session,
    secured: async action => {
      if (action === 'communityReadReview') {
        if (fail) throw new Error('NETWORK')
        count = 0; return {}
      }
      if (session.value?.uid === 'A' && deferred !== null) return new Promise(resolve => { deferred = resolve })
      return { unread: count }
    }
  })
  read('globalThis.api = secured')
  await read('refreshReviewNotices()')
  assert.equal(read('hasUnreadReview.value'), true)
  fail = true
  await assert.rejects(read("readReview('post', 'rejected')"), /NETWORK/)
  assert.equal(read('hasUnreadReview.value'), true)
  fail = false
  await read("readReview('post', 'rejected')")
  assert.equal(read('hasUnreadReview.value'), false)
  count = 1; deferred = true
  const old = read('refreshReviewNotices()')
  session.value = { uid: 'B' }; count = 0
  await read('refreshReviewNotices()')
  deferred({ unread: 9 }); await old
  assert.equal(read('hasUnreadReview.value'), false)
  session.value = null
  await read('refreshReviewNotices()')
  assert.equal(read('hasUnreadReview.value'), false)
})


test('expired sessions renew before fetching rejection notices', async () => {
  const session = { value: { uid: 'A', expiresAt: 1 } }
  let renewals = 0
  const read = script('features/community/review-notices.uts', {
    session,
    api: async () => { throw new Error('AUTH_REQUIRED') },
    secured: async action => {
      assert.equal(action, 'communityReviewNotices')
      if (session.value.expiresAt < Date.now()) {
        renewals++
        session.value = { uid: 'A', expiresAt: Date.now() + 100000 }
      }
      return { unread: 1 }
    }
  })
  await read('refreshReviewNotices()')
  assert.equal(renewals, 1)
  assert.equal(read('hasUnreadReview.value'), true)
})


test('My page conditions remain safe while the account and Aomiao cloud state are absent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../packages/profile/account/account.uvue'), 'utf8')
  const template = source.split('<script')[0]
  // The mini-program compiler emits some else-if predicates outside their preceding null guard.
  const conditions = [...template.matchAll(/v-(?:if|else-if)="([^"]+)"/g)].map(match => match[1])
  for (const session of [null, { uid: 'returning-member' }]) {
    for (const aomiao of [null, { claimed: false }, { claimed: true }]) {
      for (const expression of conditions) {
        const evaluate = new Function('session', 'aomiao', 'roleError', 'hasUnreadReview', 'return (' + expression + ')')
        assert.doesNotThrow(() => evaluate(session, aomiao, '', false), expression)
      }
    }
  }
})
