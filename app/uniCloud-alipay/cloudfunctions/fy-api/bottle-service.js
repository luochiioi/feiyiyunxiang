const routeIds = { macau: 'yinian-guiqi-macau', hunan: 'yinian-guiqi-hunan' }
const ttl = 24 * 60 * 60 * 1000

function bottleMethods({ repo, now, key, fail, member, requestOf, activeTeam, lockCoopSlots }) {
  const bottleId = uid => key('bottle', uid)
  const collection = 'fy-bottles'

  async function view(row, at) {
    if (row == null || (row.expiresAt <= at && row.status !== 'paired') || row.status === 'declined' || row.status === 'withdrawn') return null
    if (row.status === 'paired') {
      const team = await repo.get('fy-teams', row.teamId)
      if (team?.status !== 'active') return null
      return { status: 'paired', teamId: row.teamId, region: row.region, mode: row.mode }
    }
    const output = { status: row.status, region: row.region, mode: row.mode, expiresAt: row.expiresAt }
    if (row.status !== 'matched') return output
    const other = await repo.get(collection, bottleId(row.peer))
    if (other?.matchId !== row.matchId || other.status !== 'matched') return null
    const profile = (await repo.list('fy-profiles', { uid: row.peer }))[0]
    return { ...output, matchId: row.matchId, accepted: row.accepted, partnerAccepted: other.accepted,
      partner: { nickname: profile?.nickname ?? '旅伴', region: other.region } }
  }

  async function routeFor(db, region) {
    const routeId = routeIds[region]
    const current = await db.get('fy-routes', routeId)
    if (!current?.enabled || current.testOnly) fail('INVALID_ROUTE')
    const snapshot = await db.get('fy-versions', current.version)
    if (!snapshot || snapshot.testOnly || snapshot.nodes.length === 0) fail('INVALID_ROUTE')
    return { region, routeId, version: current.version }
  }

  return {
    async bottleStatus(u) {
      member(u)
      return view(await repo.get(collection, bottleId(u.uid)), now())
    },

    async joinBottle(u, p) {
      member(u)
      if (!requestOf(p.requestId) || !Object.hasOwn(routeIds, p.region) ||
        (p.mode !== 'same' && p.mode !== 'cross')) fail('INVALID_REQUEST')
      const at = now()
      const region = p.mode === 'same' ? p.region : (p.region === 'macau' ? 'hunan' : 'macau')
      const candidates = await repo.page(collection, { region, mode: p.mode, status: 'waiting' },
        { field: 'expiresAt', after: at, size: 20 })
      const id = bottleId(u.uid)
      const result = await repo.tx(async db => {
        const old = await db.get(collection, id)
        if (old?.status === 'paired' && (await db.get('fy-teams', old.teamId))?.status === 'active') return old
        if (old?.status === 'matched' && old.expiresAt > at) return old
        if (old?.requestId === p.requestId && (old.status !== 'waiting' || old.expiresAt <= at)) return null
        if (await activeTeam(db, u.uid, at)) fail('CONFLICT')
        const row = old?.status === 'waiting' && old.expiresAt > at && old.mode === p.mode && old.region === p.region
          ? old : { uid: u.uid, region: p.region, mode: p.mode, route: await routeFor(db, p.region),
            requestId: p.requestId, status: 'waiting', expiresAt: at + ttl }
        for (const candidate of candidates) {
          if (candidate._id === id) continue
          const peer = await db.get(collection, candidate._id)
          if (peer?.status !== 'waiting' || peer.expiresAt <= at || peer.region !== region || peer.mode !== p.mode ||
            await activeTeam(db, peer.uid, at)) continue
          const matchId = key('bottle-match', ...[row.uid + ':' + row.requestId, peer.uid + ':' + peer.requestId].sort())
          const expiresAt = Math.min(row.expiresAt, peer.expiresAt)
          const matched = { ...row, status: 'matched', matchId, peer: peer.uid, accepted: false, expiresAt }
          await db.put(collection, candidate._id, { ...peer, status: 'matched', matchId, peer: u.uid, accepted: false, expiresAt })
          await db.put(collection, id, matched)
          return matched
        }
        if (row !== old) await db.put(collection, id, row)
        return row
      })
      return view(result, now())
    },

    async respondBottle(u, p) {
      member(u)
      if (!requestOf(p.matchId) || typeof p.accept !== 'boolean') fail('INVALID_REQUEST')
      const id = bottleId(u.uid)
      const row = await repo.tx(async db => {
        const own = await db.get(collection, id)
        if (own?.matchId !== p.matchId) fail('NOT_FOUND')
        if (own.status === 'paired') return own
        if (own.status !== 'matched' || own.expiresAt <= now()) fail('EXPIRED')
        const peerId = bottleId(own.peer)
        const peer = await db.get(collection, peerId)
        if (peer?.matchId !== own.matchId || peer.status !== 'matched') fail('NOT_PENDING')
        if (!p.accept) {
          await db.put(collection, peerId, { ...peer, status: 'declined' })
          await db.put(collection, id, { ...own, status: 'declined' })
          return null
        }
        const accepted = { ...own, accepted: true }
        if (!peer.accepted) {
          if (!own.accepted) {
            // Both confirmations write the pair, so concurrent accepts retry against the latest state.
            await db.put(collection, peerId, peer)
            await db.put(collection, id, accepted)
          }
          return accepted
        }
        const at = now()
        if (await activeTeam(db, own.uid, at) || await activeTeam(db, peer.uid, at)) fail('CONFLICT')
        const members = [own.uid, peer.uid].sort()
        await lockCoopSlots(db, members, at)
        const runs = {}
        const memberRoutes = {}
        for (const item of [own, peer]) {
          const { routeId, version } = item.route
          const snapshot = await db.get('fy-versions', version)
          if (snapshot == null) fail('INVALID_ROUTE')
          const runId = key(item.uid, 'coop', own.matchId)
          await db.put('fy-runs', runId, { uid: item.uid, routeId, version, snapshot, purpose: 'coop',
            bottle: true, teamId: own.matchId, createdAt: at, revision: 0 })
          runs[item.uid] = runId
          memberRoutes[item.uid] = item.route
        }
        await db.put('fy-teams', own.matchId, { members, a: members[0], b: members[1], memberRoutes,
          routeId: own.route.routeId, version: own.route.version, status: 'active', runs, startedAt: at })
        const paired = { ...accepted, status: 'paired', teamId: own.matchId }
        await db.put(collection, peerId, { ...peer, status: 'paired', teamId: own.matchId })
        await db.put(collection, id, paired)
        return paired
      })
      return view(row, now())
    },

    async cancelBottle(u) {
      member(u)
      const id = bottleId(u.uid)
      return repo.tx(async db => {
        const row = await db.get(collection, id)
        if (row == null || row.status !== 'waiting') fail('NOT_PENDING')
        await db.put(collection, id, { ...row, status: 'withdrawn' })
        return null
      })
    }
  }
}

module.exports = { bottleMethods }
