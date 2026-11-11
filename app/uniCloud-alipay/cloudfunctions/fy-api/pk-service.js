const HOUR = 3600 * 1000

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
  async function assignFailure(db, uid, matchId, snapshot) {
    const node = snapshot.nodes[0]
    await db.put('fy-assignments', key(matchId, 'assignment', uid), {
      uid, matchId, status: 'pending', nodeId: node.id, nodeTitle: node.title,
      assignedAt: now(), rejectAvailableAt: now() + 72 * HOUR
    })
  }

  return {
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
        if (match.status === 'settled') return { id: p.matchId, winner: match.winner, expired: false }
        if (match.status !== 'running') fail('NOT_PENDING')
        if (now() > match.startedAt + 24 * HOUR) {
          await db.put('fy-matches', p.matchId, { ...match, status: 'expired', settledAt: now() })
          await db.put('fy-audit', key(p.matchId, 'pk-expire'), { action: 'pk-expire', matchId: p.matchId, at: now() })
          return { id: p.matchId, winner: null, expired: true }
        }
        const claimId = key(p.matchId, 'settlement')
        if (await db.get('fy-settlements', claimId)) {
          const settled = await db.get('fy-matches', p.matchId)
          return { id: p.matchId, winner: settled.winner, expired: false }
        }
        const run = await db.get('fy-runs', match.runs[u.uid])
        const checks = await db.list('fy-checkins', { runId: match.runs[u.uid], uid: u.uid })
        if (!run.snapshot.nodes.every(node => checks.some(check => check.nodeId === node.id))) fail('NOT_READY')
        const loser = match.uids.find(uid => uid !== u.uid)
        await db.put('fy-settlements', claimId, { winner: u.uid, at: now() })
        await db.put('fy-matches', p.matchId, { ...match, status: 'settled', winner: u.uid, settledAt: now() })
        await assignFailure(db, loser, p.matchId, run.snapshot)
        return { id: p.matchId, winner: u.uid, expired: false }
      })
    },

    async forfeitPk(u, p) {
      member(u)
      return repo.tx(async db => {
        const match = await loadMatch(db, p.matchId, u.uid)
        if (match.status !== 'running' && match.status !== 'preparing') fail('NOT_PENDING')
        const run = await db.get('fy-runs', match.runs[u.uid])
        await db.put('fy-matches', p.matchId, {
          ...match, status: 'settled', winner: match.uids.find(uid => uid !== u.uid), settledAt: now(), forfeitedBy: u.uid
        })
        await assignFailure(db, u.uid, p.matchId, run.snapshot)
        return { id: p.matchId }
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
        ? { id: open._id, status: open.status, assignedAt: open.assignedAt, rejectAvailableAt: open.rejectAvailableAt, nodeId: open.nodeId, nodeTitle: open.nodeTitle }
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
