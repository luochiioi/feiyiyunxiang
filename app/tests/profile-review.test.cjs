const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, alice, bob, input } = require('./helpers/profile-fixture.cjs')
const { createProfileService } = require('../uniCloud-alipay/cloudfunctions/fy-api/profile-service')
const { createCommunityMedia } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-media')
const admin = { uid: 'admin', admin: true }, reviewer = { uid: 'reviewer', reviewer: true }

test('profile review authorization, stale candidates, suspension and restoration', async () => {
  const { service, rows } = await fixture()
  const old = await service.profileSubmit(alice, input)
  const latest = await service.profileSubmit(alice, { ...input, requestId: 'newer' })
  const approve = { ...latest, decision: 'approve' }
  await assert.rejects(service.profileReview(null, approve), /FORBIDDEN/)
  await assert.rejects(service.profileReview(bob, approve), /FORBIDDEN/)
  await assert.rejects(service.profileReview(reviewer, { ...old, decision: 'approve' }), /STALE_VERSION/)
  await assert.rejects(service.profileReview(reviewer, { ...latest, decision: 'reject', reason: ' ' }), /INVALID_REASON/)
  rows.set('uni-id-users/alice', { status: 1, token: ['legacy'] })
  await assert.rejects(service.profileReview(reviewer, approve), /ACCOUNT_DISABLED/)
  rows.set('uni-id-users/alice', { status: 0, token: ['legacy'] })
  await service.profileReview(reviewer, approve)
  assert.deepEqual(rows.get('uni-id-users/alice'), { status: 0, token: ['legacy'] })
  assert.equal((await service.getMyProfile(alice)).code, 'ALICE234')
  assert.equal((await service.getMyProfile(alice)).revision, 1)
})

test('review, history audit and notification commit together; competing decisions cannot both win', async () => {
  const { service, rows, failNextNotification, loseNextResponse } = await fixture()
  const candidate = await service.profileSubmit(alice, input)
  const approve = { ...candidate, decision: 'approve' }
  const reject = { ...candidate, decision: 'reject', reason: '请改用自己的照片' }
  const [item] = (await service.profileReviewList(reviewer, {})).items
  assert.equal(item.revisionId, candidate.revisionId)
  assert.equal((await service.profileReviewDetail(reviewer, candidate)).current.nickname, '旧昵称')
  failNextNotification()
  await assert.rejects(service.profileReview(reviewer, approve), /NOTIFICATION_FAILED/)
  assert.equal((await service.getMyProfile(alice)).nickname, '旧昵称')
  assert.equal((await service.profileRevision(alice, candidate)).status, 'pending')
  assert.equal([...rows.keys()].filter(key => key.startsWith('fy-community-audit/')).length, 0)
  loseNextResponse()
  await assert.rejects(service.profileReview(reviewer, approve), /RESPONSE_LOST/)
  const results = await Promise.allSettled([service.profileReview(reviewer, approve), service.profileReview(admin, reject)])
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected'])
  assert.equal((await service.getMyProfile(alice)).nickname, '新昵称')
  assert.equal([...rows.keys()].filter(key => key.startsWith('fy-notifications/')).length, 1)
  const audits = [...rows].filter(([key]) => key.startsWith('fy-community-audit/')).map(([, value]) => value)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].previous.nickname, '旧昵称')
  assert.equal(audits[0].submitted.nickname, '新昵称')
})

test('revision-owned photos survive staging expiry and can seed a new draft only for the owner', async () => {
  const { service, advance } = await fixture()
  const staged = await service.profileStageAvatar(alice, { requestId: 'photo', base64: 'picture' })
  const original = await service.profileSubmit(alice, { ...input, avatarUploadId: staged.uploadId })
  await service.profileReview(reviewer, { ...original, decision: 'reject', reason: '请修改昵称' })
  advance(24 * 3600000)
  await assert.rejects(service.profileSubmit(bob, { ...input, avatarRevisionId: original.revisionId }), /NOT_FOUND/)
  const draft = await service.profileSubmit(alice, { ...input, requestId: 'copy', avatarRevisionId: original.revisionId })
  await service.profileReview(reviewer, { ...draft, decision: 'approve' })
  assert.equal((await service.getMyProfile(alice)).avatarVersion, draft.revisionId)
  assert.match((await service.profileRevision(alice, { ...draft, avatar: true })).src, /^data:image\/png/)
})

test('a staged PNG uses encrypted storage and remains private until approval', async () => {
  const { repo } = await fixture()
  const files = new Map()
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='
  const media = createCommunityMedia({
    namespace: 'profile-avatar',
    cfg: { privateStorageVerified: true, mediaEncryptionKey: Buffer.alloc(32, 41).toString('base64') },
    limited: async () => {},
    cloud: {
      async uploadFile({ cloudPath, fileContent }) {
        assert.match(cloudPath, /^fy-private\/profile-avatar\//)
        files.set(cloudPath, fileContent)
        return { fileID: cloudPath }
      },
      async downloadFile({ fileID }) { return { fileContent: files.get(fileID) } }
    }
  })
  const service = createProfileService({ repo, media })
  const file = await service.profileStageAvatar(alice, { requestId: 'selected-photo', base64: png })
  assert.doesNotMatch(JSON.stringify(file), /fy-private/)
  assert.equal(files.size, 1)
  assert.ok(![...files.values()][0].includes(Buffer.from(png, 'base64')))
  const pending = await service.profileSubmit(alice, { ...input, avatarUploadId: file.uploadId })
  const publicPhoto = { code: 'ALICE234', avatarVersion: pending.revisionId }
  assert.equal((await service.getMyProfile(alice)).pending.nickname, input.nickname)
  await assert.rejects(service.profileRevision(bob, { ...pending, avatar: true }), /NOT_FOUND/)
  await assert.rejects(service.profileAvatar(null, publicPhoto), /NOT_FOUND/)
  assert.match((await service.profileRevision(alice, { ...pending, avatar: true })).src, /^data:image\/png/)
  await service.profileReview(reviewer, { ...pending, decision: 'approve' })
  assert.equal((await service.getMyProfile(alice)).pending, null)
  assert.match((await service.profileAvatar(null, publicPhoto)).src, /^data:image\/png/)
})
