const { key } = require('./service')
const { fail, identifier } = require('./community-policy')

const profileTitles = {
  'profile.approved': '资料审核通过',
  'profile.rejected': '资料审核未通过'
}

async function writeProfileReviewNotification(db, { recipientUid, revisionId, kind, reason, createdAt }) {
  if (!Object.hasOwn(profileTitles, kind) || !identifier(recipientUid) || !identifier(revisionId) ||
      typeof reason !== 'string' || [...reason].length > 300 || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    fail('INVALID_NOTIFICATION')
  }
  const id = key('profile-notification', recipientUid, revisionId, kind)
  if (!await db.get('fy-notifications', id)) {
    await db.put('fy-notifications', id, {
      recipientUid, kind, profileRevisionId: revisionId, postId: '', revisionId: '', commentId: '',
      reason, createdAt, order: String(createdAt).padStart(13, '0') + '-' + id, readAt: 0
    })
  }
  return id
}

module.exports = { profileTitles, writeProfileReviewNotification }
