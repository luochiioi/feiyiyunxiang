const test = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')

function editor(overrides = {}) {
  const session = { value: { uid: 'A' } }
  const myProfile = { value: { revision: 0, nickname: '原昵称', bio: '', displayCity: '', interests: [], pending: null } }
  const calls = []
  let load, show
  const script = clientScript('packages/profile/profile-edit/profile-edit.uvue', {
    session, myProfile, calls, requestId: () => 'photo-request',
    profileInterests: ['湘绣', '摄影'], profileError: error => error.message,
    onLoad: callback => { load = callback }, onShow: callback => { show = callback }, onBeforeUnmount() {},
    refreshMyProfile: async () => {}, login: async () => { session.value = { uid: 'A' } },
    removeAvatarPreview() {}, saveAvatarPreview: async value => value,
    profileRequest: async (_uid, action) => { calls.push(action); return { revisionId: 'old', nickname: '历史资料', interests: [], status: 'rejected', reason: '请修改' } },
    submitMyProfile: async payload => { calls.push(payload); return { revisionId: 'new' } },
    uni: { chooseImage({ fail, complete }) { fail({ errMsg: 'chooseImage:fail cancel' }); complete() } },
    ...overrides
  })
  return { ...script, session, myProfile, calls, open: (query = {}) => { load(query); return show() } }
}

test('editor validates code points, keeps text on cancelled selection and supports resetting an avatar', async () => {
  const page = editor()
  await page.open()
  page.run('draft.value.nickname = "𠮷".repeat(21)')
  await page.run('save()')
  assert.match(page.run('message.value'), /INVALID_NICKNAME/)
  page.run('draft.value.nickname = "旅人"; choosePhoto(); resetPhoto()')
  assert.equal(page.run('draft.value.nickname'), '旅人')
  await page.run('save()')
  assert.equal(page.calls[0].resetAvatar, true)
})

test('historical results require explicit editing and switched accounts clear draft and result', async () => {
  const page = editor()
  await page.open({ revisionId: 'old' })
  assert.equal(page.run('historyView.value.nickname'), '历史资料')
  await page.run('save()')
  assert.deepEqual(page.calls, ['profileRevision'])
  page.run('editHistory()')
  assert.equal(page.run('draft.value.nickname'), '历史资料')
  page.session.value = { uid: 'B' }
  page.change()
  assert.equal(page.run('draft.value'), null)
  assert.equal(page.run('historyView.value'), null)
})

test('after a confirmed submit, a failed refresh can only retry the read', async () => {
  let refreshes = 0
  const page = editor({ refreshMyProfile: async () => { if (++refreshes === 2) throw Error('network') } })
  await page.open()
  await page.run('save()')
  await page.run('save()')
  assert.equal(page.calls.length, 1)
  assert.equal(page.run('saved.value'), true)
  await page.run('refresh()')
  assert.equal(refreshes, 3)
})
