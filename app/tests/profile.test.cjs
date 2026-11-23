const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, alice, bob, input } = require('./helpers/profile-fixture.cjs')

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

test('submission limits are transactional, and a replay does not consume a slot', async () => {
  const { service, advance } = await fixture()
  const first = await service.profileSubmit(alice, input)
  for (let i = 0; i < 9; i++) await service.profileSubmit(alice, { ...input, requestId: 'more-' + i })
  await assert.rejects(service.profileSubmit(alice, { ...input, requestId: 'limit' }), /RATE_LIMITED/)
  assert.deepEqual(await service.profileSubmit(alice, input), first)
  advance(3600000)
  await service.profileSubmit(alice, { ...input, requestId: 'limit' })
})

test('profile storage missing a collection reports an actionable error without trying an avatar upload', async () => {
  const { repo, service, stores } = await fixture()
  const get = repo.get
  repo.get = (name, id) => {
    if (name === 'fy-profile-uploads') throw Object.assign(Error('Collection does not exist'), { code: 'DATABASE_COLLECTION_NOT_EXIST' })
    return get(name, id)
  }
  const tx = repo.tx
  repo.tx = callback => tx(transaction => callback({
    ...transaction,
    put(name, id, doc) {
      if (name === 'fy-profile-revisions') {
        throw Object.assign(Error('Cannot create namespace development.fy-profile-revisions in multi-document transaction'), { code: 100104 })
      }
      return transaction.put(name, id, doc)
    }
  }))
  await assert.rejects(service.profileStageAvatar(alice, { requestId: 'photo', base64: 'image' }), /PROFILE_STORAGE_UNAVAILABLE/)
  assert.equal(stores(), 0)
  await assert.rejects(service.profileSubmit(alice, input), /PROFILE_STORAGE_UNAVAILABLE/)
  assert.equal((await service.getMyProfile(alice)).pending, null)
})
