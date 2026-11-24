const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRepository } = require('../uniCloud-alipay/cloudfunctions/fy-api/repository')
const { createCommunityService } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-service')
const { createCommunityMedia, sanitize } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-media')
const { createCommunityOperations } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-operations')
const { encrypt, decrypt, authenticate } = require('../uniCloud-alipay/cloudfunctions/fy-api/security')
const { createService, key } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')
const { createNotificationService } = require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')

const author = { uid: 'author' }, friend = { uid: 'friend' }, stranger = { uid: 'stranger' }
const reviewer = { uid: 'reviewer', reviewer: true }, admin = { uid: 'admin', admin: true }
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='

function fixture() {
  const rows = new Map(), files = new Map()
  let clock = 1784000000000
  let conflicts = 0
  let failCommit = false
  let loseResponse = false
  function database(snapshot, writes = null) {
    return {
      command: {
        lt: value => ({ lt: value }), gt: value => ({ gt: value }), in: value => ({ in: value })
      },
      collection(name) {
        return {
          doc(id) {
            const path = name + '/' + id
            return {
              async get() {
                const row = writes?.get(path) ?? snapshot.get(path)
                return { data: row ? { ...structuredClone(row), _id: id } : null }
              },
              async set(value) { (writes ?? snapshot).set(path, structuredClone(value)) }
            }
          },
          where(filter) {
            let sort = '_id', descending = false, size = 100
            const query = {
              orderBy(field, direction) { sort = field; descending = direction === 'desc'; return query },
              limit(value) { size = value; return query },
              async get() {
                const data = [...snapshot].filter(([path]) => path.startsWith(name + '/'))
                  .map(([path, row]) => ({ ...structuredClone(row), _id: path.slice(name.length + 1) }))
                  .filter(row => Object.entries(filter).every(([field, value]) => {
                    if (typeof value !== 'object') return row[field] === value
                    if (value.in) return value.in.includes(row[field])
                    if (value.lt) return row[field] < value.lt
                    return row[field] > value.gt
                  }))
                data.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (descending ? -1 : 1))
                return { data: data.slice(0, size) }
              },
              async count() { return { total: (await query.limit(Infinity).get()).data.length } }
            }
            return query
          }
        }
      }
    }
  }
  const db = {
    ...database(rows),
    async startTransaction() {
      const snapshot = new Map(rows), writes = new Map()
      return {
        ...database(snapshot, writes),
        async commit() {
        if (failCommit) { failCommit = false; throw new Error('WRITE_FAILED') }
          for (const path of writes.keys()) {
            if (snapshot.get(path) !== rows.get(path)) { conflicts++; throw new Error('WRITE_CONFLICT') }
          }
          for (const [path, value] of writes) rows.set(path, value)
          if (loseResponse) { loseResponse = false; throw new Error("RESPONSE_LOST") }
        },
        async rollback() {}
      }
    }
  }
  const repo = createRepository(db), mediaKey = Buffer.alloc(32, 4)
  const service = createService({ repo })
  const cloud = {
    async uploadFile({ cloudPath, fileContent }) {
      const fileID = 'cloud://' + cloudPath
      files.set(fileID, fileContent)
      return { fileID }
    },
    async downloadFile({ fileID }) { return { fileContent: files.get(fileID) } },
    async deleteFile({ fileList }) { for (const file of fileList) files.delete(file) }
  }
  const media = createCommunityMedia({
    cloud, cfg: { privateStorageVerified: true, mediaEncryptionKey: mediaKey.toString('base64') },
    service, limited: async () => {}
  })
  const community = createCommunityService({ repo, media, now: () => clock })
  async function post(user = author, payload = {}) {
    return community.communitySubmit(user, { title: 'Title', body: 'Body', requestId: 'request', ...payload })
  }
  async function approve(version) { await community.communityReviewPost(reviewer, { ...version, decision: 'approve' }) }
  return { repo, community, media, service, cloud, post, approve, mediaKey, files, failNextCommit: () => { failCommit = true }, loseNextResponse: () => { loseResponse = true }, conflicts: () => conflicts, tick: value => { clock += value } }
}

test('mine filters the latest author view while paginating the unfiltered owner records', async () => {
  const f = fixture(), c = f.community
  const create = async id => { f.tick(1); return f.post(author, { requestId: id }) }
  const first = await create('old-pending')
  const approved = await create('historical')
  await c.communityReviewPost(reviewer, { ...approved, decision: 'reject', reason: 'Old reason' })
  const replacement = await f.post(author, { ...approved, baseRevision: approved.revisionId, requestId: 'replacement' })
  await f.approve(replacement)
  const removed = await create('removed')
  await f.approve(removed)
  await c.communityReviewPost(reviewer, { ...removed, decision: 'remove', reason: 'Removed' })
  const deleted = await create('deleted')
  await c.communityRemoveOwn(author, deleted)
  for (let i = 0; i < 20; i++) await f.approve(await create('public-' + i))
  const latest = await create('new-pending')
  await f.post(friend, { requestId: 'other-owner' })

  const mine = (statusFilter, cursor) => c.communityFeed(author, { tab: 'mine', statusFilter, cursor })
  const top = await mine('pending')
  assert.equal(top.appliedStatusFilter, 'pending')
  assert.deepEqual(top.items.map(item => item.id), [latest.postId])
  const tail = await mine('pending', top.next)
  assert.deepEqual(tail.items.map(item => item.id), [first.postId])
  assert.equal(tail.next, '')
  assert.deepEqual(await mine('pending', top.next), tail)
  const empty = await mine('inactive')
  assert.deepEqual(empty.items, [])
  assert.ok(empty.next)
  assert.deepEqual((await mine('inactive', empty.next)).items.map(item => item.status).sort(), ['deleted', 'removed'])
  assert.deepEqual((await mine('rejected', top.next)).items, [])
  assert.ok((await mine('approved', top.next)).items.some(item => item.revisionId === replacement.revisionId))
  assert.deepEqual(await mine(undefined), await mine('all'))
  await assert.rejects(mine('public'), /INVALID_REQUEST/)
  await assert.rejects(c.communityFeed(null, { tab: 'mine', statusFilter: 'pending' }), /AUTH_REQUIRED/)
  assert.equal((await c.communityFeed(friend, { tab: 'mine', statusFilter: 'pending' })).items.length, 1)
})

test('public post detail counts active favorites from distinct users, including existing records', async () => {
  const f = fixture(), c = f.community
  const post = await f.post()
  const other = await f.post(author, { requestId: 'other-favorites' })
  await f.approve(post)
  await f.approve(other)
  const react = (user, target, kind, active = true) => c.communityReaction(user, { ...target, kind, active })
  await f.repo.put('fy-community-reactions', key(friend.uid, post.postId, 'favorite'), {
    uid: friend.uid, postId: post.postId, kind: 'favorite', active: true, order: ''
  })
  await react(stranger, post, 'like')
  await react(stranger, other, 'favorite')
  assert.equal((await c.communityPost(null, post)).favoriteCount, 1)
  await react(stranger, post, 'favorite')
  await react(stranger, post, 'favorite')
  const detail = await c.communityPost(stranger, post)
  assert.equal(detail.saved, true)
  assert.equal(detail.favoriteCount, 2)
  await react(stranger, post, 'favorite', false)
  assert.equal((await c.communityPost(stranger, post)).favoriteCount, 1)
  await react(friend, post, 'favorite', false)
  assert.equal((await c.communityPost(null, post)).favoriteCount, 0)
})

test('a public post share creates a private and retry-safe friend message that opens the public post', async () => {
  const f = fixture(), c = f.community
  const messages = createNotificationService({ repo: f.repo })
  const friendCode = 'FRIEND23', strangerCode = 'OTHER234'
  for (const [user, code] of [[author, 'AUTHOR23'], [friend, friendCode], [stranger, strangerCode]]) {
    await f.repo.put('uni-id-users', user.uid, { status: 0 })
    await f.repo.put('fy-profiles', user.uid, { uid: user.uid, code, nickname: user.uid })
  }
  const relation = key('friend', ...[author.uid, friend.uid].sort())
  const pair = { from: friend.uid, to: author.uid }
  const post = await f.post(author, { title: '分享测试' })
  const args = { postId: post.postId, code: friendCode }
  await assert.rejects(c.communityShareToFriend(null, args), /AUTH_REQUIRED/)
  await assert.rejects(c.communityShareToFriend(author, args), /SHARE_POST_UNAVAILABLE/)
  await f.approve(post)
  await f.repo.put('fy-friends', relation, { ...pair, status: 'pending' })
  await assert.rejects(c.communityShareToFriend(author, args), /NOT_FRIENDS/)
  await assert.rejects(c.communityShareToFriend(author, { ...args, code: strangerCode }), /NOT_FRIENDS/)
  await f.repo.put('fy-friends', relation, { ...pair, status: 'accepted' })
  await f.repo.put('uni-id-users', friend.uid, { status: 1 })
  await assert.rejects(c.communityShareToFriend(author, args), /NOT_FRIENDS/)
  await f.repo.put('uni-id-users', friend.uid, { status: 0 })
  const sends = await Promise.all([c.communityShareToFriend(author, args), c.communityShareToFriend(author, args)])
  assert.deepEqual(sends.map(value => value.alreadyShared).sort(), [false, true])
  const { items } = await messages.notificationsList(friend)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '好友分享了帖子')
  assert.equal(items[0].preview, author.uid)
  assert.equal((await messages.notificationsSummary(friend)).unread, 1)
  const id = items[0].id
  await assert.rejects(messages.notificationDetail(stranger, { id }), /NOT_FOUND/)
  assert.deepEqual((await messages.notificationDetail(friend, { id })).target,
    { postId: post.postId, revisionId: post.revisionId, commentId: '', preview: false })
  await messages.notificationRead(friend, { id })
  assert.equal((await c.communityShareToFriend(author, args)).alreadyShared, true)
  assert.equal((await messages.notificationsSummary(friend)).unread, 0)
  const newer = await f.post(author, { postId: post.postId, baseRevision: post.revisionId, requestId: 'updated-share', title: '新版' })
  await f.approve(newer)
  const updated = await messages.notificationDetail(friend, { id })
  assert.equal(updated.target.revisionId, newer.revisionId)
  assert.equal(updated.sharedTitle, '新版')
  await c.communityRemoveOwn(author, newer)
  assert.equal((await messages.notificationDetail(friend, { id })).target, null)
  await assert.rejects(c.communityShareToFriend(author, args), /SHARE_POST_UNAVAILABLE/)
})

test('guessed IDs cannot read pending posts, private images or someone else’s diary', async () => {
  const f = fixture(), c = f.community
  const gps = Buffer.from('GPSLatitude=22.123456;GPSLongitude=113.123456')
  const chunk = Buffer.alloc(gps.length + 12)
  chunk.writeUInt32BE(gps.length)
  chunk.write('tEXt', 4)
  gps.copy(chunk, 8)
  const clean = Buffer.from(png, 'base64')
  const original = Buffer.concat([clean.subarray(0, 33), chunk, clean.subarray(33)])
  const originalFile = 'cloud://fy-private/proof'
  f.files.set(originalFile, encrypt(original, f.mediaKey))
  await f.repo.put('fy-media', 'proof', { uid: author.uid, runId: 'run', nodeId: 'node', used: true, fileID: originalFile, mime: 'image/png' })
  await f.repo.put('fy-diary', 'diary', { uid: author.uid, runId: 'run', nodeId: 'node', mediaId: 'proof', latitude: 22.123456, longitude: 113.123456 })
  await assert.rejects(f.post(stranger, { imageSource: 'diary', diaryId: 'diary' }), /NOT_FOUND/)
  const pending = await f.post(author, { imageSource: 'diary', diaryId: 'diary' })
  const preview = { ...pending, preview: true }
  assert.equal((await c.communityFeed(author, { tab: 'mine' })).items[0].status, 'pending')
  assert.equal((await c.communityFeed(null, {})).items.length, 0)
  for (const user of [null, stranger]) {
    await assert.rejects(c.communityPost(user, preview), /NOT_FOUND/)
    await assert.rejects(c.communityImage(user, preview), /NOT_FOUND/)
    await assert.rejects(c.communityShare(user, pending), /NOT_FOUND/)
    await assert.rejects(c.communityReviewImage(user, preview), /FORBIDDEN/)
  }
  await assert.rejects(f.post(stranger, { postId: pending.postId, baseRevision: pending.revisionId }), /NOT_FOUND/)
  await assert.rejects(c.communityRemoveOwn(stranger, pending), /NOT_FOUND/)
  await assert.rejects(f.service.readMedia(stranger, { id: 'proof' }), /NOT_FOUND/)
  const version = await f.repo.get('fy-community-versions', pending.revisionId)
  assert.notEqual(version.media.fileID, originalFile)
  assert.match(version.media.fileID, /^cloud:\/\/fy-private\/community\//)
  assert.deepEqual(decrypt(f.files.get(version.media.fileID), f.mediaKey), clean)
  assert.deepEqual(decrypt(f.files.get(originalFile), f.mediaKey), original)
  assert.deepEqual(await c.communityImage(author, preview), { src: 'data:image/png;base64,' + png })
  assert.deepEqual(await c.communityReviewImage(reviewer, preview), { src: 'data:image/png;base64,' + png })
  await f.approve(pending)
  const view = await c.communityPost(null, pending)
  assert.equal(view.hasImage, true)
  assert.doesNotMatch(JSON.stringify(view), /latitude|longitude|fileID|proof|diary|targetUid/)
  assert.equal((await c.communityImage(null, pending)).src, 'data:image/png;base64,' + png)
  await assert.rejects(c.communityImage(null, { postId: pending.postId, revisionId: 'proof' }), /NOT_FOUND/)
})

test('rejection preserves the old public version; approval swaps it; removal revokes share and image reads', async () => {
  const f = fixture(), c = f.community
  const original = await f.post(author, { imageSource: 'upload', base64: png })
  await f.approve(original)
  const update = await f.post(author, { postId: original.postId, baseRevision: original.revisionId,
    requestId: 'edit', title: 'New', imageSource: 'keep' })
  assert.equal((await c.communityPost(stranger, { postId: original.postId })).title, 'Title')
  assert.equal((await c.communityShare(null, original)).title, 'Title')
  await assert.rejects(c.communityImage(stranger, update), /NOT_FOUND/)
  const comparison = await c.communityReviewDetail(reviewer, update)
  assert.equal(comparison.current.id, original.revisionId)
  assert.equal(comparison.selected.id, update.revisionId)
  await c.communityReviewPost(reviewer, { ...update, decision: 'reject', reason: 'Needs correction' })
  assert.equal((await c.communityPost(author, { ...update, preview: true })).reason, 'Needs correction')
  assert.equal((await c.communityFeed(null, {})).items[0].revisionId, original.revisionId)
  assert.equal((await c.communityImage(null, original)).src, 'data:image/png;base64,' + png)
  const next = await f.post(author, { postId: original.postId, baseRevision: update.revisionId,
    requestId: 'next', title: 'Corrected', imageSource: 'keep' })
  await assert.rejects(f.approve(update), /STALE_VERSION/)
  await f.approve(next)
  assert.equal((await c.communityShare(null, original)).title, 'Corrected')
  await assert.rejects(c.communityImage(author, original), /NOT_FOUND/)
  await assert.rejects(c.communityReviewPost(reviewer, { ...original, decision: 'remove', reason: 'Stale' }), /STALE_VERSION/)
  await c.communityReaction(stranger, { ...next, kind: 'favorite', active: true })
  await c.communityReviewPost(reviewer, { ...next, decision: 'remove', reason: 'Removed' })
  for (const user of [null, author, stranger]) {
    await assert.rejects(c.communityShare(user, next), /NOT_FOUND/)
    await assert.rejects(c.communityPost(user, { postId: next.postId }), /NOT_FOUND/)
    await assert.rejects(c.communityImage(user, next), /NOT_FOUND/)
  }
  assert.equal((await c.communityFeed(stranger, { tab: 'saved' })).items.length, 0)
  assert.equal((await c.communityFeed(null, {})).items.length, 0)
})

test('concurrent comments conflict across posts, and the interval, rolling cap and duplicate windows persist', async () => {
  const f = fixture(), c = f.community
  const a = await f.post(), b = await f.post(author, { requestId: 'other' })
  await f.approve(a); await f.approve(b)
  const say = (target, body, requestId) => c.communityComment(friend, { ...target, body, requestId })
  const attempts = await Promise.allSettled([say(a, 'A test', 'one'), say(b, 'A test', 'two')])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.match(attempts.find(item => item.status === 'rejected').reason.message, /DUPLICATE_COMMENT/)
  assert.ok(f.conflicts() >= 1)
  await assert.rejects(say(a, 'Different', 'three'), /RATE_LIMITED/)
  f.tick(10000)
  await assert.rejects(say(b, 'Ａ·ＴＥＳＴ', 'four'), /DUPLICATE_COMMENT/)
  for (let i = 1; i < 20; i++) {
    await say(a, 'comment ' + i, 'at-' + i)
    f.tick(10000)
  }
  await assert.rejects(say(b, 'Over cap', 'cap'), /RATE_LIMITED/)
  f.tick(400000)
  assert.equal((await say(b, 'Ａ·ＴＥＳＴ', 'again')).status, 'public')
})

test('comment review, replies, reports, configuration and mutes enforce server-side permissions', async () => {
  const f = fixture(), c = f.community
  const post = await f.post(), other = await f.post(author, { requestId: 'other' })
  await f.approve(post); await f.approve(other)
  const policy = { revision: 0, minSeconds: 10, maxPerWindow: 20, duplicateSeconds: 300, rules: [
    { word: '禁词', action: 'reject' }, { word: '查验', action: 'pending' }, { word: '查验通过', action: 'allow' }
  ] }
  await assert.rejects(c.communitySavePolicy(reviewer, policy), /FORBIDDEN/)
  await c.communitySavePolicy(admin, policy)
  const say = (user, payload) => c.communityComment(user, { ...post, requestId: 'new', ...payload })
  await assert.rejects(say(friend, { body: '查验　禁—｜词' }), /COMMENT_REJECTED/)
  const pending = await say(friend, { body: '查 · 验' })
  assert.equal(pending.status, 'pending')
  assert.equal((await c.communityPost(null, post)).commentCount, 0)
  assert.equal((await c.communityComments(stranger, post)).mine.length, 0)
  assert.equal((await c.communityComments(friend, post)).mine[0].id, pending.id)
  await assert.rejects(say(stranger, { body: 'reply', parentId: pending.id }), /NOT_FOUND/)
  await assert.rejects(c.communityReviewComment(stranger, { commentId: pending.id, decision: 'approve' }), /FORBIDDEN/)
  await c.communityReviewComment(reviewer, { commentId: pending.id, decision: 'approve' })
  assert.equal((await c.communityPost(null, post)).commentCount, 1)
  await assert.rejects(say(stranger, { ...other, body: 'reply', parentId: pending.id }), /NOT_FOUND/)
  const reply = await say(stranger, { body: '查验 通过', parentId: pending.id })
  assert.equal(reply.status, 'public')
  const report = await c.communityReport(author, { ...post, commentId: reply.id, reason: 'Please review' })
  const queue = await c.communityReviewList(reviewer, { group: 'reports' })
  assert.equal(queue.items[0].commentId, reply.id)
  await c.communityResolveReport(reviewer, { reportId: report.id, reason: 'Handled' })
  await c.communityReviewComment(reviewer, { commentId: reply.id, decision: 'remove', reason: 'Removed' })
  assert.equal((await c.communityPost(null, post)).commentCount, 1)
  await f.repo.put('uni-id-users', friend.uid, { status: 0 })
  await assert.rejects(c.communityMute(stranger, { targetUid: friend.uid, minutes: 1, reason: 'reason' }), /FORBIDDEN/)
  await c.communityMute(reviewer, { targetUid: friend.uid, minutes: 1, reason: 'reason' })
  f.tick(10000)
  await assert.rejects(say(friend, { requestId: 'muted', body: 'During mute' }), /COMMUNITY_MUTED/)
  await assert.rejects(f.post(friend), /COMMUNITY_MUTED/)
  await c.communityMute(reviewer, { targetUid: friend.uid, minutes: 0, reason: 'Release' })
  assert.equal((await say(friend, { requestId: 'muted', body: 'After mute' })).status, 'public')
  const audit = (await c.communityReviewList(reviewer, { group: 'audit' })).items
  for (const action of ['policy.save', 'comment.approve', 'report.resolve', 'comment.remove', 'user.mute', 'user.unmute']) {
    assert.ok(audit.some(item => item.action === action && item.actor))
  }
})

test('friend feed and ranking include accepted relations and rank equal solo-route totals together', async () => {
  const f = fixture(), c = f.community
  for (const uid of [author.uid, friend.uid, stranger.uid, 'zero']) {
    await f.repo.put('uni-id-users', uid, { status: 0 })
    await f.repo.put('fy-profiles', uid, { uid, nickname: uid, code: 'CODE-' + uid })
  }
  await f.repo.put('fy-friends', 'f1', { from: author.uid, to: friend.uid, status: 'accepted' })
  await f.repo.put('fy-friends', 'f2', { from: 'zero', to: author.uid, status: 'accepted' })
  await f.repo.put('fy-friends', 'f3', { from: author.uid, to: stranger.uid, status: 'pending' })
  await f.approve(await f.post(friend, { title: 'Friend post' }))
  await f.approve(await f.post(stranger, { title: 'Other post' }))
  assert.deepEqual((await c.communityFeed(author, { tab: 'friends' })).items.map(p => p.title), ['Friend post'])
  const seed = async (uid, runId, routeId, purpose, culture = null) => {
    await f.repo.put('fy-runs', runId, { uid, purpose, routeId, snapshot: { nodes: [{ id: 'n' }], culture } })
    await f.repo.put('fy-checkins', key(runId, 'n'), { uid, runId, nodeId: 'n' })
  }
  await seed(author.uid, 'me-legacy', 'r', undefined)
  await seed(author.uid, 'me-solo', 'r', 'solo')
  await seed(author.uid, 'me-pk', 'pk-route', 'pk')
  await seed(author.uid, 'me-coop', 'coop-route', 'coop')
  await seed(author.uid, 'incomplete-culture', 'c', 'solo', { tile: {} })
  await seed(friend.uid, 'friend-solo', 'r', 'solo')
  await seed(stranger.uid, 'stranger-solo', 'r', 'solo')
  const ranking = await c.communityRanking(author)
  assert.deepEqual(ranking.map(row => [row.nickname, row.count, row.rank]), [['author', 1, 1], ['friend', 1, 1], ['zero', 0, 3]])
  assert.ok(ranking.every(row => row.uid === undefined))
})

test('JPEG metadata is stripped before copying, including segments between scans', () => {
  const original = Buffer.concat([
    Buffer.from([255, 216, 255, 225, 0, 5, 71, 80, 83]),
    Buffer.from([255, 218, 0, 2, 1, 2, 255, 0, 3]),
    Buffer.from([255, 254, 0, 5, 88, 77, 80]),
    Buffer.from([255, 218, 0, 2, 4, 5, 255, 217])
  ])
  const result = sanitize(original.toString('base64'))
  assert.equal(result.mime, 'image/jpeg')
  assert.deepEqual(result.bytes, Buffer.from([255, 216, 255, 218, 0, 2, 1, 2, 255, 0, 3, 255, 218, 0, 2, 4, 5, 255, 217]))
})

test('version retries keep one copy and an in-flight public image read checks visibility again', async () => {
  const f = fixture(), c = f.community
  const upload = { imageSource: 'upload', base64: png }
  const versions = await Promise.all([f.post(author, upload), f.post(author, upload)])
  assert.deepEqual(versions[0], versions[1])
  assert.equal(f.files.size, 1)
  const current = versions[0]
  await f.approve(current)
  const newer = await f.post(author, { postId: current.postId, baseRevision: current.revisionId, requestId: 'newer' })
  const download = f.cloud.downloadFile
  f.cloud.downloadFile = async args => {
    await c.communityReviewPost(reviewer, { ...current, decision: 'remove', reason: 'Concurrent removal' })
    return download(args)
  }
  await assert.rejects(c.communityImage(null, current), /NOT_FOUND/)
  await assert.rejects(f.approve(newer), /STALE_VERSION/)
  assert.equal((await c.communityReviewList(reviewer, { group: 'pending' })).items.length, 0)
})

test('feed cards use public profile fields and leave post body to detail', async () => {
  const f = fixture(), c = f.community
  await f.repo.put('uni-id-users', author.uid, { status: 0 })
  const post = await f.post()
  await f.approve(post)
  const newAuthor = (await c.communityFeed(null, {})).items[0]
  assert.match(newAuthor.authorCode, /^[A-Z2-9]{8}$/)
  const profileId = key('profile', author.uid)
  const profile = await f.repo.get('fy-profiles', profileId)
  await f.repo.put('fy-profiles', profileId, { ...profile, nickname: '探索者', avatar: 'https://example.test/avatar.png' })
  const card = (await c.communityFeed(null, {})).items[0]
  assert.equal(card.author, '探索者')
  assert.equal(card.authorCode, newAuthor.authorCode)
  assert.equal(card.authorAvatar, 'https://example.test/avatar.png')
  assert.equal(card.uid, undefined)
  assert.equal(card.body, undefined)
  assert.equal((await c.communityPost(null, post)).body, 'Body')
  await f.repo.put('fy-profiles', profileId, { ...profile, avatar: 'cloud://private/proof' })
  assert.equal((await c.communityPost(null, post)).authorAvatar, '')
})

test('posting accepts title, body or images alone and reports an empty draft', async () => {
  const f = fixture(), c = f.community
  const send = payload => c.communitySubmit(author, { requestId: 'draft', images: [], ...payload })
  await assert.rejects(send({ title: '　', body: ' ' }), /INVALID_CONTENT/)
  assert.equal((await c.communityFeed(author, { tab: 'mine' })).items.length, 0)
  const title = await send({ title: '标题' })
  await f.approve(title)
  assert.equal((await c.communityPost(null, title)).title, '标题')
  const body = await send({ requestId: 'body-only', body: '正文' })
  await f.approve(body)
  assert.equal((await c.communityPost(null, body)).body, '正文')
  assert.equal((await c.communityShare(null, body)).title, '文字动态')
  const image = await c.communityStageImage(author, { requestId: 'image-only', slot: 'one', imageSource: 'upload', base64: png })
  const gallery = await send({ requestId: 'image-only', images: [image] })
  await f.approve(gallery)
  assert.equal((await c.communityShare(null, gallery)).title, '图片动态')
  assert.equal((await c.communityPost(null, gallery)).imageCount, 1)
})

test('nine staged images are ordered, privately scoped, reusable on retry and atomically reviewed', async () => {
  const f = fixture(), c = f.community
  const stage = (slot, base64 = png) => c.communityStageImage(author, { requestId: 'gallery', slot, imageSource: 'upload', base64 })
  const jpeg = Buffer.from([255, 216, 255, 218, 0, 2, 1, 2, 3, 4, 5, 6, 7, 8, 255, 217]).toString('base64')
  const first = await stage('one', jpeg)
  assert.deepEqual(await stage('one', jpeg), first)
  await assert.rejects(stage('one', png), /REQUEST_CONFLICT/)
  await assert.rejects(stage('two', 'bad'), /INVALID_IMAGE/)
  const photos = [first]
  for (let i = 2; i <= 8; i++) photos.push(await stage('slot-' + i))
  const originalFile = 'cloud://fy-private/mixed-diary'
  f.files.set(originalFile, encrypt(Buffer.from(png, 'base64'), f.mediaKey))
  await f.repo.put('fy-media', 'proof-gallery', { uid: author.uid, runId: 'run', nodeId: 'node', used: true, fileID: originalFile, mime: 'image/png' })
  await f.repo.put('fy-diary', 'diary-gallery', { uid: author.uid, runId: 'run', nodeId: 'node', mediaId: 'proof-gallery' })
  const diaryPayload = { requestId: 'gallery', slot: 'last', imageSource: 'diary', diaryId: 'diary-gallery' }
  await assert.rejects(c.communityStageImage(stranger, diaryPayload), /NOT_FOUND/)
  const upload = f.cloud.uploadFile
  f.cloud.uploadFile = async () => { throw new Error('NETWORK') }
  await assert.rejects(c.communityStageImage(author, diaryPayload), /MEDIA_UPLOAD_FAILED/)
  f.cloud.uploadFile = upload
  photos.push(await c.communityStageImage(author, diaryPayload))
  assert.deepEqual(await stage('one', jpeg), first)
  assert.equal(f.files.size, 10)
  await assert.rejects(c.communitySubmit(stranger, { requestId: 'gallery', images: photos }), /UPLOAD_NOT_AVAILABLE/)
  await assert.rejects(c.communitySubmit(author, { requestId: 'another', images: photos }), /UPLOAD_NOT_AVAILABLE/)
  await assert.rejects(c.communitySubmit(author, { requestId: 'gallery', images: [...photos, first] }), /INVALID_IMAGES/)
  await assert.rejects(c.communitySubmit(author, { requestId: 'gallery', images: [first, first] }), /INVALID_IMAGES/)
  const published = await c.communitySubmit(author, { requestId: 'gallery', images: photos })
  assert.deepEqual(await c.communitySubmit(author, { requestId: 'gallery', images: photos }), published)
  assert.equal((await c.communityReviewDetail(reviewer, published)).selected.imageCount, 9)
  await assert.rejects(c.communityImage(stranger, { ...published, index: 8 }), /NOT_FOUND/)
  assert.equal((await c.communityReviewImage(reviewer, { ...published, index: 0 })).src, 'data:image/jpeg;base64,' + jpeg)
  await f.approve(published)
  assert.equal((await c.communityImage(null, { ...published, index: 8 })).src, 'data:image/png;base64,' + png)
  await assert.rejects(c.communityImage(null, { ...published, index: 9 }), /NOT_FOUND/)
  const edit = await c.communitySubmit(author, {
    postId: published.postId, baseRevision: published.revisionId, requestId: 'edit-gallery',
    images: [{ keepIndex: 8 }, { keepIndex: 0 }]
  })
  assert.equal((await c.communityPost(null, published)).imageCount, 9)
  await f.approve(edit)
  assert.equal((await c.communityPost(null, edit)).imageCount, 2)
  assert.equal((await c.communityImage(null, { ...edit, index: 1 })).src, 'data:image/jpeg;base64,' + jpeg)
  assert.equal(f.files.size, 10)
  assert.equal((await f.service.readMedia(author, { id: 'proof-gallery' })).fileID, originalFile)
  await assert.rejects(f.service.readMedia(stranger, { id: 'proof-gallery' }), /NOT_FOUND/)
  await c.communityReviewPost(reviewer, { ...edit, decision: 'remove', reason: 'Remove gallery' })
  await assert.rejects(c.communityImage(null, edit), /NOT_FOUND/)
})

test('account operations require admin, revoke sessions, scope review queues and audit changes', async () => {
  const f = fixture(), c = f.community, ops = createCommunityOperations({ repo: f.repo })
  await f.repo.put('uni-id-users', author.uid, { status: 0, token: ['active-token'], register_date: 1, wx_openid: 'private' })
  await f.repo.put('uni-id-users', stranger.uid, { status: 1, token: [] })
  const post = await f.post()
  await f.approve(post)
  const card = (await c.communityFeed(null, {})).items[0]
  await assert.rejects(ops.communityUsers(reviewer, {}), /FORBIDDEN/)
  await assert.rejects(ops.communityAccountStatus(reviewer, { targetUid: author.uid, suspend: true, reason: 'test' }), /FORBIDDEN/)
  const page = await ops.communityUsers(admin, { code: card.authorCode.toLowerCase() })
  assert.equal(page.items[0].id, author.uid)
  assert.doesNotMatch(JSON.stringify(page), /active-token|wx_openid|private/)
  assert.equal((await ops.communityUserDetail(admin, { targetUid: author.uid })).postCount, 1)
  assert.equal((await c.communityReviewList(admin, { group: 'published', targetUid: author.uid })).items.length, 1)
  assert.equal((await c.communityReviewList(admin, { group: 'published', targetUid: stranger.uid })).items.length, 0)
  assert.equal((await ops.communityOverview(reviewer)).publishedPosts, 1)
  assert.equal((await ops.communityOverview(reviewer)).activeAccounts, undefined)
  assert.equal((await ops.communityOverview(admin)).activeAccounts, 1)
  await ops.communityAccountStatus(admin, { targetUid: author.uid, suspend: true, reason: 'Pause access' })
  const account = () => f.repo.get('uni-id-users', author.uid)
  assert.deepEqual((await account()).token, [])
  const check = () => authenticate({ checkToken: async () => ({ uid: author.uid }) }, 'active-token', account)
  await assert.rejects(check(), /AUTH_REQUIRED/)
  await assert.rejects(f.post(author, { requestId: 'paused' }), /ACCOUNT_DISABLED/)
  await assert.rejects(ops.communityAccountStatus(admin, { targetUid: stranger.uid, suspend: false, reason: 'Unrelated' }), /INVALID_ACCOUNT_STATE/)
  await ops.communityAccountStatus(admin, { targetUid: author.uid, suspend: false, reason: 'Reinstate access' })
  assert.equal((await account()).status, 0)
  await assert.rejects(check(), /AUTH_REQUIRED/)
  const audit = (await c.communityReviewList(reviewer, { group: 'audit' })).items
  assert.ok(audit.some(row => row.action === 'user.suspend' && row.actor === admin.uid))
  assert.ok(audit.some(row => row.action === 'user.restore' && row.actor === admin.uid))
})

test('workbench counts only actionable revisions and filtered pages fill across stale candidates', async () => {
  const f = fixture(), c = f.community, ops = createCommunityOperations({ repo: f.repo })
  const expected = []
  for (let i = 0; i < 45; i++) {
    f.tick(1)
    expected.unshift(await f.post(author, { requestId: 'post-' + i }))
  }
  for (let i = 0; i < 25; i++) {
    const original = expected[i]
    f.tick(1)
    expected[i] = await f.post(author, { postId: original.postId, baseRevision: original.revisionId, requestId: 'edit-' + i })
    const old = await f.repo.get('fy-community-versions', original.revisionId)
    await f.repo.put('fy-community-versions', original.revisionId, { ...old, status: 'pending' })
  }
  assert.equal((await ops.communityOverview(reviewer)).pendingPosts, 45)
  const seen = []
  let cursor = ''
  do {
    const { items, next } = await c.communityReviewList(reviewer, { group: 'pending', targetUid: author.uid, cursor })
    if (next) assert.equal(items.length, 20)
    seen.push(...items.map(row => row.revisionId))
    cursor = next
  } while (cursor)
  assert.equal(seen.length, 45)
  assert.equal(new Set(seen).size, 45)
  assert.deepEqual(new Set(seen), new Set(expected.map(row => row.revisionId)))
  assert.deepEqual(await c.communityReviewList(reviewer, { group: 'pending', targetUid: stranger.uid }), { items: [], next: '' })
})

test('reported revision and comment come from the stored report; legacy comments still open', async () => {
  const f = fixture(), c = f.community
  const first = await f.post()
  await f.approve(first)
  const comment = await c.communityComment(friend, { ...first, body: 'Hello', requestId: 'comment' })
  const report = await c.communityReport(stranger, { ...first, commentId: comment.id, reason: 'Review this comment' })
  const newer = await f.post(author, { postId: first.postId, baseRevision: first.revisionId, requestId: 'edit' })
  await f.approve(newer)
  const detail = await c.communityReviewDetail(reviewer, { ...newer, reportId: report.id, commentId: 'unrelated' })
  assert.equal(detail.reportedRevisionId, first.revisionId)
  assert.equal(detail.selected.id, first.revisionId)
  assert.equal(detail.current.id, newer.revisionId)
  assert.equal(detail.reportedComment.id, comment.id)
  const legacy = await f.repo.get('fy-community-comments', comment.id)
  legacy.revisionId = ''
  await f.repo.put('fy-community-comments', comment.id, legacy)
  const legacyDetail = await c.communityReviewDetail(reviewer, { postId: first.postId, commentId: comment.id })
  assert.equal(legacyDetail.reportedComment.id, comment.id)
  assert.equal(legacyDetail.selected.id, newer.revisionId)
  const legacyReport = await c.communityReport(author, { ...newer, commentId: comment.id, reason: 'Legacy comment' })
  assert.equal((await c.communityReviewDetail(reviewer, { reportId: legacyReport.id })).reportedRevisionId, newer.revisionId)
  const stored = await f.repo.get('fy-community-reports', legacyReport.id)
  await f.repo.put('fy-community-reports', legacyReport.id, { ...stored, revisionId: '' })
  const unknown = await c.communityReviewDetail(reviewer, { reportId: legacyReport.id })
  assert.equal(unknown.reportedRevisionId, '')
  assert.equal(unknown.reportedComment.id, comment.id)
  await assert.rejects(c.communityReviewDetail(reviewer, { ...await f.post(stranger), commentId: comment.id }), /NOT_FOUND/)
})


test('user accounts without profiles are listed; governance counts match their linked queues', async () => {
  const f = fixture(), c = f.community, ops = createCommunityOperations({ repo: f.repo })
  await f.repo.put('uni-id-users', author.uid, { status: 0 })
  await f.repo.put('uni-id-users', friend.uid, { status: 1 })
  await f.repo.put('uni-id-users', stranger.uid, { status: 1, fyOpsSuspended: true })
  assert.deepEqual((await ops.communityUsers(admin, { code: 'ABCDEFGH' })).items, [])
  assert.equal((await ops.communityUserDetail(admin, { targetUid: author.uid })).code, '')
  await assert.rejects(ops.communityUserDetail(reviewer, { targetUid: author.uid }), /FORBIDDEN/)
  assert.deepEqual((await ops.communityUsers(admin, { status: 'disabled' })).items.map(row => row.id), [stranger.uid])
  const profile = { bio: '公开简介', displayCity: '澳门', interests: ['摄影'] }
  await f.repo.put('fy-profiles', author.uid, { uid: author.uid, ...profile, pendingRevisionId: 'profile-candidate' })
  await f.repo.put('fy-profile-revisions', 'profile-candidate', { uid: author.uid, status: 'pending', bio: '未审核简介' })
  await f.repo.put('fy-profile-revisions', 'profile-history', { uid: author.uid, status: 'approved' })
  assert.equal((await ops.communityOverview(reviewer)).pendingProfiles, 1)
  const published = await f.post()
  await f.approve(published)
  await f.post(author, { postId: published.postId, baseRevision: published.revisionId, requestId: 'pending-edit' })
  const report = await c.communityReport(friend, { ...published, reason: 'Review post' })
  await c.communityResolveReport(reviewer, { reportId: report.id, reason: 'Reviewed' })
  const detail = await ops.communityUserDetail(admin, { targetUid: author.uid })
  for (const [field, value] of Object.entries(profile)) assert.deepEqual(detail[field], value)
  for (const [group, field] of [['pending', 'pendingPosts'], ['published', 'publishedPosts'],
    ['comments', 'pendingComments'], ['publicComments', 'publicComments'], ['reports', 'openReports'], ['resolvedReports', 'resolvedReports']]) {
    const page = await c.communityReviewList(admin, { group, targetUid: author.uid })
    assert.equal(detail[field], page.items.length, group)
  }
})

test('scoped mute and audit only return verified target history; failed writes leave no audit', async () => {
  const f = fixture(), c = f.community, ops = createCommunityOperations({ repo: f.repo })
  for (const { uid } of [author, stranger]) await f.repo.put('uni-id-users', uid, { status: 0, token: [] })
  const a = await f.post(), b = await f.post(stranger)
  f.failNextCommit()
  await assert.rejects(f.approve(a), /WRITE_FAILED/)
  assert.equal((await c.communityReviewList(reviewer, { group: 'audit' })).items.length, 0)
  assert.equal((await c.communityReviewDetail(reviewer, a)).selected.status, 'pending')
  await f.approve(a); await f.approve(b)
  const report = await c.communityReport(stranger, { ...a, reason: 'Check the content' })
  await c.communityResolveReport(reviewer, { reportId: report.id, reason: 'Reviewed' })
  await assert.rejects(c.communityMute(reviewer, { targetUid: author.uid, minutes: 43201, reason: 'a' }), /INVALID_DURATION/)
  await assert.rejects(c.communityMute(reviewer, { targetUid: author.uid, minutes: 0.5, reason: 'a' }), /INVALID_DURATION/)
  await c.communityMute(reviewer, { targetUid: author.uid, minutes: 43200, reason: 'a' })
  await c.communityMute(reviewer, { targetUid: stranger.uid, minutes: 1, reason: 'b' })
  await ops.communityAccountStatus(admin, { targetUid: author.uid, suspend: true, reason: 'Pause' })
  await f.repo.put('fy-community-audit', 'legacy', { action: 'post.approve', target: a.postId, order: '0000000000001-' + key('legacy') })
  const scoped = group => c.communityReviewList(reviewer, { group, targetUid: author.uid })
  assert.deepEqual((await scoped('mutes')).items.map(row => row.id), [author.uid])
  assert.deepEqual(new Set((await scoped('audit')).items.map(row => row.action)), new Set(['post.approve', 'report.resolve', 'user.mute', 'user.suspend']))
  assert.ok((await scoped('audit')).items.every(row => row.targetUid === author.uid))
  assert.ok((await c.communityReviewList(reviewer, { group: 'audit' })).items.some(row => row.id === 'legacy'))
})

test('author alone sees review reasons and whether an earlier version remains public', async () => {
  const f = fixture(), c = f.community
  const a = await f.post()
  await f.approve(a)
  const b = await f.post(author, { postId: a.postId, baseRevision: a.revisionId, requestId: 'edit' })
  await c.communityReviewPost(reviewer, { ...b, decision: 'reject', reason: 'Please revise' })
  const own = (await c.communityFeed(author, { tab: 'mine' })).items[0]
  assert.equal(own.status, 'rejected')
  assert.equal(own.reason, 'Please revise')
  assert.equal(own.hasPublicVersion, true)
  assert.equal((await c.communityPost(stranger, a)).hasPublicVersion, undefined)
  assert.deepEqual((await c.communityFeed(stranger, { tab: 'mine' })).items, [])
  await c.communityReviewPost(reviewer, { ...a, decision: 'remove', reason: 'Removed by operator' })
  const removed = await c.communityPost(author, { ...b, preview: true })
  assert.equal(removed.status, 'removed')
  assert.equal(removed.reason, 'Removed by operator')
  assert.equal(removed.hasPublicVersion, false)
  await assert.rejects(c.communityShare(null, a), /NOT_FOUND/)
})


test('competing reviewers commit only one post decision and audit event', async () => {
  const f = fixture(), c = f.community
  const version = await f.post()
  const results = await Promise.allSettled([
    c.communityReviewPost(admin, { ...version, decision: 'approve' }),
    c.communityReviewPost(reviewer, { ...version, decision: 'reject', reason: 'Changes requested' })
  ])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(results.find(r => r.status === 'rejected').reason.message, /STALE_VERSION/)
  assert.ok(f.conflicts() > 0)
  const { items } = await c.communityReviewList(reviewer, { group: 'audit', targetUid: author.uid })
  assert.equal(items.length, 1)
  assert.equal(items[0].revisionId, version.revisionId)
})

test('only one concurrent policy edit is saved; duplicate normalized words are rejected', async () => {
  const f = fixture(), c = f.community
  const rules = [{ word: '禁词', action: 'reject' }]
  const policy = { revision: 0, minSeconds: 10, maxPerWindow: 20, duplicateSeconds: 300, rules }
  await assert.rejects(c.communitySavePolicy(admin, { ...policy, rules: [...rules, { word: '禁 词', action: 'allow' }] }), /INVALID_POLICY/)
  const edits = await Promise.allSettled([c.communitySavePolicy(admin, policy), c.communitySavePolicy(admin, { ...policy, minSeconds: 15 })])
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(edits.find(r => r.status === 'rejected').reason.message, /CONFLICT/)
  assert.equal((await c.communityPolicy(reviewer)).revision, 1)
  assert.equal((await c.communityPolicy(reviewer)).canEdit, false)
  assert.equal((await c.communityReviewList(reviewer, { group: 'audit' })).items.length, 1)
})


test('rejection notices follow the author and latest version, and acknowledgments cannot cross accounts', async () => {
  const f = fixture(), c = f.community
  const first = await f.post()
  assert.deepEqual(await c.communityReviewNotices(author), { unread: 0 })
  await c.communityReviewPost(reviewer, { ...first, decision: 'reject', reason: '需要补充出处' })
  assert.deepEqual(await c.communityReviewNotices(author), { unread: 1 })
  assert.deepEqual(await c.communityReviewNotices(stranger), { unread: 0 })
  assert.equal((await c.communityFeed(author, { tab: 'mine' })).items[0].reviewUnread, true)
  await assert.rejects(c.communityReadReview(stranger, first), /NOT_FOUND/)
  await assert.rejects(c.communityReviewNotices(reviewer), /AUTH_REQUIRED/)
  const read = c.communityReadReview.bind(c)
  const tx = f.repo.tx
  f.repo.tx = async () => { throw new Error('NETWORK') }
  await assert.rejects(read(author, first), /NETWORK/)
  f.repo.tx = tx
  assert.equal((await c.communityReviewNotices(author)).unread, 1)
  await read(author, first)
  await read(author, first)
  assert.equal((await c.communityReviewNotices(author)).unread, 0)
  const edit = await f.post(author, { postId: first.postId, baseRevision: first.revisionId, requestId: 'retry' })
  await c.communityReviewPost(reviewer, { ...edit, decision: 'reject', reason: '请再次修改' })
  await read(author, first)
  assert.equal((await c.communityReviewNotices(author)).unread, 1)
  await c.communityRemoveOwn(author, edit)
  assert.equal((await c.communityReviewNotices(author)).unread, 0)
})

test('starter comment terms block specific abuse, queue ambiguous phrases and preserve custom policy', async () => {
  const f = fixture(), c = f.community
  const post = await f.post()
  await f.approve(post)
  const say = (body, requestId) => c.communityComment(friend, { ...post, body, requestId })
  await assert.rejects(say('你是个傻逼', 'abuse'), /COMMENT_REJECTED/)
  await assert.rejects(say('你 是 个 傻｜逼', 'obfuscated'), /COMMENT_REJECTED/)
  assert.equal((await say('学习如何识别刷单返利骗局', 'review')).status, 'pending')
  f.tick(11000)
  assert.equal((await say('澳门的非遗文化展览值得一看', 'culture')).status, 'public')
  await c.communitySavePolicy(admin, { revision: 0, minSeconds: 10, maxPerWindow: 20, duplicateSeconds: 300,
    rules: [{ word: '自定义广告', action: 'reject' }, { word: '刷单返利', action: 'allow' }] })
  await assert.rejects(c.communitySeedPolicy(reviewer, { revision: 1 }), /FORBIDDEN/)
  await c.communitySeedPolicy(admin, { revision: 1 })
  const policy = await c.communityPolicy(admin)
  assert.equal(policy.rules.find(r => r.word === '刷单返利').action, 'allow')
  assert.ok(policy.rules.some(r => r.word === '自定义广告'))
  assert.ok(policy.rules.some(r => r.word === '傻逼'))
  await assert.rejects(c.communitySeedPolicy(admin, { revision: 1 }), /CONFLICT/)
  assert.equal((await c.communitySeedPolicy(admin, { revision: 2 })).added, 0)
  const edited = { ...policy, minSeconds: 17, rules: [...policy.rules, { word: '未保存的新词', action: 'pending' }] }
  await c.communitySeedPolicy(admin, edited)
  const saved = await c.communityPolicy(admin)
  assert.equal(saved.minSeconds, 17)
  assert.ok(saved.rules.some(rule => rule.word === '未保存的新词'))
})

test('manual post and comment transitions notify verified authors once and synchronize exact rejection receipts',async()=>{
 const {createNotificationService}=require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')
 const f=fixture(), c=f.community, n=createNotificationService({repo:f.repo})
 const first=await f.post();await f.approve(first)
 let list=await n.notificationsList(author,{});assert.equal(list.items.length,1);assert.equal(list.items[0].kind,'community.post.approved');assert.equal((await n.notificationDetail(author,{id:list.items[0].id})).reason,'')
 const second=await f.post(author,{postId:first.postId,baseRevision:first.revisionId,requestId:'edit'})
 await c.communityReviewPost(reviewer,{...second,decision:'reject',reason:'修改',recipientUid:'stranger'})
 list=await n.notificationsList(author,{});const rejected=list.items.find(x=>x.kind==='community.post.rejected')
 await c.communityReadReview(author,second);assert.equal((await n.notificationDetail(author,{id:rejected.id})).read,true)
 const third=await f.post(author,{postId:first.postId,baseRevision:second.revisionId,requestId:'edit2'})
 await c.communityReviewPost(reviewer,{...third,decision:'reject',reason:'新版'})
 await n.notificationRead(author,{id:rejected.id});assert.equal((await f.repo.get('fy-community-versions',third.revisionId)).reviewSeen,false)
 await c.communityReviewPost(reviewer,{...first,decision:'remove',reason:'下架'})
 const removedTarget=(await n.notificationDetail(author,{id:(await n.notificationsList(author,{})).items.find(x=>x.kind==='community.post.removed').id})).target
 assert.deepEqual(removedTarget,{postId:first.postId,revisionId:first.revisionId,commentId:'',preview:true})
 assert.equal((await c.communityPost(author,removedTarget)).status,'removed')
 await assert.rejects(c.communityPost(stranger,removedTarget),/NOT_FOUND/)
 const other=await f.post(author,{requestId:'other'});await f.approve(other)
 for(const [id,status,decision] of [['c1','pending','approve'],['c2','pending','reject'],['c3','public','remove']]) {
  await f.repo.put('fy-community-comments',id,{uid:'friend',postId:other.postId,revisionId:other.revisionId,status})
  await c.communityReviewComment(reviewer,{commentId:id,decision,reason:decision==='approve'?'':'处理',recipientUid:'author'})
 }
 const messages=await n.notificationsList(friend,{});assert.equal(messages.items.length,3);assert.deepEqual(messages.items.map(x=>x.kind).sort(),['community.comment.approved','community.comment.rejected','community.comment.removed'])
 assert.equal((await n.notificationsSummary(stranger)).unread,0)
})
test('concurrent reviews, lost responses and notification failure preserve one atomic result',async()=>{
 const f=fixture(), p=await f.post()
 const outcomes=await Promise.allSettled([f.approve(p),f.approve(p)])
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1)
 assert.equal(await f.repo.count('fy-notifications',{}),1);assert.equal(await f.repo.count('fy-community-audit',{}),1)
 await assert.rejects(f.approve(p),/STALE_VERSION/);assert.equal(await f.repo.count('fy-notifications',{}),1)
 const q=await f.post(author,{requestId:'fail-notification'})
 const original=f.repo.tx
 f.repo.tx=fn=>original(async db=>fn({...db,put:async(c,id,v)=>{if(c==='fy-notifications')throw new Error('NOTIFICATION_FAILED');return db.put(c,id,v)}}))
 await assert.rejects(f.approve(q),/NOTIFICATION_FAILED/)
 assert.equal((await f.repo.get('fy-community-versions',q.revisionId)).status,'pending');assert.equal(await f.repo.count('fy-community-audit',{}),1)
 f.repo.tx=original;await f.approve(q);assert.equal(await f.repo.count('fy-notifications',{}),2)
})

test('committed moderation with lost response remains one notification and preserves its receipt on retry',async()=>{
 const {createNotificationService}=require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')
 const f=fixture(),p=await f.post(),n=createNotificationService({repo:f.repo})
 f.loseNextResponse();await assert.rejects(f.approve(p),/RESPONSE_LOST/)
 assert.equal((await f.repo.get('fy-community-versions',p.revisionId)).status,'approved')
 const list=await n.notificationsList(author,{});assert.equal(list.items.length,1);await n.notificationRead(author,{id:list.items[0].id})
 await assert.rejects(f.approve(p),/STALE_VERSION/);assert.equal(await f.repo.count('fy-community-audit',{}),1);assert.equal((await n.notificationsList(author,{})).items.length,1);assert.equal((await n.notificationDetail(author,{id:list.items[0].id})).read,true)
})
test('legacy rejected versions without notification still mark read and never synthesize historical messages',async()=>{
 const f=fixture(),p=await f.post()
 const v=await f.repo.get('fy-community-versions',p.revisionId)
 await f.repo.put('fy-community-versions',p.revisionId,{...v,status:'rejected',reason:'旧驳回'})
 await f.community.communityReadReview(author,p)
 assert.equal((await f.repo.get('fy-community-versions',p.revisionId)).reviewSeen,true);assert.equal(await f.repo.count('fy-notifications',{}),0)
})
