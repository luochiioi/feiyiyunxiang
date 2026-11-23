const { createHash } = require('node:crypto')
const { key } = require('./service')
const { createPartnershipService } = require('./partnership-service')
const { fail, identifier } = require('./community-policy')
const { profiles, accounts, findProfile, profileFields } = require('./profile-presenter')

const revisions = 'fy-profile-revisions'
const uploads = 'fy-profile-uploads'
const hour = 3600000
const interestsAllowed = new Set(['湘绣', '瓷器', '传统建筑', '非遗美食', '博物馆', '摄影'])

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
      (p.resetAvatar != null && typeof p.resetAvatar !== 'boolean') ||
      (p.resetAvatar && p.avatarUploadId)) fail('INVALID_REQUEST')
  const interests = p.interests ?? []
  if (!Array.isArray(interests) || interests.length > 3 || new Set(interests).size !== interests.length ||
      interests.some(item => !interestsAllowed.has(item))) fail('INVALID_INTERESTS')
  return {
    baseRevision: p.baseRevision, nickname: text(p.nickname, 2, 20, 'INVALID_NICKNAME'),
    bio: text(p.bio, 0, 80, 'INVALID_BIO'), displayCity: text(p.displayCity, 0, 20, 'INVALID_CITY'),
    interests, avatarUploadId: p.avatarUploadId ?? '', resetAvatar: p.resetAvatar === true
  }
}

function revisionView(row) {
  if (!row) return null
  const { nickname, bio, displayCity, interests, avatarMedia } = row.snapshot
  return {
    revisionId: row._id, nickname, bio, displayCity, interests, hasAvatar: !!avatarMedia,
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
  await db.put(collection, uid, { ...guard })
  await active(db, uid)
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

  return {
    async getMyProfile(user) {
      const profile = await loadProfile(user)
      const pending = profile.pendingRevisionId ? await repo.get(revisions, profile.pendingRevisionId) : null
      const latest = !pending && profile.latestProfileRevisionId ? await repo.get(revisions, profile.latestProfileRevisionId) : null
      return {
        ...profileFields(profile), pending: pending?.uid === profile.uid ? revisionView(pending) : null,
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
      const existing = await repo.get(uploads, id)
      if (existing) return replay(existing, digest)
      const stored = await media.store(image, uid)
      const result = await repo.tx(async db => {
        const raced = await db.get(uploads, id)
        if (raced) return raced
        await guardAccount(db, uid)
        const row = { _id: id, uid, requestId: p.requestId, digest, media: stored, expiresAt: now() + 24 * hour }
        await db.put(uploads, id, row)
        return row
      })
      // A thrown commit may already have persisted the file reference. Only discard a known loser.
      if (result.media.fileID !== stored.fileID) await media.discard(stored)
      return replay(result, digest)
    },

    async profileSubmit(user, p) {
      const uid = await own(repo, user)
      const values = submission(p)
      const { baseRevision, avatarUploadId, resetAvatar, ...fields } = values
      const id = key('profile-revision', uid, p.requestId)
      const digest = key(values)
      const original = await loadProfile(user)
      return repo.tx(async db => {
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
        if (resetAvatar) { avatarMedia = null; avatarVersion = '' }
        if (avatarUploadId) {
          const upload = await db.get(uploads, avatarUploadId)
          if (upload?.uid !== uid || upload.expiresAt <= at) fail('UPLOAD_NOT_AVAILABLE')
          avatarMedia = upload.media
          avatarVersion = id
        }
        if (profile.pendingRevisionId) {
          const pending = await db.get(revisions, profile.pendingRevisionId)
          if (pending?.status === 'pending' && pending.uid === uid) {
            await db.put(revisions, pending._id, { ...pending, status: 'superseded', decidedAt: at })
          }
        }
        await db.put(revisions, id, {
          uid, baseRevision, digest, status: 'pending', snapshot: { ...fields, avatarMedia, avatarVersion },
          createdAt: at, order: String(at).padStart(13, '0') + '-' + id
        })
        await db.put(profiles, profile._id, {
          ...profile, pendingRevisionId: id, latestProfileRevisionId: id, profileSubmittedAt: [...recent, at]
        })
        return { revisionId: id, status: 'pending' }
      })
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
    }
  }
}

module.exports = { createProfileService }
