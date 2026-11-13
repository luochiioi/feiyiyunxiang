const HOUR = 3600 * 1000

// 彩蛋来自发布路线，旧路线没有配置时回退为第一个点位。
function routeEggs(snapshot) {
  const nodes = snapshot?.nodes ?? []
  const nodeIds = new Set(nodes.map(node => node.id))
  const eggs = (snapshot?.culture?.eggs ?? []).filter(egg => nodeIds.has(egg.nodeId))
  if (eggs.length > 0) return eggs
  const node = nodes[0]
  return node == null ? [] : [{ id: 'fallback', title: node.title, description: node.description ?? '', nodeId: node.id }]
}

function pkMethods({ repo, now, key, fail, member, codeOf, requestOf }) {
  async function activeMatch(db, uid, except) {
    const rows = [...await db.list('fy-matches', { a: uid }), ...await db.list('fy-matches', { b: uid })]
    return rows.find(row => ['invited', 'preparing', 'running'].includes(row.status) && row._id !== except) ?? null
  }
  async function loadMatch(db, matchId, uid) {
    if (typeof matchId !== 'string') fail('NOT_FOUND')
    const match = await db.get('fy-matches', matchId)
    if (!match || !match.uids.includes(uid)) fail('NOT_FOUND')
    return match
  }
  async function assertNoAssignment(db, uid) {
    const rows = await db.list('fy-assignments', { uid })
    if (rows.some(row => row.status === 'pending' || row.status === 'doing')) fail('ASSIGNMENT_PENDING')
  }
  // The template comes from the published route, never from the opponent.
  async function assignFailure(db, uid, matchId, egg, nodeTitle) {
    await db.put('fy-assignments', key(matchId, 'assignment', uid), {
      uid, matchId, status: 'pending', eggId: egg.id, nodeId: egg.nodeId,
      title: egg.title, description: egg.description, nodeTitle,
      assignedAt: now(), rejectAvailableAt: now() + 72 * HOUR
    })
  }
  function nodeTitleOf(snapshot, nodeId, fallback) {
    return (snapshot?.nodes ?? []).find(node => node.id === nodeId)?.title ?? fallback
  }
  // 败者未被确认前，胜者最长 24 小时内可以补选彩蛋。
  async function pendingEgg(db, uid) {
    const rows = await db.list('fy-matches', { winner: uid })
    for (const row of rows) {
      if (row.status !== 'settled' || row.eggId || row.settledAt <= now() - 24 * HOUR) continue
      const loser = row.uids.find(id => id !== uid)
      if (!await db.get('fy-assignments', key(row._id, 'assignment', loser))) return row
    }
    return null
  }

  return {
    async myPk(u) {
      member(u)
      const match = await activeMatch(repo, u.uid)
      if (match == null) {
        const settled = await pendingEgg(repo, u.uid)
        return settled == null ? null : {
          id: settled._id, status: 'settled', routeId: settled.routeId, invitedBy: settled.invitedBy,
          ready: settled.ready, startedAt: settled.startedAt ?? null, expiresAt: settled.expiresAt,
          myRunId: null, eggPending: true, winner: u.uid
        }
      }
      return {
        id: match._id, status: match.status, routeId: match.routeId, invitedBy: match.invitedBy,
        ready: match.ready, startedAt: match.startedAt ?? null, expiresAt: match.expiresAt,
        myRunId: match.status === 'running' ? match.runs[u.uid] : null, eggPending: false, winner: match.winner ?? null
      }
    },

    async invitePk(u, p) {
      member(u)
      if (!codeOf(p.code) || !requestOf(p.requestId) || !requestOf(p.routeId)) fail('INVALID_REQUEST')
      const requestKey = key(u.uid, 'pk', p.requestId)
      return repo.tx(async db => {
        const replay = await db.get('fy-requests', requestKey)
        if (replay) return { id: replay.matchId }
        await assertNoAssignment(db, u.uid)
        const target = (await db.list('fy-profiles', { code: p.code }))[0]
        if (!target) fail('NOT_FOUND')
        const pair = [u.uid, target.uid].sort()
        const friendship = await db.get('fy-friends', key('friend', ...pair))
        if (!friendship || friendship.status !== 'accepted') fail('NOT_FRIENDS')
        if (await activeMatch(db, u.uid) || await activeMatch(db, target.uid)) fail('CONFLICT')
        const route = await db.get('fy-routes', p.routeId)
        if (!route?.enabled) fail('NOT_FOUND')
        const matchId = key('match', u.uid, p.requestId)
        await db.put('fy-matches', matchId, {
          uids: pair, a: pair[0], b: pair[1], routeId: p.routeId, version: route.version, status: 'invited',
          invitedBy: u.uid, ready: [], invitedAt: now(), expiresAt: now() + 24 * HOUR
        })
        await db.put('fy-requests', requestKey, { matchId })
        return { id: matchId }
      })
    },

    async respondPk(u, p) {
      member(u)
      if (!requestOf(p.matchId) || typeof p.accept !== 'boolean') fail('INVALID_REQUEST')
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.invitedBy === u.uid) fail('NOT_FOUND')
        if (match.status !== 'invited') fail('NOT_PENDING')
        if (match.expiresAt <= now()) { await db.put('fy-matches', p.matchId, { ...match, status: 'expired' }); fail('EXPIRED') }
        if (!p.accept) { await db.put('fy-matches', p.matchId, { ...match, status: 'declined' }); return { id: p.matchId, status: 'declined' } }
        await assertNoAssignment(db, u.uid)
        if (await activeMatch(db, u.uid, p.matchId)) fail('CONFLICT')
        const snapshot = await db.get('fy-versions', match.version)
        const runs = {}
        for (const uid of match.uids) {
          const runId = key(uid, 'pk', p.matchId)
          await db.put('fy-runs', runId, {
            uid, routeId: match.routeId, version: match.version, snapshot, purpose: 'pk', matchId: p.matchId, createdAt: now(), revision: 0
          })
          runs[uid] = runId
        }
        await db.put('fy-matches', p.matchId, { ...match, status: 'preparing', runs })
        return { id: p.matchId, status: 'preparing' }
      })
    },

    async readyPk(u, p) {
      member(u)
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.status !== 'preparing') fail('NOT_PENDING')
        if (match.expiresAt <= now()) { await db.put('fy-matches', p.matchId, { ...match, status: 'expired' }); fail('EXPIRED') }
        const ready = [...new Set([...match.ready, u.uid])]
        const started = ready.length === match.uids.length
        await db.put('fy-matches', p.matchId, {
          ...match, ready, status: started ? 'running' : 'preparing', startedAt: started ? now() : null
        })
        return { id: p.matchId, status: started ? 'running' : 'preparing', startedAt: started ? now() : null }
      })
    },

    async settlePk(u, p) {
      member(u)
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.status === 'settled') {
          return { id: p.matchId, winner: match.winner, expired: false, eggPending: !match.eggId && match.winner === u.uid }
        }
        if (match.status !== 'running') fail('NOT_PENDING')
        if (now() > match.startedAt + 24 * HOUR) {
          await db.put('fy-matches', p.matchId, { ...match, status: 'expired', settledAt: now() })
          await db.put('fy-audit', key(p.matchId, 'pk-expire'), { action: 'pk-expire', matchId: p.matchId, at: now() })
          return { id: p.matchId, winner: null, expired: true }
        }
        const claimId = key(p.matchId, 'settlement')
        if (await db.get('fy-settlements', claimId)) {
          const settled = await db.get('fy-matches', p.matchId)
          return { id: p.matchId, winner: settled.winner, expired: false, eggPending: !settled.eggId && settled.winner === u.uid }
        }
        const run = await db.get('fy-runs', match.runs[u.uid])
        const checks = await db.list('fy-checkins', { runId: match.runs[u.uid], uid: u.uid })
        if (!run.snapshot.nodes.every(node => checks.some(check => check.nodeId === node.id))) fail('NOT_READY')
        const loser = match.uids.find(uid => uid !== u.uid)
        await db.put('fy-settlements', claimId, { winner: u.uid, at: now() })
        // 结算只产生胜负，彩蛋由胜者选定后才生成败者任务。
        await db.put('fy-matches', p.matchId, { ...match, status: 'settled', winner: u.uid, loser, settledAt: now() })
        return { id: p.matchId, winner: u.uid, expired: false, eggPending: true }
      })
    },

    async pkEggs(u, p) {
      member(u)
      if (!requestOf(p.matchId)) fail('INVALID_REQUEST')
      const match = await loadMatch(repo, p.matchId, u.uid)
      if (match.status !== 'settled' || match.winner !== u.uid || match.eggId) return []
      const snapshot = await repo.get('fy-versions', match.version)
      const loser = match.uids.find(uid => uid !== u.uid)
      const taken = await repo.get('fy-assignments', key(p.matchId, 'assignment', loser))
      if (taken) return []
      return routeEggs(snapshot).map(egg => ({
        id: egg.id, title: egg.title, description: egg.description, nodeId: egg.nodeId,
        nodeTitle: (snapshot?.nodes ?? []).find(node => node.id === egg.nodeId)?.title ?? egg.title
      }))
    },

    async chooseEgg(u, p) {
      member(u)
      if (!requestOf(p.matchId) || typeof p.eggId !== 'string') fail('INVALID_REQUEST')
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.status !== 'settled') fail('NOT_PENDING')
        if (match.winner !== u.uid) fail('FORBIDDEN')
        const loser = match.uids.find(uid => uid !== u.uid)
        const assignmentId = key(p.matchId, 'assignment', loser)
        if (match.eggId) {
          if (match.eggId === p.eggId) return { id: p.matchId, eggId: p.eggId, assignmentId }
          fail('CONFLICT')
        }
        const snapshot = await db.get('fy-versions', match.version)
        const egg = routeEggs(snapshot).find(item => item.id === p.eggId)
        if (!egg) fail('NOT_FOUND')
        await assignFailure(db, loser, p.matchId, egg, nodeTitleOf(snapshot, egg.nodeId, egg.title))
        await db.put('fy-matches', p.matchId, { ...match, eggId: egg.id, eggChosenAt: now() })
        return { id: p.matchId, eggId: egg.id, assignmentId }
      })
    },

    async forfeitPk(u, p) {
      member(u)
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.status !== 'running' && match.status !== 'preparing') fail('NOT_PENDING')
        const run = await db.get('fy-runs', match.runs[u.uid])
        const egg = routeEggs(run.snapshot)[0] ?? null
        const winner = match.uids.find(uid => uid !== u.uid)
        await db.put('fy-matches', p.matchId, {
          ...match, status: 'settled', winner, loser: u.uid, settledAt: now(), forfeitedBy: u.uid,
          ...(egg == null ? {} : { eggId: egg.id, eggChosenAt: now() })
        })
        if (egg != null) await assignFailure(db, u.uid, p.matchId, egg, nodeTitleOf(run.snapshot, egg.nodeId, egg.title))
        return { id: p.matchId, eggPending: false }
      })
    },

    async cancelPk(u, p) {
      if (!u?.admin) fail('FORBIDDEN')
      if (!requestOf(p.matchId)) fail('INVALID_REQUEST')
      return repo.tx(async db => {
        const match = await db.get('fy-matches', p.matchId)
        if (!match || !['running', 'preparing', 'invited'].includes(match.status)) fail('NOT_PENDING')
        await db.put('fy-matches', p.matchId, { ...match, status: 'cancelled', settledAt: now() })
        await db.put('fy-audit', key(p.matchId, 'pk-cancel'), {
          action: 'pk-cancel', matchId: p.matchId, reason: String(p.reason ?? '').slice(0, 200), at: now()
        })
        return { id: p.matchId }
      })
    },

    async assignment(u) {
      member(u)
      const rows = await repo.list('fy-assignments', { uid: u.uid })
      const open = rows.find(row => row.status === 'pending' || row.status === 'doing')
      return open
        ? {
            id: open._id, status: open.status, assignedAt: open.assignedAt, rejectAvailableAt: open.rejectAvailableAt,
            eggId: open.eggId ?? null, nodeId: open.nodeId, nodeTitle: open.nodeTitle,
            title: open.title ?? open.nodeTitle, description: open.description ?? ''
          }
        : null
    },

    async completeAssignment(u, p) {
      member(u)
      return repo.tx(async db => {
        const row = await db.get('fy-assignments', p.assignmentId)
        if (!row || row.uid !== u.uid) fail('NOT_FOUND')
        if (row.status !== 'pending' && row.status !== 'doing') fail('NOT_PENDING')
        await db.put('fy-assignments', p.assignmentId, { ...row, status: 'done', completedAt: now() })
        return { id: p.assignmentId }
      })
    },

    async rejectAssignment(u, p) {
      member(u)
      return repo.tx(async db => {
        const row = await db.get('fy-assignments', p.assignmentId)
        if (!row || row.uid !== u.uid) fail('NOT_FOUND')
        if (row.status !== 'pending' && row.status !== 'doing') fail('NOT_PENDING')
        if (now() < row.rejectAvailableAt) fail('TOO_EARLY')
        await db.put('fy-assignments', p.assignmentId, { ...row, status: 'rejected', rejectedAt: now() })
        return { id: p.assignmentId }
      })
    }
  }
}

module.exports = { pkMethods }
