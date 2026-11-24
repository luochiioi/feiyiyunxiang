const { test } = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')

function fixture() {
  const calls = [], deleted = []
  const session = { value: { uid: 'member-a' } }
  let request = async () => ({ src: 'photo-' + calls.length })
  const script = clientScript('features/community/post-photo-cache.uts', {
    session,
    schedulePhoto: callback => callback(),
    publicRead: async (action, payload) => {
      calls.push({ action, ...payload })
      return request()
    },
    savePreview: async src => src,
    removePreview: src => { if (src) deleted.push(src) }
  })
  return { script, session, calls, deleted, respond: callback => { request = callback } }
}

test('public photos are reused across gallery mounts and concurrent reads', async () => {
  const { script, calls, deleted } = fixture()
  script.run("const list = retainPostPhoto('post', 'one', 0); const details = retainPostPhoto('post', 'one', 0)")
  assert.deepEqual(Array.from(await script.run('Promise.all([loadPostPhoto(list), loadPostPhoto(details)])')), ['photo-1', 'photo-1'])
  script.run('releasePostPhoto(list); releasePostPhoto(details)')
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'one', 0))"), 'photo-1')
  assert.deepEqual(calls, [{ action: 'communityImage', postId: 'post', revisionId: 'one', preview: false, index: 0 }])
  assert.deepEqual(deleted, [])
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'two', 0))"), 'photo-2')
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'two', 1))"), 'photo-3')
})

test('expiring and invalidating photos preserve paths still in use and permit a fresh read', async () => {
  const { script, deleted } = fixture()
  await script.run("const active = retainPostPhoto('post', 'one', 0); loadPostPhoto(active)")
  const fresh = await script.run("active.expiresAt = 1; const replacement = retainPostPhoto('post', 'one', 0); loadPostPhoto(replacement)")
  assert.equal(fresh, 'photo-2')
  assert.deepEqual(deleted, [])
  script.run('releasePostPhoto(active); invalidatePostPhoto(replacement); releasePostPhoto(replacement)')
  assert.deepEqual(deleted, ['photo-1', 'photo-2'])
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'one', 0))"), 'photo-3')
})

test('cache eviction keeps a photo until its last gallery releases it', async () => {
  const { script, deleted } = fixture()
  await script.run("const pinned = retainPostPhoto('post', 'one', 0); loadPostPhoto(pinned)")
  for (let index = 1; index <= 27; index++) {
    await script.run(`(async () => {
      const photo = retainPostPhoto('post', 'one', ${index})
      await loadPostPhoto(photo)
      releasePostPhoto(photo)
    })()`)
  }
  assert.equal(script.run('cache.size'), 27)
  assert.deepEqual(deleted, [])
  script.run('releasePostPhoto(pinned)')
  assert.deepEqual(deleted, ['photo-1'])
})

test('account switches discard cached paths and do not save photographs from older requests', async () => {
  const { script, session, respond, deleted } = fixture()
  await script.run("const cached = retainPostPhoto('post', 'one', 0); loadPostPhoto(cached)")
  let finish
  respond(() => new Promise(resolve => { finish = resolve }))
  const pending = script.run("const old = retainPostPhoto('post', 'one', 1); loadPostPhoto(old)")
  const rejected = assert.rejects(pending, /ACCOUNT_CHANGED/)
  session.value = { uid: 'member-b' }
  script.change()
  finish({ src: 'old-account-photo' })
  await rejected
  assert.deepEqual(deleted, ['photo-1'])
  respond(async () => ({ src: 'new-account-photo' }))
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'one', 0))"), 'new-account-photo')
})

test('an unused queued read and a failed fetch leave the photo eligible for retry', async () => {
  const { script, calls, respond } = fixture()
  script.run("const left = retainPostPhoto('post', 'one', 0); releasePostPhoto(left)")
  await assert.rejects(script.run('loadPostPhoto(left)'), /PHOTO_UNUSED/)
  assert.equal(calls.length, 0)
  respond(async () => { throw Error('NETWORK') })
  await assert.rejects(script.run("loadPostPhoto(retainPostPhoto('post', 'one', 0))"), /NETWORK/)
  respond(async () => ({ src: 'recovered' }))
  assert.equal(await script.run("loadPostPhoto(retainPostPhoto('post', 'one', 0))"), 'recovered')
})
