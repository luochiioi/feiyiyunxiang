const test = require('node:test')
const assert = require('node:assert/strict')
const { transactionFixture } = require('./helpers/transaction-fixture.cjs')
const { createProfileService } = require('../uniCloud-alipay/cloudfunctions/fy-api/profile-service')

async function fixture() {
  const db = transactionFixture()
  let at = 1700000000000
  let stores = 0
  for (const [uid, code] of [['alice', 'ALICE234'], ['bob', 'BOBBB234']]) {
    db.rows.set('uni-id-users/' + uid, { status: 0 })
    db.rows.set('fy-profiles/legacy-' + uid, { uid, code, nickname: '旧昵称' })
  }
  const service = createProfileService({ repo: db.repo, now: () => at, media: {
    async fromUpload(value) {
      if (value === 'bad') throw Error('INVALID_IMAGE')
      return { bytes: Buffer.from(value), mime: 'image/png' }
    },
    async store() { return { fileID: 'private-' + ++stores, mime: 'image/png' } },
    async discard() {},
    async read() { return { src: 'data:image/png;base64,YQ==' } }
  } })
  return { ...db, service, advance: n => { at += n }, stores: () => stores }
}

const alice = { uid: 'alice' }, bob = { uid: 'bob' }
const input = { requestId: 'request-1', baseRevision: 0, nickname: '新昵称' }

test('legacy profile keeps its code and physical key, validates Unicode and ignores caller uid', async () => {
  const { service, rows } = await fixture()
  const current = await service.getMyProfile(alice, { uid: 'bob' })
  assert.equal(current.code, 'ALICE234')
  assert.equal(current.revision, 0)
  assert.deepEqual(current.interests, [])
  for (const nickname of ['  ', '𠮷', '𠮷'.repeat(21), '小\u0000明']) {
    await assert.rejects(service.profileSubmit(alice, { ...input, nickname }), /INVALID_NICKNAME/)
  }
  const a = await service.profileSubmit(alice, { ...input, uid: 'bob', nickname: '𠮷𠮷' })
  await service.profileSubmit(bob, { ...input, nickname: '𠮷𠮷' })
  assert.equal(rows.get('fy-profiles/legacy-alice').pendingRevisionId, a.revisionId)
  assert.equal((await service.getMyProfile(alice)).nickname, '旧昵称')
  await assert.rejects(service.profileRevision(bob, a), /NOT_FOUND/)
  await assert.rejects(service.getMyProfile({ uid: 'alice', reviewer: true }), /AUTH_REQUIRED/)
})

test('avatar staging is private, idempotent and expiring; bad input performs no write', async () => {
  const { service, advance, stores } = await fixture()
  await assert.rejects(service.profileStageAvatar(alice, { requestId: 'u', base64: 'bad' }), /INVALID_IMAGE/)
  assert.equal(stores(), 0)
  const staged = await service.profileStageAvatar(alice, { requestId: 'u', base64: 'image' })
  assert.deepEqual(Object.keys(staged), ['uploadId'])
  assert.deepEqual(await service.profileStageAvatar(alice, { requestId: 'u', base64: 'image' }), staged)
  assert.equal(stores(), 1)
  await assert.rejects(service.profileStageAvatar(alice, { requestId: 'u', base64: 'different' }), /REQUEST_CONFLICT/)
  await assert.rejects(service.profileSubmit(bob, { ...input, avatarUploadId: staged.uploadId }), /UPLOAD_NOT_AVAILABLE/)
  advance(24 * 3600000)
  await assert.rejects(service.profileSubmit(alice, { ...input, avatarUploadId: staged.uploadId }), /UPLOAD_NOT_AVAILABLE/)
})

test('lost submit response replays and concurrent submissions supersede exactly one pending revision', async () => {
  const { service, loseNextResponse, conflicts } = await fixture()
  loseNextResponse()
  await assert.rejects(service.profileSubmit(alice, input), /RESPONSE_LOST/)
  const a = await service.profileSubmit(alice, input)
  await assert.rejects(service.profileSubmit(alice, { ...input, nickname: '变更' }), /REQUEST_CONFLICT/)
  const revisions = await Promise.all(['second', 'third'].map(requestId => service.profileSubmit(alice, { ...input, requestId })))
  assert.ok(conflicts() > 0)
  assert.equal((await service.profileRevision(alice, a)).status, 'superseded')
  const statuses = await Promise.all(revisions.map(row => service.profileRevision(alice, row)))
  assert.deepEqual(statuses.map(row => row.status).sort(), ['pending', 'superseded'])
})

module.exports = { fixture, alice, bob, input }
