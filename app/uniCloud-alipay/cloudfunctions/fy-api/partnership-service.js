const { createHash } = require('node:crypto')
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const fail = code => { throw new Error(code) }
const HOUR = 3600 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createPartnershipService({ repo, now = Date.now }) {
  const member = u => { if (!u?.uid) fail('AUTH_REQUIRED') }
  const codeOf = value => typeof value === 'string' && /^[A-Z2-9]{8}$/.test(value)
  const requestOf = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)

  function card(profile) {
    return { code: profile.code, nickname: profile.nickname, avatar: profile.avatar }
  }

  async function freshCode(db) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from(key(now(), attempt, Math.random()))
        .map(ch => CODE_ALPHABET[parseInt(ch, 16) % CODE_ALPHABET.length]).slice(0, 8).join('')
      if ((await db.list('fy-profiles', { code })).length === 0) return code
    }
    fail('SERVICE_UNAVAILABLE')
  }

  return {
    async ensureProfile(u) {
      member(u)
      return repo.tx(async db => {
        const existing = (await db.list('fy-profiles', { uid: u.uid }))[0]
        if (existing) return card(existing)
        const profile = { uid: u.uid, code: await freshCode(db), nickname: '旅伴' + u.uid.slice(0, 4), avatar: '' }
        await db.put('fy-profiles', key('profile', u.uid), profile)
        return card(profile)
      })
    },

    async findByCode(u, p) {
      member(u)
      if (!codeOf(p.code)) fail('NOT_FOUND')
      const profile = (await repo.list('fy-profiles', { code: p.code }))[0]
      if (!profile || profile.uid === u.uid) fail('NOT_FOUND')
      return card(profile)
    },

    async requestFriend(u, p) {
      member(u)
      if (!codeOf(p.code) || !requestOf(p.requestId)) fail('INVALID_REQUEST')
      const requestKey = key(u.uid, 'friend', p.requestId)
      return repo.tx(async db => {
        const replay = await db.get('fy-requests', requestKey)
        if (replay) return { id: replay.friendId }
        const target = (await db.list('fy-profiles', { code: p.code }))[0]
        if (!target) fail('NOT_FOUND')
        if (target.uid === u.uid) fail('INVALID_REQUEST')
        const pair = [u.uid, target.uid].sort()
        const friendId = key('friend', ...pair)
        const current = await db.get('fy-friends', friendId)
        if (current && current.status === 'accepted') return { id: friendId }
        if (current && current.status === 'pending' && current.expiresAt > now()) fail('CONFLICT')
        await db.put('fy-friends', friendId, {
          from: u.uid, to: target.uid, status: 'pending', createdAt: now(), expiresAt: now() + 24 * HOUR
        })
        await db.put('fy-requests', requestKey, { friendId, role: 'from' })
        await db.put('fy-requests', key(target.uid, 'friend', p.requestId), { friendId, role: 'to' })
        return { id: friendId }
      })
    },

    async respondFriend(u, p) {
      member(u)
      if (!requestOf(p.requestId) || typeof p.accept !== 'boolean') fail('INVALID_REQUEST')
      const friendId = await friendIdFor(repo, u, p.requestId)
      return repo.tx(async db => {
        const row = await db.get('fy-friends', friendId)
        if (!row || row.to !== u.uid) fail('NOT_FOUND')
        if (row.status !== 'pending') fail('NOT_PENDING')
        if (row.expiresAt <= now()) {
          await db.put('fy-friends', friendId, { ...row, status: 'expired' })
          fail('EXPIRED')
        }
        await db.put('fy-friends', friendId, { ...row, status: p.accept ? 'accepted' : 'rejected', decidedAt: now() })
        return { id: friendId, status: p.accept ? 'accepted' : 'rejected' }
      })
    },

    async withdrawFriend(u, p) {
      member(u)
      if (!requestOf(p.requestId)) fail('INVALID_REQUEST')
      const friendId = await friendIdFor(repo, u, p.requestId)
      return repo.tx(async db => {
        const row = await db.get('fy-friends', friendId)
        if (!row || row.from !== u.uid) fail('NOT_FOUND')
        if (row.status !== 'pending') fail('NOT_PENDING')
        await db.put('fy-friends', friendId, { ...row, status: 'withdrawn' })
        return { id: friendId }
      })
    },

    async friends(u) {
      member(u)
      const rows = await repo.list('fy-friends', {})
      const mine = rows.filter(row => row.status === 'accepted' && (row.from === u.uid || row.to === u.uid))
      const cards = []
      for (const row of mine) {
        const other = row.from === u.uid ? row.to : row.from
        const profile = (await repo.list('fy-profiles', { uid: other }))[0]
        if (profile) cards.push(card(profile))
      }
      return cards
    }
  }

  async function friendIdFor(db, u, requestId) {
    const request = await db.get('fy-requests', key(u.uid, 'friend', requestId))
    if (!request) fail('NOT_FOUND')
    return request.friendId
  }
}

module.exports = { createPartnershipService }
