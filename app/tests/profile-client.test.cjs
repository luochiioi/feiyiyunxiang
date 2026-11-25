const test = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')
const { fixture, alice, input } = require('./helpers/profile-fixture.cjs')

function accountFixture() {
  const accountA = { uid: 'A', token: 'old-token', expiresAt: Date.now() + 60000 }
  const accountB = { uid: 'B', token: 'new-token', expiresAt: Date.now() + 60000 }
  const storage = new Map([['fy-session', JSON.stringify(accountA)]])
  const calls = [], toasts = []
  let complete, fail
  const uni = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key), showToast: ({ title }) => toasts.push(title),
    login: ({ success }) => success({ code: 'B-code' })
  }
  const apiScript = clientScript('features/api.uts', { uni, setTimeout, clearTimeout, uniCloud: {
    callFunction: request => {
      calls.push(request)
      if (request.data.action === 'logout') return new Promise((resolve, reject) => { complete = resolve; fail = reject })
      return Promise.resolve({ result: { code: 'OK', data: request.data.action === 'wxLogin' ? accountB : { claimed: true } } })
    }
  } })
  const myProfile = { value: { nickname: 'A profile' } }
  const myPendingProfile = { value: { nickname: 'A pending' } }
  const activeRun = { value: { runId: 'A run' } }
  const page = clientScript('packages/profile/account/account.uvue', {
    uni, session: apiScript.run('session'), api: apiScript.run('api'), secured: apiScript.run('secured'),
    clearSession: () => { apiScript.run('clearSession()'); page.change() },
    login: async () => { await apiScript.run('login()'); page.change() },
    revokeSession: token => apiScript.run('revokeSession')(token),
    showError: () => apiScript.run('showError()'),
    activeRun, myProfile, myPendingProfile,
    forgetMyProfile: () => { myProfile.value = null; myPendingProfile.value = null },
    refreshMyProfile: async () => { myProfile.value = { nickname: 'B profile' } },
    refreshReviewNotices: async () => {}, refreshNotificationsSummary: async () => {}
  })
  page.run('role.value = { claimed: true }; owner.value = "A"')
  return {
    page, storage, calls, toasts, myProfile, myPendingProfile, activeRun,
    finish(outcome) {
      if (outcome === 'network' || outcome === 'timeout') fail(Error(outcome))
      else complete({ result: { code: outcome, data: {} } })
    }
  }
}

for (const outcome of ['OK', 'SERVICE_UNAVAILABLE', 'network', 'timeout']) {
  test(`logout clears local account immediately while the remote result is ${outcome}`, async () => {
    const f = accountFixture()
    const pending = f.page.run('signOut()')
    try {
      assert.equal(f.storage.has('fy-session'), false)
      assert.equal(f.myProfile.value, null)
      assert.equal(f.myPendingProfile.value, null)
      assert.equal(f.activeRun.value, null)
      assert.equal(f.page.run('role.value'), null)
      assert.equal(f.page.run('busy.value'), false)
      assert.equal(f.calls.length, 1)
      assert.equal(f.calls[0].data.token, 'old-token')
      assert.equal(f.calls[0].data.action, 'logout')
      assert.ok(f.calls[0].timeout <= 10000)
    } finally { f.finish(outcome); await pending }
    assert.equal(f.page.run('session.value'), null)
    assert.equal(f.storage.has('fy-session'), false)
    assert.deepEqual(f.toasts, outcome === 'OK' ? [] : ['已退出本机，暂未确认服务器会话撤销'])
  })
}

for (const outcome of ['OK', 'AUTH_REQUIRED', 'network']) {
  test(`a late logout result ${outcome} leaves the next login intact`, async () => {
    const f = accountFixture()
    const pending = f.page.run('signOut()')
    try {
      await f.page.run('signIn()')
      assert.equal(JSON.parse(f.storage.get('fy-session')).token, 'new-token')
    } finally { f.finish(outcome); await pending }
    assert.equal(f.myProfile.value.nickname, 'B profile')
    assert.equal(f.page.run('session.value.uid'), 'B')
    assert.equal(f.page.run('aomiao.value.claimed'), true)
    assert.equal(f.page.run('busy.value'), false)
    assert.deepEqual(f.toasts, ['微信登录成功'])
  })
}

test('confirmed pending profile is immediately visible to its owner and clears on authoritative read or account switch', async () => {
  const approved = { nickname: '公开昵称', pending: null }
  const session = { value: { uid: 'A', expiresAt: Date.now() + 3600000 } }
  const script = clientScript('features/profile/profile.uts', { session, api: async () => approved })
  await script.run('refreshMyProfile()')
  script.run('rememberPendingProfile("A", { revisionId: "pending", nickname: "本人预览", status: "pending" })')
  assert.equal(script.run('myPendingProfile.value.nickname'), '本人预览')
  assert.equal(script.run('myProfile.value.nickname'), '公开昵称')
  await script.run('refreshMyProfile()')
  assert.equal(script.run('myPendingProfile.value'), null)
  script.run('rememberPendingProfile("A", { revisionId: "second", status: "pending" })')
  session.value = { uid: 'B' }
  script.change()
  assert.equal(script.run('myPendingProfile.value'), null)
  script.run('rememberPendingProfile("A", { revisionId: "late", status: "pending" })')
  assert.equal(script.run('myPendingProfile.value'), null)
})

test('profile error copy distinguishes the failed stage and missing server configuration', () => {
  const script = clientScript('features/profile/profile.uts', { session: { value: null } })
  assert.match(script.run('profileError(new Error("SERVICE_UNAVAILABLE"), "avatar")'), /头像.*草稿/)
  assert.match(script.run('profileError(new Error("CONFIG_REQUIRED"), "avatar")'), /头像服务.*配置/)
  assert.match(script.run('profileError(new Error("PROFILE_STORAGE_UNAVAILABLE"), "submit")'), /资料存储.*配置/)
  assert.match(script.run('profileError(new Error("SERVICE_UNAVAILABLE"), "submit")'), /提交审核.*草稿/)
})

test('public avatar requires the exact approved version and rechecks status after media reads', async () => {
  const { service, rows, media } = await fixture()
  const staged = await service.profileStageAvatar(alice, { requestId: 'photo', base64: 'picture' })
  const revision = await service.profileSubmit(alice, { ...input, avatarUploadId: staged.uploadId })
  const read = { code: 'ALICE234', avatarVersion: revision.revisionId }
  await assert.rejects(service.profileAvatar(null, read), /NOT_FOUND/)
  await service.profileReview({ uid: 'reviewer', reviewer: true }, { ...revision, decision: 'approve' })
  assert.match((await service.profileAvatar(null, read)).src, /^data:image\/png/)
  await assert.rejects(service.profileAvatar(null, { ...read, avatarVersion: 'wrong' }), /NOT_FOUND/)
  const original = media.read
  media.read = async value => {
    rows.set('uni-id-users/alice', { status: 1 })
    return original(value)
  }
  await assert.rejects(service.profileAvatar(null, read), /NOT_FOUND/)
  media.read = original
  rows.set('uni-id-users/alice', { status: 0 })
  assert.match((await service.profileAvatar(null, read)).src, /^data:image\/png/)
})

test('profile state keeps an uncertain request through same-account renewal and drops it across accounts', async () => {
  const session = { value: { uid: 'A', expiresAt: Date.now() + 100000 } }
  let delayed
  let fail = true
  let sequence = 0
  const sent = []
  const script = clientScript('features/profile/profile.uts', {
    session, login: async () => {},
    requestId: () => 'id' + ++sequence,
    api(action, payload) {
      if (action === 'getMyProfile') return new Promise(resolve => { delayed = resolve })
      sent.push(payload.requestId)
      if (fail) return Promise.reject(Error('LOST'))
      return Promise.resolve({ revisionId: 'saved', status: 'pending' })
    }
  })
  script.change()
  const pending = script.run('refreshMyProfile()')
  await assert.rejects(script.run('submitMyProfile({ nickname: "甲乙", baseRevision: 0 })'), /LOST/)
  const a = session.value
  session.value = null
  script.change()
  session.value = a
  script.change()
  fail = false
  await script.run('submitMyProfile({ nickname: "甲乙", baseRevision: 0 })')
  assert.deepEqual(sent, ['id1', 'id1'])
  session.value = { ...a, uid: 'B' }
  script.change()
  delayed({ nickname: 'A资料' })
  await pending
  assert.equal(script.run('myProfile.value'), null)
  await script.run('submitMyProfile({ nickname: "甲乙", baseRevision: 0 })')
  assert.equal(sent[2], 'id2')
})

test('avatar loader deduplicates, bounds concurrency, and evicts old previews', async () => {
  let active = 0, peak = 0, calls = 0
  const script = clientScript('features/profile/profile-avatar.uts', {
    requestId: () => 'preview', uni: {},
    publicRead: async () => {
      calls++
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active--
      return { src: 'data:image/png;base64,eA==' }
    }
  })
  await script.run('Promise.all([loadProfileAvatar("owner", "same"), loadProfileAvatar("owner", "same")])')
  assert.equal(calls, 1)
  await script.run('Promise.all(Array.from({length: 44}, (_, i) => loadProfileAvatar("owner", "v" + i)))')
  assert.equal(peak, 3)
  assert.equal(script.run('cache.size'), 40)
  await script.run('loadProfileAvatar("owner", "same")')
  assert.equal(calls, 46)
})

test('an avatar component discards a delayed response after its identity and version change', async () => {
  const props = { code: 'A', version: 'v1', legacy: '' }
  const reads = new Map()
  const released = []
  const script = clientScript('components/ProfileAvatar.uvue', {
    withDefaults: value => value, defineProps: () => props, onBeforeUnmount() {},
    retainProfileAvatar() {}, invalidateProfileAvatar() {},
    releaseProfileAvatar: key => released.push(key),
    avatarKey: (code, version) => code + '/' + version,
    loadProfileAvatar: code => new Promise(resolve => reads.set(code, resolve))
  })
  const first = script.run('load()')
  Object.assign(props, { code: 'B', version: 'v2' })
  const second = script.run('load()')
  reads.get('B')('new.jpg')
  await second
  reads.get('A')('old.jpg')
  await first
  assert.equal(script.run('source.value'), 'new.jpg')
  assert.deepEqual(released, ['A/v1'])
})
