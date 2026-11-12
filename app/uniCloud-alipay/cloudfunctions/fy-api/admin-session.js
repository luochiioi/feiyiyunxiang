const { randomBytes } = require('node:crypto')
const { key } = require('./service')
const { hashPassword, verifyPassword } = require('./security')

const users = 'fy-admin-users'
const sessions = 'fy-admin-sessions'
const dummyPasswordHash = '0'.repeat(32) + ':' + '0'.repeat(128)
const validUsername = username => typeof username === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(username)

function isActiveAdmin(account) {
  return account?.status === 0 && Array.isArray(account.role) &&
    account.role.some(role => role === 'admin' || role === 'reviewer')
}

async function createAdminSession(repo, username, password) {
  if (!validUsername(username) ||
      typeof password !== 'string' || password.length > 256) {
    throw new Error('LOGIN_FAILED')
  }

  const [account] = await repo.list(users, { username })
  const passwordMatches = verifyPassword(password, account?.passwordHash ?? dummyPasswordHash)
  if (!passwordMatches || !isActiveAdmin(account)) throw new Error('LOGIN_FAILED')

  const token = 'fy_admin_' + randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000
  await repo.put(sessions, key(token), { uid: account._id, expiresAt, passwordVersion: account.passwordVersion ?? 0 })
  return { uid: account._id, username: account.username, token, expiresAt, admin: account.role.includes('admin') }
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
  return { uid: session.uid, admin: account.role.includes('admin'), reviewer: account.role.includes('reviewer'), sessionId, passwordVersion }
}

async function updateAdminCredentials(repo, user, { currentPassword, newUsername, newPassword }) {
  if (newUsername !== undefined && !validUsername(newUsername)) throw new Error('INVALID_USERNAME')
  if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128 || !newPassword.trim())) {
    throw new Error('INVALID_PASSWORD')
  }

  const account = await repo.get(users, user.uid)
  if (!isActiveAdmin(account)) throw new Error('FORBIDDEN')
  if (!verifyPassword(currentPassword, account.passwordHash)) throw new Error('PASSWORD_INCORRECT')
  if (currentPassword === newPassword) throw new Error('PASSWORD_UNCHANGED')
  const username = newUsername ?? account.username
  if (username === account.username && newPassword === undefined) throw new Error('CREDENTIALS_UNCHANGED')
  if (username !== account.username && (await repo.list(users, { username })).length > 0) throw new Error('USERNAME_TAKEN')
  const passwordHash = newPassword === undefined ? account.passwordHash : hashPassword(newPassword)

  try {
    await repo.tx(async tx => {
      const latest = await tx.get(users, user.uid)
      if (!isActiveAdmin(latest)) throw new Error('FORBIDDEN')
      const version = latest.passwordVersion ?? 0
      if (version !== user.passwordVersion || version !== (account.passwordVersion ?? 0)) throw new Error('AUTH_REQUIRED')
      // The unique username index also covers concurrent renames by different operators.
      await tx.put(users, user.uid, { ...latest, username, passwordHash, passwordVersion: version + 1 })
    })
  } catch (error) {
    if (/duplicate|E11000/i.test(`${error.code} ${error.message}`)) throw new Error('USERNAME_TAKEN')
    throw error
  }
}

async function revokeAdminSession(repo, user) {
  await repo.put(sessions, user.sessionId, { uid: user.uid, expiresAt: 0 })
}

module.exports = { createAdminSession, authenticateAdmin, revokeAdminSession, updateAdminCredentials }
