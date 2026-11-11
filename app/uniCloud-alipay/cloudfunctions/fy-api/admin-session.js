const { randomBytes } = require('node:crypto')
const { key } = require('./service')
const { hashPassword, verifyPassword } = require('./security')

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
  await repo.put(sessions, key(token), { uid: account._id, expiresAt, passwordVersion: account.passwordVersion ?? 0 })
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
  const passwordVersion = account.passwordVersion ?? 0
  if ((session.passwordVersion ?? 0) !== passwordVersion) throw new Error('AUTH_REQUIRED')
  return { uid: session.uid, admin: true, sessionId, passwordVersion }
}

async function changeAdminPassword(repo, user, currentPassword, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 16 || newPassword.length > 128 || !newPassword.trim()) {
    throw new Error('INVALID_PASSWORD')
  }

  await repo.tx(async tx => {
    const account = await tx.get(users, user.uid)
    if (!isActiveAdmin(account)) throw new Error('FORBIDDEN')
    const passwordVersion = account.passwordVersion ?? 0
    if (passwordVersion !== user.passwordVersion) throw new Error('AUTH_REQUIRED')
    if (!verifyPassword(currentPassword, account.passwordHash)) throw new Error('PASSWORD_INCORRECT')
    if (currentPassword === newPassword) throw new Error('PASSWORD_UNCHANGED')

    await tx.put(users, user.uid, {
      ...account,
      passwordHash: hashPassword(newPassword),
      passwordVersion: passwordVersion + 1
    })
  })
}

async function revokeAdminSession(repo, user) {
  await repo.put(sessions, user.sessionId, { uid: user.uid, expiresAt: 0 })
}

module.exports = { createAdminSession, authenticateAdmin, revokeAdminSession, changeAdminPassword }
