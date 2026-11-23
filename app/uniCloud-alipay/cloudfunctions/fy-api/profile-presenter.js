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

module.exports = { profiles, accounts, findProfile, profileSummary, legacyAvatar, profileFields }
