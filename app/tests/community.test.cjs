const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRepository } = require('../uniCloud-alipay/cloudfunctions/fy-api/repository')
const { createCommunityService } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-service')
const { createCommunityMedia, sanitize } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-media')
const { createCommunityOperations } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-operations')
const { encrypt, decrypt, authenticate } = require('../uniCloud-alipay/cloudfunctions/fy-api/security')
const { createService, key } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')

const author = { uid: 'author' }, friend = { uid: 'friend' }, stranger = { uid: 'stranger' }
const reviewer = { uid: 'reviewer', reviewer: true }, admin = { uid: 'admin', admin: true }
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='

function fixture() {
  const rows = new Map(), files = new Map()
  let clock = 1784000000000
  let conflicts = 0
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
          for (const path of writes.keys()) {
            if (snapshot.get(path) !== rows.get(path)) { conflicts++; throw new Error('WRITE_CONFLICT') }
          }
          for (const [path, value] of writes) rows.set(path, value)
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
  return { repo, community, media, service, cloud, post, approve, mediaKey, files, conflicts: () => conflicts, tick: value => { clock += value } }
}

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
  for (let i = 2; i <= 9; i++) photos.push(await stage('slot-' + i))
  assert.equal(f.files.size, 9)
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
  assert.equal(f.files.size, 9)
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
