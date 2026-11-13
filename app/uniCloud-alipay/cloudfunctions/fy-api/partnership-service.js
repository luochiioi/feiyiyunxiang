const { createHash } = require('node:crypto')
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const fail = code => { throw new Error(code) }
const { pkMethods } = require('./pk-service')
const { bottleMethods } = require('./bottle-service')
const { completedActivities } = require('./culture')
const HOUR = 3600 * 1000
const expiredInvite = (team, at) => team.status === 'invited' && team.expiresAt <= at
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createPartnershipService({ repo, now = Date.now }) {
  const member = u => { if (!u?.uid) fail('AUTH_REQUIRED') }
  const codeOf = value => typeof value === 'string' && /^[A-Z2-9]{8}$/.test(value)
  const requestOf = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)

  async function lockCoopSlots(db, members, at) {
    for (const uid of members) await db.put('fy-requests', key('coop-slot', uid), { updatedAt: at })
  }

  function card(profile) {
    return { code: profile.code, nickname: profile.nickname, avatar: profile.avatar }
  }

  async function seatProgress(team, uid) {
    const runId = team.runs[uid]
    const [run, checks] = await Promise.all([
      repo.get('fy-runs', runId),
      repo.list('fy-checkins', { runId, uid })
    ])
    if (!run) fail('NOT_FOUND')
    const seat = seatOf(team, uid)
    const nodes = seatNodes(run, seat)
    const activities = taskSelection(run.snapshot, seat, team.tasks?.[uid])
    const completed = completedActivities(run)
    return {
      done: nodes.filter(id => checks.some(check => check.nodeId === id)).length +
        activities.filter(id => completed.includes(id)).length,
      total: nodes.length + activities.length
    }
  }

  async function coopView(team, uid) {
    const mine = seatOf(team, uid)
    const other = team.members.find(id => id !== uid)
    const otherSeat = seatOf(team, other)
    const partnerProfile = (await repo.list('fy-profiles', { uid: other }))[0]
    const status = expiredInvite(team, now()) ? 'expired' : team.status
    const local = team.memberRoutes?.[uid]
    const remote = team.memberRoutes?.[other]
    const snapshot = await repo.get('fy-versions', local?.version ?? team.version)
    const partnerSnapshot = remote == null ? snapshot : await repo.get('fy-versions', remote.version)
    const view = { id: team._id, status, mySeat: mine, partnerSeat: otherSeat, routeId: local?.routeId ?? team.routeId, version: local?.version ?? team.version,
      invitedByMe: team.invitedBy === uid, myRunId: team.runs?.[uid] ?? null, partner: partnerProfile ? (local == null ? card(partnerProfile) : { nickname: partnerProfile.nickname }) : null,
      myTasks: taskLabels(snapshot, taskSelection(snapshot, mine, team.tasks?.[uid])),
      partnerTasks: taskLabels(partnerSnapshot, taskSelection(partnerSnapshot, otherSeat, team.tasks?.[other])),
      myTaskOptions: taskLabels(snapshot, seatActivitiesOf(snapshot, mine)) }
    if (team.status === 'active') {
      const [myProgress, partnerProgress] = await Promise.all([seatProgress(team, uid), seatProgress(team, other)])
      Object.assign(view, { myProgress, partnerProgress })
    }
    if (team.status === 'done') {
      const result = await repo.get('fy-results', key(team._id, 'result'))
      view.result = { partnerLabel: otherSeat === 'macau' ? '澳门旅伴' : '湖南旅伴', work: result.work, completedAt: result.completedAt }
      view.public = { partnerLabel: view.result.partnerLabel, completedAt: result.completedAt }
    }
    return view
  }

  async function freshCode(db) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from(key(now(), attempt, Math.random()))
        .map(ch => CODE_ALPHABET[parseInt(ch, 16) % CODE_ALPHABET.length]).slice(0, 8).join('')
      if ((await db.list('fy-profiles', { code })).length === 0) return code
    }
    fail('SERVICE_UNAVAILABLE')
  }

  async function friendIdFor(db, u, requestId) {
    const request = await db.get('fy-requests', key(u.uid, 'friend', requestId)) ?? await db.get('fy-requests', key(u.uid, 'friend-in', requestId))
    if (!request) fail('NOT_FOUND')
    return request.friendId
  }

  async function pendingFriendId(db, u, requestId) {
    const rows = await db.list('fy-friends', { to: u.uid, status: 'pending' })
    const match = rows.find(row => row.requestId === requestId && row.expiresAt > now())
    return match?._id ?? null
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
          from: u.uid, to: target.uid, status: 'pending', requestId: p.requestId, createdAt: now(), expiresAt: now() + 24 * HOUR
        })
        await db.put('fy-requests', requestKey, { friendId, role: 'from' })
        await db.put('fy-requests', key(target.uid, 'friend-in', p.requestId), { friendId, role: 'to' })
        return { id: friendId }
      })
    },

    async respondFriend(u, p) {
      member(u)
      if (!requestOf(p.requestId) || typeof p.accept !== 'boolean') fail('INVALID_REQUEST')
      const friendId = await friendIdFor(repo, u, p.requestId) ?? await pendingFriendId(repo, u, p.requestId)
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
      const mine = rows.filter(row => (row.from === u.uid || row.to === u.uid)
        && (row.status === 'accepted' || (row.status === 'pending' && row.to === u.uid && row.expiresAt > now())))
      const cards = []
      for (const row of mine) {
        const other = row.from === u.uid ? row.to : row.from
        const profile = (await repo.list('fy-profiles', { uid: other }))[0]
        if (!profile) continue
        const item = card(profile)
        if (row.status === 'pending') { item.kind = 'incoming'; item.id = row.requestId }
        cards.push(item)
      }
      return cards
    },

    async inviteCoop(u, p) {
      member(u)
      if (!codeOf(p.code) || !requestOf(p.requestId) || !requestOf(p.routeId)) fail('INVALID_REQUEST')
      const requestKey = key(u.uid, 'coop', p.requestId)
      return repo.tx(async db => {
        const replay = await db.get('fy-requests', requestKey)
        if (replay) return { id: replay.teamId }
        const target = (await db.list('fy-profiles', { code: p.code }))[0]
        if (!target) fail('NOT_FOUND')
        const pair = [u.uid, target.uid].sort()
        const friendship = await db.get('fy-friends', key('friend', ...pair))
        if (!friendship || friendship.status !== 'accepted') fail('NOT_FRIENDS')
        const at = now()
        if (await activeTeam(db, u.uid, at) || await activeTeam(db, target.uid, at)) fail('CONFLICT')
        const route = await db.get('fy-routes', p.routeId)
        if (!route?.enabled) fail('NOT_FOUND')
        const snapshot = await db.get('fy-versions', route.version)
        const plan = seatPlan(snapshot)
        if (!plan) fail('INVALID_ROUTE')
        const mySeat = p.seat ?? 'macau'
        if (mySeat !== 'macau' && mySeat !== 'hunan') fail('INVALID_REQUEST')
        const tasks = taskSelection(snapshot, mySeat, p.activities ?? null)
        const seats = { ...plan, macau: mySeat === 'macau' ? u.uid : target.uid, hunan: mySeat === 'hunan' ? u.uid : target.uid }
        const teamId = key('team', u.uid, p.requestId)
        await lockCoopSlots(db, pair, at)
        await db.put('fy-teams', teamId, {
          members: pair, a: pair[0], b: pair[1], seats, routeId: p.routeId, version: route.version, status: 'invited',
          tasks: { [u.uid]: tasks },
          invitedBy: u.uid, invitedAt: at, expiresAt: at + 24 * HOUR
        })
        await db.put('fy-requests', requestKey, { teamId })
        await db.put('fy-requests', key(target.uid, 'coop', p.requestId), { teamId })
        return { id: teamId }
      })
    },

    async respondCoop(u, p) {
      member(u)
      if (!requestOf(p.teamId) || typeof p.accept !== 'boolean') fail('INVALID_REQUEST')
      const result = await repo.tx(async db => {
        const team = await loadTeam(db, p.teamId, u.uid)
        if (team.invitedBy === u.uid) fail('NOT_FOUND')
        if (team.status === 'expired') return { id: p.teamId, status: 'expired' }
        if (team.status !== 'invited') fail('NOT_PENDING')
        const at = now()
        if (expiredInvite(team, at)) {
          await db.put('fy-teams', p.teamId, { ...team, status: 'expired' })
          return { id: p.teamId, status: 'expired' }
        }
        if (!p.accept) { await db.put('fy-teams', p.teamId, { ...team, status: 'declined' }); return { id: p.teamId, status: 'declined' } }
        if (await activeTeam(db, u.uid, at, p.teamId)) fail('CONFLICT')
        const snapshot = await db.get('fy-versions', team.version)
        const tasks = taskSelection(snapshot, seatOf(team, u.uid), p.activities ?? null)
        const runs = {}
        for (const uid of team.members) {
          const runId = key(uid, 'coop', p.teamId)
          await db.put('fy-runs', runId, {
            uid, routeId: team.routeId, version: team.version, snapshot, purpose: 'coop', teamId: p.teamId, createdAt: now(), revision: 0
          })
          runs[uid] = runId
        }
        await db.put('fy-teams', p.teamId, {
          ...team, tasks: { ...(team.tasks ?? {}), [u.uid]: tasks }, status: 'active', runs, startedAt: now()
        })
        return { id: p.teamId, status: 'active' }
      })
      if (result.status === 'expired') fail('EXPIRED')
      return result
    },

    async withdrawCoop(u, p) {
      member(u)
      return repo.tx(async db => {
        const team = await loadTeam(db, p.teamId, u.uid)
        if (team.invitedBy !== u.uid || team.status !== 'invited' || expiredInvite(team, now())) fail('NOT_PENDING')
        await db.put('fy-teams', p.teamId, { ...team, status: 'withdrawn' })
        return { id: p.teamId }
      })
    },

    async leaveCoop(u, p) {
      member(u)
      return repo.tx(async db => {
        const team = await loadTeam(db, p.teamId, u.uid)
        if (team.status !== 'active') fail('NOT_PENDING')
        await db.put('fy-teams', p.teamId, { ...team, status: 'left', leftBy: u.uid, leftAt: now() })
        return { id: p.teamId }
      })
    },

    async coopStatus(u, p) {
      member(u)
      return coopView(await loadTeam(repo, p.teamId, u.uid), u.uid)
    },

    async myCoop(u) {
      member(u)
      const team = await activeTeam(repo, u.uid, now())
      return team == null ? null : coopView(team, u.uid)
    },

    async settleCoop(u, p) {
      member(u)
      return repo.tx(async db => {
        const team = await loadTeam(db, p.teamId, u.uid)
        if (team.status === 'done') return { id: p.teamId, alreadySettled: true }
        if (team.status !== 'active') fail('NOT_PENDING')
        for (const uid of team.members) {
          const run = await db.get('fy-runs', team.runs[uid])
          const checks = await db.list('fy-checkins', { runId: team.runs[uid], uid })
          const seat = seatOf(team, uid)
          const nodesDone = seatNodes(run, seat).every(id => checks.some(check => check.nodeId === id))
          const cultureDone = taskSelection(run.snapshot, seat, team.tasks?.[uid]).every(id => run.culture?.[id])
          if (!nodesDone || !cultureDone) fail('NOT_READY')
        }
        const macauUid = team.members.find(uid => seatOf(team, uid) === 'macau')
        const macauRun = macauUid == null ? null : await db.get('fy-runs', team.runs[macauUid])
        const resultId = key(p.teamId, 'result')
        if (!await db.get('fy-results', resultId)) {
          await db.put('fy-results', resultId, {
            teamId: p.teamId, routeId: team.routeId, version: team.version,
            work: macauRun?.culture?.tile ?? null, theme: 'xiang-embroidery', completedAt: now()
          })
        }
        await db.put('fy-teams', p.teamId, { ...team, status: 'done', completedAt: now() })
        return { id: p.teamId, alreadySettled: false }
      })
    },
    ...bottleMethods({ repo, now, key, fail, member, requestOf, activeTeam, lockCoopSlots }),
    ...pkMethods({ repo, now, key, fail, member, codeOf, requestOf })
  }
}

async function activeTeam(db, uid, at, except) {
  const rows = [...await db.list('fy-teams', { a: uid }), ...await db.list('fy-teams', { b: uid })]
  return rows.find(row => (row.status === 'active' || (row.status === 'invited' && !expiredInvite(row, at))) && row._id !== except) ?? null
}

async function loadTeam(db, teamId, uid) {
  if (typeof teamId !== 'string') fail('NOT_FOUND')
  const team = await db.get('fy-teams', teamId)
  if (!team || !team.members.includes(uid)) fail('NOT_FOUND')
  return team
}

// Seats come from the published culture gates, so the assignment is fixed with the route version.
function seatPlan(snapshot) {
  const culture = snapshot?.culture ?? {}
  const macau = [...new Set([...(culture.tile?.after ?? []), ...(culture.tileQuiz?.after ?? [])])]
  const hunan = [...new Set([...(culture.quiz?.after ?? []), ...(culture.learning?.after ?? [])])]
  if (macau.length === 0 || hunan.length === 0) return null
  return { macauNodes: macau, hunanNodes: hunan }
}

function seatNodes(run, seat) {
  if (run.bottle === true) return run.snapshot.nodes.map(node => node.id)
  const plan = seatPlan(run.snapshot)
  return seat === 'macau' ? plan.macauNodes : plan.hunanNodes
}

function seatOf(team, uid) {
  return team.memberRoutes?.[uid]?.region ?? (team.seats.macau === uid ? 'macau' : 'hunan')
}

// 每个席位可选的文化任务来自路线快照，旧队伍没有记录时默认全部完成。
function seatActivitiesOf(snapshot, seat) {
  const ids = seat === 'macau' ? ['tile', 'tileQuiz'] : ['quiz', 'learning']
  return ids.filter(id => snapshot?.culture?.[id])
}

function taskSelection(snapshot, seat, picked) {
  const options = seatActivitiesOf(snapshot, seat)
  if (picked == null) return options
  if (!Array.isArray(picked) || picked.length === 0 || new Set(picked).size !== picked.length ||
    !picked.every(id => options.includes(id))) fail('INVALID_TASKS')
  return picked
}

function taskLabels(snapshot, ids) {
  return ids.map(id => ({ id, title: snapshot?.culture?.[id]?.title ?? id }))
}

function seatActivities(run, seat) {
  return seatActivitiesOf(run.snapshot, seat)
}

module.exports = { createPartnershipService, seatNodes, seatActivities, seatOf }
