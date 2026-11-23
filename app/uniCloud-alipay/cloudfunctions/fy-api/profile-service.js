const { createHash } = require('node:crypto')
const { key } = require('./service')
const { createPartnershipService } = require('./partnership-service')
const { fail, identifier } = require('./community-policy')
const { profiles, accounts, findProfile, profileFields, legacyAvatar } = require('./profile-presenter')
const { validateCursor } = require('./community-review-queue')
const { writeCommunityAudit } = require('./community-operations')
const { writeProfileReviewNotification } = require('./profile-notification-events')

const revisions = 'fy-profile-revisions'
const uploads = 'fy-profile-uploads'
const hour = 3600000
const interestsAllowed = new Set(['湘绣', '瓷器', '传统建筑', '非遗美食', '博物馆', '摄影'])
const moderator = user => { if (!user?.uid || !(user.admin || user.reviewer)) fail('FORBIDDEN') }

function text(value, min, max, code) {
  if (value == null && min === 0) return ''
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value)) fail(code)
  const trimmed = value.trim()
  const length = [...trimmed].length
  if (length < min || length > max) fail(code)
  return trimmed
}

function submission(p) {
  if (!identifier(p.requestId) || !Number.isSafeInteger(p.baseRevision) || p.baseRevision < 0 ||
      (p.avatarUploadId != null && !identifier(p.avatarUploadId)) ||
      (p.avatarRevisionId != null && !identifier(p.avatarRevisionId)) ||
      (p.resetAvatar != null && typeof p.resetAvatar !== 'boolean') ||
      [p.resetAvatar, p.avatarUploadId, p.avatarRevisionId].filter(Boolean).length > 1) fail('INVALID_REQUEST')
  const interests = p.interests ?? []
  if (!Array.isArray(interests) || interests.length > 3 || new Set(interests).size !== interests.length ||
      interests.some(item => !interestsAllowed.has(item))) fail('INVALID_INTERESTS')
  return {
    baseRevision: p.baseRevision, nickname: text(p.nickname, 2, 20, 'INVALID_NICKNAME'),
    bio: text(p.bio, 0, 80, 'INVALID_BIO'), displayCity: text(p.displayCity, 0, 20, 'INVALID_CITY'),
    interests, avatarUploadId: p.avatarUploadId ?? '', avatarRevisionId: p.avatarRevisionId ?? '', resetAvatar: p.resetAvatar === true
  }
}

function revisionView(row) {
  if (!row) return null
  const { nickname, bio, displayCity, interests, avatarMedia } = row.snapshot
  return {
    revisionId: row._id, nickname, bio, displayCity, interests, hasAvatar: !!avatarMedia, avatar: legacyAvatar(row.snapshot),
    baseRevision: row.baseRevision, status: row.status, createdAt: row.createdAt, reason: row.reason ?? ''
  }
}

async function active(db, uid) {
  const account = await db.get(accounts, uid)
  if (!account) fail('AUTH_REQUIRED')
  if (account.status !== 0) fail('ACCOUNT_DISABLED')
}

async function own(db, user) {
  if (!user?.uid || user.admin || user.reviewer) fail('AUTH_REQUIRED')
  await active(db, user.uid)
  return user.uid
}

async function guardAccount(db, uid) {
  // Serialize with operations' suspend/restore without touching login tokens.
  const collection = 'fy-community-limits'
  const guard = await db.get(collection, uid)
  await db.put(collection, uid, { ...guard, profileWrites: (guard?.profileWrites ?? 0) + 1 })
  await active(db, uid)
}

async function profileStorage(operation) {
  try {
    return await operation()
  } catch (error) {
    const code = error?.code ?? error?.errCode
    const message = String(error?.message ?? error?.errMsg ?? '')
    if (['DATABASE_COLLECTION_NOT_EXIST', 'DATABASE_COLLECTION_NOT_FOUND'].includes(code) ||
        /(?:collection|集合|数据表).{0,120}(?:not found|not exist|missing|不存在)|NamespaceNotFound/i.test(message)) {
      fail('PROFILE_STORAGE_UNAVAILABLE')
    }
    throw error
  }
}

function createProfileService({ repo, media, now = Date.now }) {
  const { ensureProfile } = createPartnershipService({ repo, now })

  async function loadProfile(user) {
    const uid = await own(repo, user)
    let profile = await findProfile(repo, uid)
    if (!profile) {
      await ensureProfile(user)
      profile = await findProfile(repo, uid)
      await active(repo, uid)
    }
    if (!profile) fail('NOT_FOUND')
    return profile
  }

  function replay(upload, digest) {
    if (upload.digest !== digest) fail('REQUEST_CONFLICT')
    return { uploadId: upload._id }
  }

  async function candidate(db, id) {
    const row = identifier(id) ? await db.get(revisions, id) : null
    if (!row) fail('NOT_FOUND')
    return row
  }

  async function publicAvatar(p) {
    if (typeof p.code !== 'string' || !/^[A-Z2-9]{8}$/.test(p.code) ||
        typeof p.avatarVersion !== 'string' || !/^[a-f0-9]{64}$/.test(p.avatarVersion)) fail('NOT_FOUND')
    const matches = await repo.list(profiles, { code: p.code })
    const profile = matches[0]
    if (matches.length !== 1 || profile.avatarVersion !== p.avatarVersion || !profile.avatarMedia ||
        (await repo.get(accounts, profile.uid))?.status !== 0) fail('NOT_FOUND')
    return profile
  }

  return {
    async getMyProfile(user) {
      const profile = await loadProfile(user)
      const pending = profile.pendingRevisionId ? await repo.get(revisions, profile.pendingRevisionId) : null
      const latest = !pending && profile.latestProfileRevisionId ? await repo.get(revisions, profile.latestProfileRevisionId) : null
      return {
        ...profileFields(profile), avatar: legacyAvatar(profile), pending: pending?.uid === profile.uid ? revisionView(pending) : null,
        latest: latest?.uid === profile.uid ? revisionView(latest) : null
      }
    },

    async profileStageAvatar(user, p) {
      const uid = await own(repo, user)
      if (!identifier(p.requestId)) fail('INVALID_REQUEST')
      const image = await media.fromUpload(p.base64)
      if (!['image/jpeg', 'image/png'].includes(image.mime) || image.bytes.length > 1024 * 1024) fail('INVALID_IMAGE')
      const digest = createHash('sha256').update(image.mime).update(image.bytes).digest('hex')
      const id = key('profile-upload', uid, p.requestId)
      const existing = await profileStorage(() => repo.get(uploads, id))
      if (existing) return replay(existing, digest)
      const stored = await media.store(image, uid)
      const result = await profileStorage(() => repo.tx(async db => {
        const raced = await db.get(uploads, id)
        if (raced) return raced
        await guardAccount(db, uid)
        const row = { _id: id, uid, requestId: p.requestId, digest, media: stored, expiresAt: now() + 24 * hour }
        await db.put(uploads, id, row)
        return row
      }))
      // A thrown commit may already have persisted the file reference. Only discard a known loser.
      if (result.media.fileID !== stored.fileID) await media.discard(stored)
      return replay(result, digest)
    },

    async profileSubmit(user, p) {
      const uid = await own(repo, user)
      const values = submission(p)
      const { baseRevision, avatarUploadId, avatarRevisionId, resetAvatar, ...fields } = values
      const id = key('profile-revision', uid, p.requestId)
      const digest = key(values)
      const original = await loadProfile(user)
      return profileStorage(() => repo.tx(async db => {
        const existing = await db.get(revisions, id)
        if (existing) {
          if (existing.digest !== digest) fail('REQUEST_CONFLICT')
          await active(db, uid)
          return { revisionId: id, status: 'pending' }
        }
        await guardAccount(db, uid)
        const profile = await db.get(profiles, original._id)
        if (profile?.uid !== uid || (profile.revision ?? 0) !== baseRevision) fail('STALE_VERSION')
        const at = now()
        const recent = (profile.profileSubmittedAt ?? []).filter(time => time > at - hour)
        if (recent.length >= 10) fail('RATE_LIMITED')
        let avatarMedia = profile.avatarMedia ?? null
        let avatarVersion = profile.avatarVersion ?? ''
        let avatar = resetAvatar || avatarUploadId ? '' : legacyAvatar(profile)
        if (resetAvatar) { avatarMedia = null; avatarVersion = '' }
        if (avatarUploadId) {
          const upload = await db.get(uploads, avatarUploadId)
          if (upload?.uid !== uid || upload.expiresAt <= at) fail('UPLOAD_NOT_AVAILABLE')
          avatarMedia = upload.media
          avatarVersion = id
        }
        if (avatarRevisionId) {
          const source = await db.get(revisions, avatarRevisionId)
          if (source?.uid !== uid || !source.snapshot.avatarMedia) fail('NOT_FOUND')
          avatarMedia = source.snapshot.avatarMedia
          avatarVersion = avatarMedia.fileID === profile.avatarMedia?.fileID ? profile.avatarVersion : id
          avatar = ''
        }
        if (profile.pendingRevisionId) {
          const pending = await db.get(revisions, profile.pendingRevisionId)
          if (pending?.status === 'pending' && pending.uid === uid) {
            await db.put(revisions, pending._id, { ...pending, status: 'superseded', decidedAt: at })
          }
        }
        await db.put(revisions, id, {
          uid, baseRevision, digest, status: 'pending', snapshot: { ...fields, avatarMedia, avatarVersion, avatar },
          createdAt: at, order: String(at).padStart(13, '0') + '-' + id
        })
        await db.put(profiles, profile._id, {
          ...profile, pendingRevisionId: id, latestProfileRevisionId: id, profileSubmittedAt: [...recent, at]
        })
        return { revisionId: id, status: 'pending' }
      }))
    },

    async profileAvatar(_user, p) {
      const profile = await publicAvatar(p)
      const result = await media.read(profile.avatarMedia)
      const checked = await publicAvatar(p)
      if (checked.uid !== profile.uid || checked.avatarMedia.fileID !== profile.avatarMedia.fileID) fail('NOT_FOUND')
      return result
    },

    async profileRevision(user, p) {
      const uid = await own(repo, user)
      const row = identifier(p.revisionId) ? await repo.get(revisions, p.revisionId) : null
      if (row?.uid !== uid) fail('NOT_FOUND')
      if (p.avatar === true) {
        if (!row.snapshot.avatarMedia) fail('NOT_FOUND')
        const result = await media.read(row.snapshot.avatarMedia)
        await own(repo, user)
        if ((await repo.get(revisions, p.revisionId))?.uid !== uid) fail('NOT_FOUND')
        return result
      }
      return revisionView(row)
    },

    async profileReviewList(user, p = {}) {
      moderator(user)
      validateCursor(p.cursor)
      const rows = await repo.page(revisions, { status: 'pending' }, { field: 'order', before: p.cursor || null, size: 21 })
      return { items: rows.slice(0, 20).map(revisionView), next: rows.length > 20 ? rows[19].order : '' }
    },

    async profileReviewDetail(user, p) {
      moderator(user)
      const row = await candidate(repo, p.revisionId)
      const [profile, account] = await Promise.all([findProfile(repo, row.uid), repo.get(accounts, row.uid)])
      return { selected: revisionView(row), current: { ...profileFields(profile), avatar: legacyAvatar(profile) }, accountActive: account?.status === 0 }
    },

    async profileReviewAvatar(user, p) {
      moderator(user)
      const row = await candidate(repo, p.revisionId)
      let reference = row.snapshot.avatarMedia
      if (p.current === true) {
        const profile = await findProfile(repo, row.uid)
        if (!profile || !p.avatarVersion || profile.avatarVersion !== p.avatarVersion) fail('NOT_FOUND')
        reference = profile.avatarMedia
      }
      if (!reference) fail('NOT_FOUND')
      const result = await media.read(reference)
      const current = p.current === true ? (await findProfile(repo, row.uid))?.avatarMedia : (await candidate(repo, row._id)).snapshot.avatarMedia
      if (current?.fileID !== reference.fileID) fail('NOT_FOUND')
      return result
    },

    async profileReview(user, p) {
      moderator(user)
      if (!['approve', 'reject'].includes(p.decision)) fail('INVALID_REQUEST')
      const status = p.decision === 'approve' ? 'approved' : 'rejected'
      const reason = text(p.reason, status === 'rejected' ? 1 : 0, 300, 'INVALID_REASON')
      const initial = await candidate(repo, p.revisionId)
      const original = await findProfile(repo, initial.uid)
      return repo.tx(async db => {
        const row = await candidate(db, p.revisionId)
        if (row.status === status) {
          if (row.reason !== reason) fail('STALE_VERSION')
          return { revisionId: row._id, status }
        }
        if (row.status !== 'pending') fail('STALE_VERSION')
        await guardAccount(db, row.uid)
        const profile = original ? await db.get(profiles, original._id) : null
        if (profile?.uid !== row.uid || profile.pendingRevisionId !== row._id || (profile.revision ?? 0) !== row.baseRevision) {
          fail('STALE_VERSION')
        }
        const at = now()
        const updated = { ...profile, pendingRevisionId: '' }
        if (status === 'approved') {
          const { nickname, bio, displayCity, interests, avatarMedia, avatarVersion } = row.snapshot
          Object.assign(updated, { nickname, bio, displayCity, interests, avatarMedia, avatarVersion, avatar: legacyAvatar(row.snapshot), revision: row.baseRevision + 1 })
        }
        await db.put(profiles, profile._id, updated)
        await db.put(revisions, row._id, { ...row, status, reason, decidedAt: at, reviewerUid: user.uid })
        await writeCommunityAudit(db, user, 'profile.' + p.decision, row._id, {
          targetUid: row.uid, revisionId: row._id, reason,
          previous: profileFields(profile), submitted: revisionView(row)
        }, at)
        await writeProfileReviewNotification(db, {
          recipientUid: row.uid, revisionId: row._id, kind: 'profile.' + status, reason, createdAt: at
        })
        return { revisionId: row._id, status }
      })
    }
  }
}

module.exports = { createProfileService }
