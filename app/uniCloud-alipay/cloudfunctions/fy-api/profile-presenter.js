const profiles = 'fy-profiles'
const accounts = 'uni-id-users'
const findProfile = async (db, uid) => (await db.list(profiles, { uid }))[0] ?? null

function profileSummary(profile) {
  return { code: profile?.code ?? '', nickname: profile?.nickname ?? '旅伴', avatarVersion: profile?.avatarVersion ?? '' }
}

function legacyAvatar(profile) {
  return typeof profile?.avatar === 'string' && /^https:\/\//i.test(profile.avatar) ? profile.avatar : ''
}

function profileFields(profile) {
  return {
    ...profileSummary(profile), bio: profile?.bio ?? '', displayCity: profile?.displayCity ?? '',
    interests: profile?.interests ?? [], revision: profile?.revision ?? 0
  }
}

async function publicProfile(db, uid) {
  if ((await db.get(accounts, uid))?.status !== 0) return profileSummary(null)
  return profileSummary(await findProfile(db, uid))
}

async function visibleProfiles(repo, uids) {
  const ids = [...new Set(uids)]
  const result = new Map()
  for (let offset = 0; offset < ids.length; offset += 50) {
    const group = ids.slice(offset, offset + 50)
    const [rows, active] = await Promise.all([
      repo.page(profiles, { uid: group }, { field: '_id', size: 100 }),
      repo.page(accounts, { _id: group, status: 0 }, { field: '_id', size: 50 })
    ])
    const enabled = new Set(active.map(row => row._id))
    for (const row of rows) {
      if (enabled.has(row.uid) && !result.has(row.uid)) result.set(row.uid, row)
    }
  }
  return result
}

async function publicProfiles(repo, uids) {
  const ids = [...new Set(uids)]
  const visible = await visibleProfiles(repo, ids)
  return new Map(ids.map(uid => [uid, profileSummary(visible.get(uid))]))
}

module.exports = { profiles, accounts, findProfile, profileSummary, legacyAvatar, profileFields,
  publicProfile, publicProfiles, visibleProfiles }
