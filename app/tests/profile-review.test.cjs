const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, alice, bob, input } = require('./helpers/profile-fixture.cjs')
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
