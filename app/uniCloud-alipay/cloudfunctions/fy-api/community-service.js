const { key } = require('./service')
const { createPartnershipService } = require('./partnership-service')
const { writeCommunityAudit: log } = require('./community-operations')
const { completedActivities, activityIds } = require('./culture')
const { defaults, fail, identifier, normalize, requiredText, validatePolicy, decide, consume } = require('./community-policy')

const posts = 'fy-community-posts'
const versions = 'fy-community-versions'
const comments = 'fy-community-comments'
const reactions = 'fy-community-reactions'
const reports = 'fy-community-reports'
const config = 'fy-community-config'
const limits = 'fy-community-limits'
const mutes = 'fy-community-mutes'
const audit = 'fy-community-audit'
const uploads = 'fy-community-uploads'
const maxImages = 9
const uploadLifetime = 24 * 3600000

const member = u => { if (!u?.uid || u.admin || u.reviewer) fail('AUTH_REQUIRED') }
const moderator = u => { if (!u?.admin && !u?.reviewer) fail('FORBIDDEN') }
const isPublic = post => post?.status === 'public' && !!post.publicRevision
const valid = (id, code = 'NOT_FOUND') => { if (!identifier(id)) fail(code); return id }
const cursorKey = (at, id) => String(at).padStart(13, '0') + '-' + id
const mediaItems = version => Array.isArray(version.media) ? version.media : version.media ? [version.media] : []
const imageFields = version => ({ hasImage: mediaItems(version).length > 0, imageCount: mediaItems(version).length })
function optionalText(value, max) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > max) fail('INVALID_CONTENT')
  return value.trim()
}
async function stagingOperation(operation) {
  try {
    return await operation()
  } catch (error) {
    // Keep the provider conflict visible to the repository's transaction retry.
    if (/conflict/i.test(String(error?.code) + ' ' + String(error?.message))) throw error
    fail('UPLOAD_STAGING_UNAVAILABLE')
  }
}
const revisionView = v => ({
  id: v._id, title: v.title, body: v.body, ...imageFields(v), status: v.status,
  reason: v.reason ?? '', createdAt: v.createdAt
})
const commentView = c => ({
  id: c._id, postId: c.postId, parentId: c.parentId, author: c.author,
  body: c.body, status: c.status, createdAt: c.createdAt
})

function createCommunityService({ repo, media, now = Date.now }) {
  const { ensureProfile } = createPartnershipService({ repo, now })
  async function postBy(db, id) {
    const post = await db.get(posts, valid(id))
    if (!post) fail('NOT_FOUND')
    return post
  }

  async function versionBy(db, post, revisionId) {
    const revision = await db.get(versions, valid(revisionId))
    if (!revision || revision.postId !== post._id || revision.uid !== post.uid) fail('NOT_FOUND')
    return revision
  }

  async function visible(db, u, p) {
    const post = await postBy(db, p.postId)
    if (p.preview === true && p.revisionId && post.uid === u?.uid) {
      return { post, version: await versionBy(db, post, p.revisionId) }
    }
    if (!isPublic(post) || (p.revisionId && p.revisionId !== post.publicRevision)) fail('NOT_FOUND')
    const version = await versionBy(db, post, post.publicRevision)
    if (version.status !== 'approved') fail('NOT_FOUND')
    return { post, version }
  }

  async function reviewVersion(u, p) {
    moderator(u)
    const post = await postBy(repo, p.postId)
    return { post, version: await versionBy(repo, post, p.revisionId) }
  }

  async function writable(db, uid, at) {
    const account = await db.get('uni-id-users', uid)
    if (account && account.status !== 0) fail('ACCOUNT_DISABLED')
    const mute = await db.get(mutes, uid)
    if (mute?.until > at) fail('COMMUNITY_MUTED')
  }

  async function hide(db, post, status, reason = '') {
    const latest = await versionBy(db, post, post.latestRevision)
    if (latest.status === 'pending') await db.put(versions, latest._id, { ...latest, status: 'withdrawn' })
    await db.put(posts, post._id, { ...post, status, publicRevision: '', removalReason: reason })
  }

  async function profile(uid) {
    return (await repo.list('fy-profiles', { uid }))[0] ?? {}
  }

  async function baseView(post, version, u) {
    const publicView = isPublic(post) && post.publicRevision === version._id && version.status === 'approved'
    const author = await profile(post.uid)
    return {
      id: post._id, revisionId: version._id, title: version.title,
      ...imageFields(version), author: author.nickname ?? post.author, owner: u?.uid === post.uid, publicView,
      authorCode: typeof author.code === 'string' ? author.code : '',
      authorAvatar: typeof author.avatar === 'string' && /^https:\/\//i.test(author.avatar) ? author.avatar : '',
      status: post.status === 'removed' || post.status === 'deleted' ? post.status : version.status,
      latestRevision: u?.uid === post.uid ? post.latestRevision : '',
      reason: u?.uid === post.uid ? post.removalReason ?? version.reason ?? '' : '',
      commentCount: publicView ? post.commentCount : 0, likeCount: publicView ? post.likeCount : 0
    }
  }

  async function page(collection, query, cursor, size = 20) {
    if (cursor && !/^[0-9]{13}-[a-f0-9]{64}$/.test(cursor)) fail('INVALID_CURSOR')
    const rows = await repo.page(collection, query, { field: 'order', before: cursor || null, size: size + 1 })
    return { rows: rows.slice(0, size), next: rows.length > size ? rows[size - 1].order : '' }
  }

  async function* all(collection, query) {
    let after = null
    while (true) {
      const rows = await repo.page(collection, query, { field: '_id', after, size: 100 })
      for (const row of rows) yield row
      if (rows.length < 100) return
      after = rows.at(-1)._id
    }
  }

  async function friendIds(uid) {
    const ids = new Set()
    for (const [field, other] of [['from', 'to'], ['to', 'from']]) {
      for await (const row of all('fy-friends', { [field]: uid, status: 'accepted' })) ids.add(row[other])
    }
    return [...ids]
  }

  async function readImage(u, p, review) {
    const lookup = review ? reviewVersion : (user, payload) => visible(repo, user, payload)
    const { version } = await lookup(u, p)
    const index = p.index ?? 0
    const items = mediaItems(version)
    if (!p.revisionId || !Number.isInteger(index) || index < 0 || index >= items.length) fail('NOT_FOUND')
    const result = await media.read(items[index])
    await lookup(u, p)
    return result
  }

  async function resolveImage(u, p) {
    const source = p.imageSource ?? 'none'
    if (source === 'none') return null
    if (source === 'upload') return media.fromUpload(p.base64)
    if (source === 'diary') {
      const diary = await repo.get('fy-diary', valid(p.diaryId))
      if (!diary || diary.uid !== u.uid) fail('NOT_FOUND')
      return media.fromDiary(u, diary)
    }
    fail('INVALID_IMAGE')
  }

  function submission(u, p) {
    const request = valid(p.requestId, 'INVALID_REQUEST')
    const postId = p.postId ? valid(p.postId) : key('community-post', u.uid, request)
    const baseRevision = p.postId ? valid(p.baseRevision, 'STALE_VERSION') : ''
    return { postId, baseRevision, revisionId: key('community-version', postId, u.uid, request) }
  }

  async function editable(db, u, p, scope) {
    if (!p.postId) return null
    const post = await postBy(db, scope.postId)
    if (post.uid !== u.uid) fail('NOT_FOUND')
    if (post.latestRevision !== scope.baseRevision || ['removed', 'deleted'].includes(post.status)) fail('STALE_VERSION')
    return post
  }

  function galleryInput(images) {
    if (!Array.isArray(images) || images.length > maxImages) fail('INVALID_IMAGES')
    const seen = new Set()
    return images.map(item => {
      let value
      if (identifier(item?.uploadId) && item.keepIndex == null) value = { uploadId: item.uploadId }
      else if (Number.isInteger(item?.keepIndex) && item.keepIndex >= 0 && item.keepIndex < maxImages && item.uploadId == null) value = { keepIndex: item.keepIndex }
      else fail('INVALID_IMAGES')
      const id = JSON.stringify(value)
      if (seen.has(id)) fail('INVALID_IMAGES')
      seen.add(id)
      return value
    })
  }

  async function galleryMedia(db, u, scope, previous, gallery, at) {
    const originals = previous ? mediaItems(previous) : []
    const images = []
    for (const item of gallery) {
      if (item.uploadId) {
        const row = await stagingOperation(() => db.get(uploads, item.uploadId))
        if (!row || row.uid !== u.uid || row.revisionId !== scope.revisionId || row.baseRevision !== scope.baseRevision || row.expiresAt <= at) fail('UPLOAD_NOT_AVAILABLE')
        images.push(row.media)
      } else {
        if (!originals[item.keepIndex]) fail('INVALID_IMAGES')
        images.push(originals[item.keepIndex])
      }
    }
    return images
  }

  return {
    async communityStageImage(u, p) {
      member(u)
      const scope = submission(u, p)
      const slot = valid(p.slot, 'INVALID_REQUEST')
      const uploadId = key('community-upload', scope.revisionId, slot)
      if (!['upload', 'diary'].includes(p.imageSource)) fail('INVALID_IMAGE')
      if (p.imageSource === 'upload' && (typeof p.base64 !== 'string' || p.base64.length > 1400000)) fail('INVALID_IMAGE')
      if (p.imageSource === 'diary') valid(p.diaryId)
      const fingerprint = key(p.imageSource, p.imageSource === 'diary' ? p.diaryId : p.base64)
      const result = row => {
        if (row.fingerprint !== fingerprint || row.baseRevision !== scope.baseRevision) fail('REQUEST_CONFLICT')
        return { uploadId }
      }
      const prior = await stagingOperation(() => repo.get(uploads, uploadId))
      if (prior?.expiresAt > now()) return result(prior)
      await editable(repo, u, p, scope)
      await writable(repo, u.uid, now())
      if (await repo.get(versions, scope.revisionId)) fail('STALE_VERSION')
      const copy = await media.store(await resolveImage(u, p), u.uid)
      try {
        const saved = await repo.tx(async db => {
          const old = await stagingOperation(() => db.get(uploads, uploadId))
          const at = now()
          if (old?.expiresAt > at) { result(old); return false }
          await writable(db, u.uid, at)
          await editable(db, u, p, scope)
          if (await db.get(versions, scope.revisionId)) fail('STALE_VERSION')
          await stagingOperation(() => db.put(uploads, uploadId, { ...scope, uid: u.uid, fingerprint, media: copy, expiresAt: at + uploadLifetime }))
          return true
        })
        if (!saved) await media.discard(copy)
        return { uploadId }
      } catch (error) {
        try {
          const saved = await repo.get(uploads, uploadId)
          if (saved?.media?.fileID !== copy.fileID) await media.discard(copy)
        } catch (_) { /* The committed file may still be referenced. */ }
        throw error
      }
    },

    async communitySubmit(u, p) {
      member(u)
      const title = optionalText(p.title, 80), body = optionalText(p.body, 2000)
      const scope = submission(u, p)
      const { postId, revisionId } = scope
      const gallery = p.images === undefined ? null : galleryInput(p.images)
      const source = p.imageSource ?? 'none'
      if (!['none', 'upload', 'diary', 'keep'].includes(source)) fail('INVALID_IMAGE')
      if (source === 'upload' && (typeof p.base64 !== 'string' || p.base64.length > 1400000)) fail('INVALID_IMAGE')
      if (source === 'diary') valid(p.diaryId)
      const fingerprint = gallery
        ? key(title, body, scope.baseRevision, gallery)
        : key(title, body, scope.baseRevision, source, source === 'diary' ? p.diaryId : '', source === 'upload' ? p.base64 : '')
      const result = { postId, revisionId }
      function replay(version) {
        if (version.fingerprint !== fingerprint) fail('REQUEST_CONFLICT')
        return result
      }
      const existing = p.postId ? await postBy(repo, postId) : null
      if (existing && existing.uid !== u.uid) fail('NOT_FOUND')
      const prior = await repo.get(versions, revisionId)
      if (prior) return replay(prior)
      await writable(repo, u.uid, now())
      if (existing && (existing.latestRevision !== p.baseRevision || ['removed', 'deleted'].includes(existing.status))) fail('STALE_VERSION')
      if (!gallery && source === 'keep' && !existing) fail('INVALID_IMAGE')
      const keep = !gallery && source === 'keep'
      const image = gallery || keep ? null : await resolveImage(u, p)
      if (!title && !body && !(gallery?.length || image || keep)) fail('INVALID_CONTENT')
      const author = (await ensureProfile(u)).nickname ?? '旅伴'
      const copy = image ? await media.store(image, u.uid) : null
      try {
        const committed = await repo.tx(async db => {
          const post = await db.get(posts, postId)
          const old = await db.get(versions, revisionId)
          if (old) { replay(old); return false }
          const at = now()
          await writable(db, u.uid, at)
          const guard = await db.get(limits, u.uid)
          await db.put(limits, u.uid, { ...guard, lastPostAt: at })
          let previous = null
          if (p.postId) {
            if (!post || post.uid !== u.uid) fail('NOT_FOUND')
            if (post.latestRevision !== p.baseRevision || ['removed', 'deleted'].includes(post.status)) fail('STALE_VERSION')
            previous = await versionBy(db, post, post.latestRevision)
            if (previous.status === 'pending') await db.put(versions, previous._id, { ...previous, status: 'superseded' })
          } else if (post) fail('REQUEST_CONFLICT')
          const images = gallery ? await galleryMedia(db, u, scope, previous, gallery, at) : keep ? mediaItems(previous) : copy
          if (!title && !body && !mediaItems({ media: images }).length) fail('INVALID_CONTENT')
          await db.put(versions, revisionId, {
            postId, uid: u.uid, title, body, media: images, status: 'pending', fingerprint,
            createdAt: at, order: cursorKey(at, revisionId)
          })
          await db.put(posts, postId, {
            ...(post ?? { uid: u.uid, author, status: 'unpublished', publicRevision: '', commentCount: 0, likeCount: 0 }),
            latestRevision: revisionId, order: post?.order ?? cursorKey(at, postId)
          })
          return true
        })
        if (!committed && copy) await media.discard(copy)
        return result
      } catch (error) {
        // A commit response can be lost. Preserve any copy referenced by the committed version.
        if (copy) {
          try {
            const stored = await repo.get(versions, revisionId)
            if (stored?.media?.fileID !== copy.fileID) await media.discard(copy)
          } catch (_) { /* Leave the encrypted file for reconciliation. */ }
        }
        throw error
      }
    },

    async communityFeed(u, p) {
      let query = { status: 'public' }
      if (p.tab === 'mine') {
        member(u)
        query = { uid: u.uid }
      } else if (p.tab === 'friends') {
        member(u)
        const ids = await friendIds(u.uid)
        if (!ids.length) return { items: [], next: '' }
        query.uid = ids
      } else if (p.tab === 'saved') {
        member(u)
        const { rows, next } = await page(reactions, { uid: u.uid, kind: 'favorite', active: true }, p.cursor)
        const items = await Promise.all(rows.map(async row => {
          try {
            const { post, version } = await visible(repo, u, { postId: row.postId })
            return baseView(post, version, u)
          } catch (error) { if (error.message !== 'NOT_FOUND') throw error; return null }
        }))
        return { items: items.filter(Boolean), next }
      }
      const { rows, next } = await page(posts, query, p.cursor)
      const items = await Promise.all(rows.map(async row => {
        try {
          const { post, version } = await visible(repo, u, {
            postId: row._id, revisionId: p.tab === 'mine' ? row.latestRevision : undefined, preview: p.tab === 'mine'
          })
          return baseView(post, version, u)
        } catch (error) { if (error.message !== 'NOT_FOUND') throw error; return null }
      }))
      return { items: items.filter(Boolean), next }
    },

    async communityPost(u, p) {
      const { post, version } = await visible(repo, u, p)
      const view = { ...await baseView(post, version, u), body: version.body }
      if (!view.publicView) return { ...view, liked: false, saved: false }
      const state = async kind => u?.uid && (await repo.get(reactions, key(u.uid, post._id, kind)))?.active === true
      const [liked, saved] = await Promise.all([state('like'), state('favorite')])
      return { ...view, liked: !!liked, saved: !!saved }
    },

    async communityImage(u, p) { return readImage(u, p, false) },
    async communityReviewImage(u, p) { return readImage(u, p, true) },

    async communityShare(u, p) {
      const { post, version } = await visible(repo, null, { postId: p.postId })
      return { postId: post._id, title: version.title || (mediaItems(version).length ? '图片动态' : '文字动态') }
    },

    async communityReaction(u, p) {
      member(u)
      if (!['like', 'favorite'].includes(p.kind) || typeof p.active !== 'boolean') fail('INVALID_REQUEST')
      return repo.tx(async db => {
        const { post } = await visible(db, null, p)
        const id = key(u.uid, post._id, p.kind)
        const old = await db.get(reactions, id)
        if ((old?.active ?? false) === p.active) return {}
        await db.put(reactions, id, {
          uid: u.uid, postId: post._id, kind: p.kind, active: p.active,
          order: cursorKey(now(), id)
        })
        if (p.kind === 'like') await db.put(posts, post._id, { ...post, likeCount: post.likeCount + (p.active ? 1 : -1) })
        return {}
      })
    },

    async communityComments(u, p) {
      const { post } = await visible(repo, null, p)
      const { rows, next } = await page(comments, { postId: post._id, status: 'public' }, p.cursor)
      const mine = u?.uid && !p.cursor ? await page(comments, { postId: post._id, uid: u.uid, status: ['pending', 'rejected'] }, '') : null
      await visible(repo, null, p)
      return {
        items: rows.map(commentView), next,
        mine: (mine?.rows ?? []).map(c => ({ ...commentView(c), reason: c.reason ?? '' }))
      }
    },

    async communityComment(u, p) {
      member(u)
      const body = requiredText(p.body, 500), normalized = normalize(body)
      if (!normalized) fail('INVALID_COMMENT')
      const parentId = p.parentId ? valid(p.parentId) : ''
      const author = (await profile(u.uid)).nickname ?? '旅伴'
      const request = valid(p.requestId, 'INVALID_REQUEST')
      return repo.tx(async db => {
        const { post } = await visible(db, null, p)
        const id = key('comment', u.uid, post._id, request)
        const old = await db.get(comments, id)
        if (old) {
          if (old.body !== body || old.parentId !== parentId) fail('REQUEST_CONFLICT')
          return { id, status: old.status }
        }
        if (parentId) {
          const parent = await db.get(comments, parentId)
          if (!parent || parent.postId !== post._id || parent.status !== 'public') fail('NOT_FOUND')
        }
        const at = now()
        await writable(db, u.uid, at)
        const policy = await db.get(config, 'comments') ?? defaults
        const status = decide(policy, normalized)
        const previous = await db.get(limits, u.uid)
        const state = consume(previous, policy, at, key(normalized))
        await db.put(limits, u.uid, { ...previous, ...state })
        await db.put(comments, id, {
          postId: post._id, revisionId: post.publicRevision, uid: u.uid, author, body,
          parentId, status, createdAt: at, order: cursorKey(at, id)
        })
        // Pending replies also conflict with a concurrent removal of the post or parent.
        await db.put(posts, post._id, { ...post, commentCount: post.commentCount + (status === 'public' ? 1 : 0) })
        return { id, status }
      })
    },

    async communityReport(u, p) {
      member(u)
      const reason = requiredText(p.reason, 300)
      return repo.tx(async db => {
        const { post } = await visible(db, null, p)
        let comment = null
        if (p.commentId) {
          comment = await db.get(comments, valid(p.commentId))
          if (comment?.postId !== post._id || comment.status !== 'public') fail('NOT_FOUND')
        }
        const target = comment?._id ?? post.publicRevision
        const id = key('report', u.uid, target)
        if (await db.get(reports, id)) return { id }
        const at = now()
        await db.put(reports, id, {
          reporter: u.uid, targetUid: comment?.uid ?? post.uid, postId: post._id,
          revisionId: comment?.revisionId ?? post.publicRevision, commentId: comment?._id ?? '',
          reason, status: 'open', createdAt: at, order: cursorKey(at, id)
        })
        return { id }
      })
    },

    async communityRanking(u) {
      member(u)
      const ids = [u.uid, ...await friendIds(u.uid)]
      const rows = []
      for (const uid of new Set(ids)) {
        if (uid !== u.uid && (await repo.get('uni-id-users', uid))?.status !== 0) continue
        const completed = new Set()
        for await (const run of all('fy-runs', { uid })) {
          if ((run.purpose ?? 'solo') !== 'solo' || completed.has(run.routeId)) continue
          const nodes = run.snapshot?.nodes ?? []
          const activities = activityIds.filter(id => run.snapshot?.culture?.[id])
          if (!nodes.length || !activities.every(id => completedActivities(run).includes(id))) continue
          const checks = await repo.list('fy-checkins', { uid, runId: run._id })
          const visited = new Set(checks.map(check => check.nodeId))
          if (nodes.every(node => visited.has(node.id))) completed.add(run.routeId)
        }
        const p = await profile(uid)
        rows.push({ nickname: p.nickname ?? '旅伴', code: p.code ?? '', mine: uid === u.uid, count: completed.size })
      }
      rows.sort((a, b) => b.count - a.count || Number(b.mine) - Number(a.mine) || a.code.localeCompare(b.code))
      let rank = 0
      return rows.map((row, i) => {
        if (i === 0 || row.count !== rows[i - 1].count) rank = i + 1
        return { ...row, rank }
      })
    },

    async communityRemoveOwn(u, p) {
      member(u)
      return repo.tx(async db => {
        const post = await postBy(db, p.postId)
        if (post.uid !== u.uid) fail('NOT_FOUND')
        if (post.status === 'deleted') return {}
        if (post.latestRevision !== p.revisionId) fail('STALE_VERSION')
        await hide(db, post, 'deleted')
        return {}
      })
    },

    async communityReviewList(u, p) {
      moderator(u)
      const group = p.group
      const userFilter = p.targetUid ? { uid: valid(p.targetUid) } : {}
      const reportFilter = p.targetUid ? { targetUid: valid(p.targetUid) } : {}
      let result
      if (group === 'pending') {
        result = await page(versions, { status: 'pending', ...userFilter }, p.cursor)
        result.rows = (await Promise.all(result.rows.map(async v => {
          const post = await repo.get(posts, v.postId)
          if (!post || post.latestRevision !== v._id || ['removed', 'deleted'].includes(post.status)) return null
          return { ...revisionView(v), postId: v.postId, revisionId: v._id, author: post.author }
        }))).filter(Boolean)
      } else if (group === 'published') {
        result = await page(posts, { status: 'public', ...userFilter }, p.cursor)
        result.rows = (await Promise.all(result.rows.map(async post => {
          try {
            const { post: current, version } = await visible(repo, null, { postId: post._id })
            return { ...revisionView(version), postId: current._id, revisionId: version._id, author: current.author }
          } catch (error) { if (error.message !== 'NOT_FOUND') throw error; return null }
        }))).filter(Boolean)
      } else if (group === 'comments' || group === 'publicComments') {
        result = await page(comments, { status: group === 'comments' ? 'pending' : 'public', ...userFilter }, p.cursor)
        result.rows = result.rows.map(c => ({ ...commentView(c), targetUid: c.uid, revisionId: c.revisionId }))
      } else if (group === 'reports' || group === 'resolvedReports') {
        result = await page(reports, { status: group === 'reports' ? 'open' : 'resolved', ...reportFilter }, p.cursor)
        result.rows = result.rows.map(({ _id, order, ...row }) => ({ ...row, id: _id }))
      } else if (group === 'audit') {
        result = await page(audit, {}, p.cursor)
        result.rows = result.rows.map(({ _id, order, ...row }) => ({ ...row, id: _id }))
      } else if (group === 'mutes') {
        result = await page(mutes, {}, p.cursor)
        result.rows = result.rows.map(row => ({
          id: row._id, targetUid: row._id, author: row.author, reason: row.reason,
          until: row.until, status: row.until > now() ? 'muted' : 'expired'
        }))
      } else fail('INVALID_REQUEST')
      return { items: result.rows, next: result.next }
    },

    async communityReviewDetail(u, p) {
      const { post, version } = await reviewVersion(u, p)
      const current = isPublic(post) ? await versionBy(repo, post, post.publicRevision) : null
      let reportedComment = null
      if (p.commentId) {
        const comment = await repo.get(comments, valid(p.commentId))
        if (comment?.postId !== post._id) fail('NOT_FOUND')
        reportedComment = { ...commentView(comment), targetUid: comment.uid }
      }
      return {
        postId: post._id, status: post.status, targetUid: post.uid, author: post.author, latestRevision: post.latestRevision,
        selected: revisionView(version), current: current ? revisionView(current) : null, reportedComment
      }
    },

    async communityReviewPost(u, p) {
      moderator(u)
      const action = p.decision
      if (!['approve', 'reject', 'remove'].includes(action)) fail('INVALID_REQUEST')
      const reason = action === 'approve' && !p.reason ? '' : requiredText(p.reason, 300)
      return repo.tx(async db => {
        const post = await postBy(db, p.postId)
        const version = await versionBy(db, post, p.revisionId)
        const at = now()
        if (action === 'remove') {
          if (!isPublic(post) || post.publicRevision !== version._id) fail('STALE_VERSION')
          await hide(db, post, 'removed', reason)
        } else {
          if (post.latestRevision !== version._id || version.status !== 'pending' || ['removed', 'deleted'].includes(post.status)) fail('STALE_VERSION')
          const approved = action === 'approve'
          await db.put(versions, version._id, { ...version, status: approved ? 'approved' : 'rejected', reason })
          if (approved) await db.put(posts, post._id, { ...post, status: 'public', publicRevision: version._id })
        }
        await log(db, u, 'post.' + action, post._id, { revisionId: version._id, reason }, at)
        return {}
      })
    },

    async communityReviewComment(u, p) {
      moderator(u)
      const next = { approve: 'public', reject: 'rejected', remove: 'removed' }[p.decision]
      if (!['public', 'rejected', 'removed'].includes(next)) fail('INVALID_REQUEST')
      const reason = p.decision === 'approve' && !p.reason ? '' : requiredText(p.reason, 300)
      return repo.tx(async db => {
        const comment = await db.get(comments, valid(p.commentId))
        if (!comment) fail('NOT_FOUND')
        const before = p.decision === 'remove' ? 'public' : 'pending'
        if (comment.status !== before) fail('NOT_PENDING')
        const post = await postBy(db, comment.postId)
        if (next === 'public' && !isPublic(post)) fail('NOT_FOUND')
        await db.put(comments, comment._id, { ...comment, status: next, reason })
        const delta = next === 'public' ? 1 : before === 'public' ? -1 : 0
        if (delta) await db.put(posts, post._id, { ...post, commentCount: post.commentCount + delta })
        await log(db, u, 'comment.' + p.decision, comment._id, { revisionId: comment.revisionId, reason }, now())
        return {}
      })
    },

    async communityResolveReport(u, p) {
      moderator(u)
      const reason = requiredText(p.reason, 300)
      return repo.tx(async db => {
        const report = await db.get(reports, valid(p.reportId))
        if (!report) fail('NOT_FOUND')
        if (report.status !== 'open') fail('NOT_PENDING')
        const at = now()
        await db.put(reports, report._id, { ...report, status: 'resolved', resolution: reason, resolvedAt: at })
        await log(db, u, 'report.resolve', report._id, { revisionId: report.revisionId, reason }, at)
        return {}
      })
    },

    async communityMute(u, p) {
      moderator(u)
      const uid = valid(p.targetUid)
      const reason = requiredText(p.reason, 300)
      if (!Number.isInteger(p.minutes) || p.minutes < 0 || p.minutes > 43200) fail('INVALID_DURATION')
      const author = (await profile(uid)).nickname ?? '旅伴'
      return repo.tx(async db => {
        if (!await db.get('uni-id-users', uid)) fail('NOT_FOUND')
        const at = now()
        const until = p.minutes ? at + p.minutes * 60000 : 0
        const state = await db.get(limits, uid)
        // Serialize against comment writes and against the per-author submission guard.
        await db.put(limits, uid, { ...(state ?? {}), muteChangedAt: at })
        await db.put(mutes, uid, { until, reason, actor: u.uid, author, order: cursorKey(at, key('mute', uid)) })
        await log(db, u, until ? 'user.mute' : 'user.unmute', uid, { reason, until }, at)
        return { until }
      })
    },

    async communityPolicy(u) {
      moderator(u)
      const { _id, ...policy } = await repo.get(config, 'comments') ?? defaults
      return { ...policy, canEdit: !!u.admin }
    },

    async communitySavePolicy(u, p) {
      if (!u?.admin) fail('FORBIDDEN')
      const value = validatePolicy(p)
      return repo.tx(async db => {
        const old = await db.get(config, 'comments') ?? defaults
        if (old.revision !== p.revision) fail('CONFLICT')
        const revision = old.revision + 1
        await db.put(config, 'comments', { ...value, revision })
        const { _id, ...previous } = old
        await log(db, u, 'policy.save', 'comments', { revision, previous, value }, now())
        return { revision }
      })
    }
  }
}
module.exports = { createCommunityService }
