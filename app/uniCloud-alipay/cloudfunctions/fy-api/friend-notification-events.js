const { createHash } = require('node:crypto')
const { fail, identifier } = require('./community-policy')
const { publicProfile } = require('./profile-presenter')
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const friendTitles = { 'friend.request.received': '收到好友申请', 'friend.request.accepted': '好友申请已通过' }
const friendEventKey = row => key('friend-request', row.from, row.requestId)
const friendResponseId = row => key('friend-response', row._id, row.from, row.requestId)

async function writeFriendNotification(db, row, kind, at) {
  if (!Object.hasOwn(friendTitles, kind) || ![row._id, row.from, row.to, row.requestId].every(identifier) || !Number.isSafeInteger(at) || at <= 0) fail('INVALID_NOTIFICATION')
  const received = kind === 'friend.request.received'
  const recipientUid = received ? row.to : row.from, actor = received ? row.from : row.to
  const event = friendEventKey(row), id = key('friend-notification', recipientUid, kind, row._id, event)
  if (await db.get('fy-notifications', id)) return id
  const profile = (await db.list('fy-profiles', { uid: actor }))[0]
  const actorNickname = typeof profile?.nickname === 'string' ? profile.nickname.slice(0, 40) : '旅伴'
  await db.put('fy-notifications', id, {
    recipientUid, kind, postId: '', revisionId: '', commentId: '', reason: '', createdAt: at,
    order: String(at).padStart(13, '0') + '-' + id, readAt: 0,
    friendId: row._id, friendEventKey: event, actorNickname
  })
  return id
}

async function friendNotificationContext(db, notification, uid, at) {
  const value = { nickname: notification.actorNickname || '旅伴', status: 'unavailable' }
  const row = await db.get('fy-friends', notification.friendId)
  if (!row || friendEventKey(row) !== notification.friendEventKey) return value
  const received = notification.kind === 'friend.request.received'
  if ((received ? row.to : row.from) !== uid) return value
  const otherUid = received ? row.from : row.to
  const other = await db.get('uni-id-users', otherUid)
  if (!other || other.status !== 0) return value
  const state = row.status === 'pending' && row.expiresAt <= at ? 'expired' : row.status
  if (['pending', 'accepted', 'rejected', 'withdrawn', 'expired'].includes(state)) value.status = state
  const profile = await publicProfile(db, otherUid)
  if (profile.code) {
    value.nickname = profile.nickname
    if (profile.avatarVersion) Object.assign(value, { code: profile.code, avatarVersion: profile.avatarVersion })
  }
  return value
}
module.exports = { friendTitles, friendEventKey, friendResponseId, writeFriendNotification, friendNotificationContext }
