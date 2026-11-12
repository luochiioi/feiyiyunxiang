const { key } = require('./service')
const { fail, identifier, requiredText } = require('./community-policy')

const accounts = 'uni-id-users'
const posts = 'fy-community-posts'
const comments = 'fy-community-comments'
const reports = 'fy-community-reports'
const mutes = 'fy-community-mutes'

function requireAdmin(user) {
  if (!user?.admin) fail('FORBIDDEN')
}

async function writeCommunityAudit(db, user, action, target, details, at) {
  const id = key(user.uid, action, target, at, details)
  await db.put('fy-community-audit', id, {
    actor: user.uid, action, target, ...details, at, order: String(at).padStart(13, '0') + '-' + id
  })
}

function createCommunityOperations({ repo, now = Date.now }) {
  async function userView(account, knownProfile) {
    const [profile, mute] = await Promise.all([
      knownProfile ? Promise.resolve(knownProfile) : repo.list('fy-profiles', { uid: account._id }).then(rows => rows[0]),
      repo.get(mutes, account._id)
    ])
    return {
      id: account._id, status: account.status, suspendedByOps: account.fyOpsSuspended === true,
      code: profile?.code ?? '', nickname: profile?.nickname ?? '旅伴',
      createdAt: account.register_date ?? 0, muteUntil: mute?.until ?? 0
    }
  }

  return {
    async communityOverview(user) {
      if (!user?.admin && !user?.reviewer) fail('FORBIDDEN')
      const [pendingPosts, pendingComments, openReports, publishedPosts] = await Promise.all([
        repo.count('fy-community-versions', { status: 'pending' }),
        repo.count(comments, { status: 'pending' }),
        repo.count(reports, { status: 'open' }),
        repo.count(posts, { status: 'public' })
      ])
      const overview = { pendingPosts, pendingComments, openReports, publishedPosts }
      if (!user.admin) return overview
      const [activeAccounts, activeRoutes, activeCoops, activePk] = await Promise.all([
        repo.count(accounts, { status: 0 }),
        repo.count('fy-routes', { enabled: true }),
        repo.count('fy-teams', { status: 'active' }),
        repo.count('fy-matches', { status: ['preparing', 'running'] })
      ])
      return { ...overview, activeAccounts, activeRoutes, activeCoops, activePk }
    },

    async communityUsers(user, p) {
      requireAdmin(user)
      if (p.code) {
        if (typeof p.code !== 'string' || !/^[A-Z2-9]{8}$/i.test(p.code)) fail('INVALID_CODE')
        const [profile] = await repo.list('fy-profiles', { code: p.code.toUpperCase() })
        const account = profile ? await repo.get(accounts, profile.uid) : null
        return { items: account ? [await userView(account, profile)] : [], next: '' }
      }
      if (p.cursor && !identifier(p.cursor)) fail('INVALID_CURSOR')
      const filter = {}
      if (p.status === 'active') filter.status = 0
      if (p.status === 'disabled') filter.status = 1
      const rows = await repo.page(accounts, filter, { field: '_id', after: p.cursor || null, size: 21 })
      return {
        items: await Promise.all(rows.slice(0, 20).map(account => userView(account))),
        next: rows.length > 20 ? rows[19]._id : ''
      }
    },

    async communityUserDetail(user, p) {
      requireAdmin(user)
      const account = identifier(p.targetUid) ? await repo.get(accounts, p.targetUid) : null
      if (!account) fail('NOT_FOUND')
      const [view, sent, received, postCount, commentCount, reportCount] = await Promise.all([
        userView(account),
        repo.count('fy-friends', { from: account._id, status: 'accepted' }),
        repo.count('fy-friends', { to: account._id, status: 'accepted' }),
        repo.count(posts, { uid: account._id }),
        repo.count(comments, { uid: account._id }),
        repo.count(reports, { targetUid: account._id })
      ])
      return { ...view, friendCount: sent + received, postCount, commentCount, reportCount }
    },

    async communityAccountStatus(user, p) {
      requireAdmin(user)
      if (!identifier(p.targetUid) || typeof p.suspend !== 'boolean') fail('INVALID_REQUEST')
      const reason = requiredText(p.reason, 300)
      return repo.tx(async db => {
        const account = await db.get(accounts, p.targetUid)
        if (!account) fail('NOT_FOUND')
        if (p.suspend && account.status === 1 && account.fyOpsSuspended === true) return {}
        if (!p.suspend && account.status === 0) return {}
        if (p.suspend ? account.status !== 0 : account.status !== 1 || account.fyOpsSuspended !== true) fail('INVALID_ACCOUNT_STATE')
        const at = now()
        const guard = await db.get('fy-community-limits', p.targetUid)
        await db.put('fy-community-limits', p.targetUid, { ...guard, accountChangedAt: at })
        await db.put(accounts, p.targetUid, { ...account, status: p.suspend ? 1 : 0, fyOpsSuspended: p.suspend, token: [] })
        await writeCommunityAudit(db, user, p.suspend ? 'user.suspend' : 'user.restore', p.targetUid, { reason }, at)
        return {}
      })
    }
  }
}

module.exports = { createCommunityOperations, writeCommunityAudit }
