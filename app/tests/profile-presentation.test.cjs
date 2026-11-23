const test = require('node:test')
const assert = require('node:assert/strict')
const { transactionFixture } = require('./helpers/transaction-fixture.cjs')
const { createCommunityService } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-service')
const { createPartnershipService } = require('../uniCloud-alipay/cloudfunctions/fy-api/partnership-service')
const { createStepService } = require('../uniCloud-alipay/cloudfunctions/fy-api/step-service')
const { createNotificationService } = require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')

test('current profiles resolve by identity across paginated community, friends, rankings and message detail', async () => {
  const { rows, repo } = transactionFixture()
  const at = 1700000000000
  const partners = createPartnershipService({ repo, now: () => at })
  const community = createCommunityService({ repo, now: () => at })
  const steps = createStepService({ repo, now: () => at })
  const notifications = createNotificationService({ repo, now: () => at })
  for (const [uid, code] of [['alice', 'ALICE234'], ['bob', 'BOBBB234'], ['carol', 'CAROL234']]) {
    rows.set('uni-id-users/' + uid, { status: 0 })
    rows.set('fy-profiles/legacy-' + uid, { uid, code, nickname: '旧昵称' })
  }
  const alice = { uid: 'alice' }, bob = { uid: 'bob' }
  await partners.requestFriend(alice, { code: 'BOBBB234', requestId: 'friend' })
  const [message] = (await notifications.notificationsList(bob)).items
  rows.set('fy-community-posts/post', { uid: 'alice', author: '旧昵称', status: 'public', publicRevision: 'version', latestRevision: 'version', order: '1700000000000-' + '0'.repeat(64) })
  rows.set('fy-community-versions/version', { uid: 'alice', postId: 'post', status: 'approved' })
  for (let i = 0; i < 24; i++) {
    rows.set('fy-community-comments/comment-' + i, { uid: i % 2 ? 'alice' : 'carol', postId: 'post', author: '评论快照',
      status: 'public', order: '1700000000000-' + i.toString(16).padStart(64, '0') })
  }
  for (const uid of ['alice', 'carol']) {
    const path = 'fy-profiles/legacy-' + uid
    rows.set(path, { ...rows.get(path), nickname: '同名旅伴', avatarVersion: uid + '-avatar' })
  }
  const { items } = await community.communityFeed(null, {})
  assert.equal(items[0].author, '同名旅伴')
  assert.equal(items[0].authorAvatarVersion, 'alice-avatar')
  const first = await community.communityComments(null, { postId: 'post' })
  const second = await community.communityComments(null, { postId: 'post', cursor: first.next })
  assert.equal(first.items.length + second.items.length, 24)
  for (const row of [...first.items, ...second.items]) {
    assert.equal(row.author, '同名旅伴')
    assert.equal(row.authorCode, Number(row.id.slice(8)) % 2 ? 'ALICE234' : 'CAROL234')
  }
  assert.equal((await partners.findByCode(bob, { code: 'ALICE234' })).nickname, '同名旅伴')
  const [incoming] = await partners.friends(bob)
  assert.equal(incoming.avatarVersion, 'alice-avatar')
  assert.equal((await notifications.notificationDetail(bob, message)).friend.nickname, '同名旅伴')
  assert.equal(rows.get('fy-notifications/' + message.id).actorNickname, '旧昵称')
  await partners.respondFriend(bob, { requestId: incoming.id, accept: true })
  assert.equal((await community.communityRanking(bob)).find(row => row.code === 'ALICE234').nickname, '同名旅伴')
  assert.equal((await steps.stepRanking(bob)).rows.find(row => row.code === 'ALICE234').nickname, '同名旅伴')
  assert.equal(rows.get('fy-community-comments/comment-1').author, '评论快照')
})
