const { randomBytes } = require('node:crypto')
const { key } = require('./service')
const { verifyPassword } = require('./security')

const users = 'fy-admin-users'
const sessions = 'fy-admin-sessions'
const dummyPasswordHash = '0'.repeat(32) + ':' + '0'.repeat(128)

function isActiveAdmin(account) {
  return account?.status === 0 && account.role?.includes('admin') === true
}

async function createAdminSession(repo, username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(username) ||
      typeof password !== 'string' || password.length > 256) {
    throw new Error('LOGIN_FAILED')
  }

  const [account] = await repo.list(users, { username })
  const passwordMatches = verifyPassword(password, account?.passwordHash ?? dummyPasswordHash)
  if (!passwordMatches || !isActiveAdmin(account)) throw new Error('LOGIN_FAILED')

  const token = 'fy_admin_' + randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000
  await repo.put(sessions, key(token), { uid: account._id, expiresAt })
  return { uid: account._id, token, expiresAt }
}

async function authenticateAdmin(repo, token) {
  if (typeof token !== 'string' || !/^fy_admin_[a-f0-9]{64}$/.test(token)) {
    throw new Error('AUTH_REQUIRED')
  }

  const sessionId = key(token)
  const session = await repo.get(sessions, sessionId)
  if (!session || session.expiresAt <= Date.now()) throw new Error('AUTH_REQUIRED')
  const account = await repo.get(users, session.uid)
  if (!isActiveAdmin(account)) throw new Error('FORBIDDEN')
  return { uid: session.uid, admin: true, sessionId }
}

async function revokeAdminSession(repo, user) {
  await repo.put(sessions, user.sessionId, { uid: user.uid, expiresAt: 0 })
}

module.exports = { createAdminSession, authenticateAdmin, revokeAdminSession }
