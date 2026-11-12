const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPartnershipService } = require('../uniCloud-alipay/cloudfunctions/fy-api/partnership-service')

function setup() {
  const rows = new Map()
  const db = {
    async get(c, id) { return structuredClone(rows.get(c + id) ?? null) },
    async put(c, id, v) { rows.set(c + id, structuredClone({ ...v, _id: id })) },
    async list(c, q) {
      return [...rows].filter(([k, v]) => k.startsWith(c) && Object.entries(q).every(([a, b]) => v[a] === b)).map(([, v]) => structuredClone(v))
    }
  }
  let tail = Promise.resolve()
  const repo = {
    ...db, tx(fn) {
      const p = tail.then(async () => {
        const saved = structuredClone(rows)
        try { return await fn(db) } catch (e) { rows.clear(); for (const [k, v] of saved) rows.set(k, v); throw e }
      })
      tail = p.catch(() => {})
      return p
    }
  }
  let clock = 1000000
  const f = { repo, a: { uid: 'a' }, b: { uid: 'b' }, c: { uid: 'c' } }
  f.now = () => clock
  f.advance = ms => { clock += ms }
  f.p = createPartnershipService({ repo, now: () => f.now() })
  return f
}

async function ready() {
  const f = setup()
  f.codes = {}
  for (const u of [f.a, f.b, f.c]) f.codes[u.uid] = (await f.p.ensureProfile(u)).code
  return f
}

test('friend lookup uses public code and never returns uid', async () => {
  const f = await ready()
  const card = await f.p.findByCode(f.b, { code: f.codes.a })
  assert.equal(card.nickname.length > 0, true)
  assert.equal(card.uid, undefined)
  assert.equal(JSON.stringify(card).includes('"a"'), false)
  await assert.rejects(f.p.findByCode(f.b, { code: 'no-such-code' }), /NOT_FOUND/)
})

test('friend request expires after 24 hours and can be withdrawn before that', async () => {
  const f = await ready()
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  await f.p.withdrawFriend(f.a, { requestId: 'fr-1' })
  await assert.rejects(f.p.respondFriend(f.b, { requestId: 'fr-1', accept: true }), /NOT_PENDING/)
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-2' })
  f.advance(24 * 3600 * 1000 + 1)
  await assert.rejects(f.p.respondFriend(f.b, { requestId: 'fr-2', accept: true }), /EXPIRED/)
})

test('accepting makes both sides friends and cards stay public', async () => {
  const f = await ready()
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  await f.p.respondFriend(f.b, { requestId: 'fr-1', accept: true })
  const mine = await f.p.friends(f.a)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].code, f.codes.b)
  assert.equal(mine[0].uid, undefined)
  assert.equal((await f.p.friends(f.b))[0].code, f.codes.a)
})

test('the same request replays and a stranger cannot respond', async () => {
  const f = await ready()
  const first = await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  const again = await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  assert.equal(again.id, first.id)
  await assert.rejects(f.p.respondFriend(f.c, { requestId: 'fr-1', accept: true }), /NOT_FOUND/)
  await assert.rejects(f.p.requestFriend(f.a, { code: f.codes.a, requestId: 'fr-self' }), /INVALID_REQUEST/)
})

const { createService, key } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')

const coopDraft = {
  id: 'combined', revision: 0, name: '合并测试路线', region: '两地', description: '开发测试', testOnly: true,
  viewport: { latitude: 22, longitude: 113, scale: 16 }, museum: { name: '测试馆', description: '测试' },
  nodes: [{ id: 'n1', title: '澳门节点', description: '定位照片', latitude: 22, longitude: 113, radius: 100 },
    { id: 'n2', title: '湖南节点', description: '定位照片', latitude: 28, longitude: 113, radius: 100 }],
  culture: {
    tile: { title: '蓝白瓷砖配色', after: ['n1'] },
    quiz: { title: '湘绣辨认', after: ['n2'], prompt: '哪一幅是湘绣？', explanation: '针脚细密的是湘绣。',
      options: [{ id: 'a', label: '甲', illustration: 'threads' }, { id: 'b', label: '乙', illustration: 'tile' }], answer: 'a' },
    eggs: [
      { id: 'e1', title: '找回一块蓝白瓷砖', description: '在第一站附近找到蓝白瓷砖纹样。', nodeId: 'n1' },
      { id: 'e2', title: '找一段转向的针脚', description: '在第二站附近找到改变方向的线条。', nodeId: 'n2' }
    ]
  }
}

async function coopReady(accept = true, draft = coopDraft) {
  const f = await ready()
  f.service = createService({ repo: f.repo, now: () => f.now(), allowTestContent: true })
  const admin = { uid: 'admin', admin: true }
  await f.service.saveDraft(admin, draft)
  await f.service.publish(admin, { id: 'combined', revision: 1 })
  f.routeId = 'combined'
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-coop' })
  await f.p.respondFriend(f.b, { requestId: 'fr-coop', accept: true })
  f.team = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-1' })
  if (accept) await f.p.respondCoop(f.b, { teamId: f.team.id, accept: true })
  return f
}

test('both members can discover a coop invite and see the two seats progress', async () => {
  const f = await coopReady(false)
  assert.equal(await f.p.myCoop(f.c), null)
  const inviter = await f.p.myCoop(f.a)
  const invitee = await f.p.myCoop(f.b)
  assert.equal(inviter.id, f.team.id)
  assert.equal(inviter.status, 'invited')
  assert.equal(inviter.invitedByMe, true)
  assert.equal(invitee.invitedByMe, false)
  assert.deepEqual(invitee, await f.p.coopStatus(f.b, { teamId: f.team.id }))
  await f.p.respondCoop(f.b, { teamId: invitee.id, accept: true })
  await finishSeat(f, f.a, 'macau')
  const active = await f.p.myCoop(f.b)
  assert.equal(active.status, 'active')
  assert.equal(active.myProgress.done, 0)
  assert.deepEqual(active.partnerProgress, { done: 2, total: 2 })
  const run = await f.service.progress(f.b, { runId: active.myRunId })
  assert.deepEqual(run.snapshot.nodes.map(node => node.id), ['n2'])
  assert.deepEqual(run.snapshot.activities.map(activity => activity.id), ['quiz'])
  assert.equal(await f.service.routeProgress(f.b, { routeId: f.routeId }), null)
  assert.deepEqual((await f.service.catalog()).find(route => route.id === f.routeId).activities.map(activity => activity.after), [['n1'], ['n2']])
  await f.p.leaveCoop(f.b, { teamId: active.id })
  assert.equal(await f.p.myCoop(f.a), null)
})

async function finishSeat(f, user, seat) {
  const team = await f.repo.get('fy-teams', f.team.id)
  const runId = team.runs[user.uid]
  const nodes = seat === 'macau' ? team.seats.macauNodes : team.seats.hunanNodes
  for (const nodeId of nodes) {
    const cid = key(runId, nodeId)
    await f.repo.put('fy-checkins', cid, { uid: user.uid, runId, nodeId, createdAt: f.now() })
  }
  const run = await f.repo.get('fy-runs', runId)
  const culture = seat === 'macau' ? { tile: { pattern: 'sail', palette: 'cobalt' } } : { quiz: true }
  await f.repo.put('fy-runs', runId, { ...run, culture })
}

test('coop result is written once and anonymizes the partner', async () => {
  const f = await coopReady()
  const team = await f.repo.get('fy-teams', f.team.id)
  for (const [seat, uid] of [['macau', team.seats.macau], ['hunan', team.seats.hunan]]) {
    await finishSeat(f, { uid }, seat)
  }
  await f.p.settleCoop(f.a, { teamId: f.team.id })
  await f.p.settleCoop(f.b, { teamId: f.team.id })
  const mine = await f.p.coopStatus(f.a, { teamId: f.team.id })
  assert.equal(mine.result.partnerLabel, '湖南旅伴')
  assert.equal(mine.partner.code, f.codes.b)
  assert.equal(JSON.stringify(mine.public).includes(f.codes.b), false)
  assert.equal(JSON.stringify(mine.public).includes(mine.partner.nickname), false)
  assert.equal(JSON.stringify(mine).includes('"b"'), false)
  assert.equal((await f.repo.list('fy-results', {})).length, 1)
})

test('a user can hold only one active coop team', async () => {
  const f = await coopReady()
  await f.p.requestFriend(f.a, { code: f.codes.c, requestId: 'fr-c' })
  await f.p.respondFriend(f.c, { requestId: 'fr-c', accept: true })
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.c, routeId: f.routeId, requestId: 'co-2' }), /CONFLICT/)
})

test('coop settles only after both seats finish their nodes and culture tasks', async () => {
  const f = await coopReady()
  await assert.rejects(f.p.settleCoop(f.a, { teamId: f.team.id }), /NOT_READY/)
})

test('reading the last Hunan card completes that seat for coop settlement', async () => {
  const cards = ['line', 'color', 'layer', 'direction'].map(id => ({ id, title: id, hotspot: '观察', body: '针法示意' }))
  const draft = { ...coopDraft, culture: { ...coopDraft.culture, learning: { title: '针法学习', after: ['n2'], cards } } }
  const f = await coopReady(true, draft)
  await finishSeat(f, f.a, 'macau')
  await finishSeat(f, f.b, 'hunan')
  const { myRunId: runId } = await f.p.myCoop(f.b)
  await assert.rejects(f.p.settleCoop(f.b, { teamId: f.team.id }), /NOT_READY/)
  for (const { id: cardId } of cards) await f.service.readCard(f.b, { runId, cardId })
  assert.deepEqual((await f.p.myCoop(f.b)).myProgress, { done: 3, total: 3 })
  assert.equal((await f.p.settleCoop(f.b, { teamId: f.team.id })).alreadySettled, false)
})

test('leaving ends the team without deleting the partner run', async () => {
  const f = await coopReady()
  const before = (await f.repo.list('fy-runs', {})).length
  await f.p.leaveCoop(f.a, { teamId: f.team.id })
  assert.equal((await f.p.coopStatus(f.b, { teamId: f.team.id })).status, 'left')
  assert.equal((await f.repo.list('fy-runs', {})).length, before)
})

test('coop invite only reaches friends and expires after 24 hours', async () => {
  const f = await ready()
  f.service = createService({ repo: f.repo, now: () => f.now(), allowTestContent: true })
  const admin = { uid: 'admin', admin: true }
  await f.service.saveDraft(admin, coopDraft)
  await f.service.publish(admin, { id: 'combined', revision: 1 })
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.c, routeId: 'combined', requestId: 'co-x' }), /NOT_FRIENDS/)
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  await f.p.respondFriend(f.b, { requestId: 'fr-1', accept: true })
  const team = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: 'combined', requestId: 'co-1' })
  f.advance(24 * 3600 * 1000)
  await assert.rejects(f.p.respondCoop(f.b, { teamId: team.id, accept: true }), /EXPIRED/)
  assert.equal((await f.repo.list('fy-runs', { purpose: 'coop' })).length, 0)
})

test('coop lets each side pick their own culture task while nodes stay fixed', async () => {
  const cards = ['line', 'color', 'layer', 'direction'].map(id => ({ id, title: id, hotspot: '观察', body: '针法示意' }))
  const draft = { ...coopDraft, culture: {
    ...coopDraft.culture,
    tileQuiz: { title: '瓷砖辨认', after: ['n1'], prompt: '哪一张是船帆？', explanation: '三角形的是船帆。',
      options: [{ id: 'a', label: '甲', illustration: 'tile-sail' }, { id: 'b', label: '乙', illustration: 'tile' }], answer: 'a' },
    learning: { title: '针法学习', after: ['n2'], cards }
  } }
  const f = await coopReady(false, draft)
  await f.p.respondCoop(f.b, { teamId: f.team.id, accept: false })
  const team = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-2', activities: ['tile'] })
  const view = await f.p.coopStatus(f.b, { teamId: team.id })
  assert.deepEqual(view.myTaskOptions.map(task => task.id), ['quiz', 'learning'])
  assert.deepEqual(view.partnerTasks.map(task => task.id), ['tile'])
  await f.p.respondCoop(f.b, { teamId: team.id, accept: true, activities: ['learning'] })
  const accepted = await f.p.coopStatus(f.b, { teamId: team.id })
  assert.deepEqual(accepted.myTasks.map(task => task.id), ['learning'])
  assert.deepEqual(accepted.partnerTasks.map(task => task.id), ['tile'])
  assert.deepEqual(accepted.myProgress, { done: 0, total: 2 })
  const stored = await f.repo.get('fy-teams', team.id)
  const macauRunId = stored.runs[f.a.uid]
  for (const nodeId of stored.seats.macauNodes) {
    await f.repo.put('fy-checkins', key(macauRunId, nodeId), { uid: f.a.uid, runId: macauRunId, nodeId, createdAt: f.now() })
  }
  const macauRun = await f.repo.get('fy-runs', macauRunId)
  await f.repo.put('fy-runs', macauRunId, { ...macauRun, culture: { tile: { pattern: 'sail', palette: 'cobalt' } } })
  const runId = stored.runs[f.b.uid]
  for (const nodeId of stored.seats.hunanNodes) {
    await f.repo.put('fy-checkins', key(runId, nodeId), { uid: f.b.uid, runId, nodeId, createdAt: f.now() })
  }
  const run = await f.repo.get('fy-runs', runId)
  // 只完成所选的学习卡，未选的辨认题留空也能结算。
  await f.repo.put('fy-runs', runId, { ...run, culture: { learning: true } })
  assert.equal((await f.p.settleCoop(f.a, { teamId: team.id })).alreadySettled, false)
})

test('coop rejects tasks outside the seat or an empty selection', async () => {
  const f = await coopReady(false)
  await f.p.respondCoop(f.b, { teamId: f.team.id, accept: false })
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-bad', activities: ['quiz'] }), /INVALID_TASKS/)
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-empty', activities: [] }), /INVALID_TASKS/)
  const team = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-ok', activities: ['tile'] })
  await assert.rejects(f.p.respondCoop(f.b, { teamId: team.id, accept: true, activities: ['tile'] }), /INVALID_TASKS/)
  await assert.rejects(f.p.respondCoop(f.b, { teamId: team.id, accept: true, activities: [] }), /INVALID_TASKS/)
  assert.equal((await f.p.respondCoop(f.b, { teamId: team.id, accept: true, activities: ['quiz'] })).status, 'active')
})

test('teams saved before task selection still need every seat task', async () => {
  const cards = ['line', 'color', 'layer', 'direction'].map(id => ({ id, title: id, hotspot: '观察', body: '针法示意' }))
  const draft = { ...coopDraft, culture: { ...coopDraft.culture, learning: { title: '针法学习', after: ['n2'], cards } } }
  const f = await coopReady(true, draft)
  const stored = await f.repo.get('fy-teams', f.team.id)
  const legacy = { ...stored }
  delete legacy.tasks
  await f.repo.put('fy-teams', f.team.id, legacy)
  assert.deepEqual((await f.p.coopStatus(f.b, { teamId: f.team.id })).myTasks.map(task => task.id), ['quiz', 'learning'])
  await finishSeat(f, f.a, 'macau')
  await finishSeat(f, f.b, 'hunan')
  await assert.rejects(f.p.settleCoop(f.b, { teamId: f.team.id }), /NOT_READY/)
  const runId = stored.runs[f.b.uid]
  const run = await f.repo.get('fy-runs', runId)
  await f.repo.put('fy-runs', runId, { ...run, culture: { quiz: true, learning: true } })
  assert.equal((await f.p.settleCoop(f.b, { teamId: f.team.id })).alreadySettled, false)
})

async function pkStarted(start = true, draft = coopDraft) {
  const f = await ready()
  f.service = createService({ repo: f.repo, now: () => f.now(), allowTestContent: true })
  const admin = { uid: 'admin', admin: true }
  await f.service.saveDraft(admin, draft)
  await f.service.publish(admin, { id: 'combined', revision: 1 })
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-pk' })
  await f.p.respondFriend(f.b, { requestId: 'fr-pk', accept: true })
  f.match = await f.p.invitePk(f.a, { code: f.codes.b, routeId: 'combined', requestId: 'pk-1' })
  if (!start) return f
  await f.p.respondPk(f.b, { matchId: f.match.id, accept: true })
  await f.p.readyPk(f.a, { matchId: f.match.id })
  await f.p.readyPk(f.b, { matchId: f.match.id })
  f.startedAt = (await f.repo.get('fy-matches', f.match.id)).startedAt
  return f
}

test('PK discovery exposes only the running member run and keeps solo progress separate', async () => {
  const f = await pkStarted(false)
  assert.equal(await f.p.myPk(f.c), null)
  const invited = await f.p.myPk(f.b)
  assert.equal(invited.id, f.match.id)
  assert.equal(invited.status, 'invited')
  assert.equal(invited.invitedBy, f.a.uid)
  assert.equal(invited.expiresAt, f.now() + 24 * 3600 * 1000)
  const solo = await f.service.start(f.b, { routeId: 'combined', requestId: 'solo-run' })
  f.advance(1)
  await f.p.respondPk(f.b, { matchId: invited.id, accept: true })
  await f.p.readyPk(f.a, { matchId: invited.id })
  const preparing = await f.p.myPk(f.b)
  assert.deepEqual(preparing.ready, [f.a.uid])
  assert.equal(preparing.myRunId, null)
  const runId = (await f.repo.get('fy-matches', invited.id)).runs[f.b.uid]
  const point = { routeId: 'combined', nodeId: 'n1', requestId: 'pk-check', runId }
  await assert.rejects(f.service.mediaBinding(f.b, point), /NOT_PENDING/)
  await f.p.readyPk(f.b, { matchId: invited.id })
  const running = await f.p.myPk(f.b)
  assert.equal(running.startedAt, f.now())
  assert.equal(running.myRunId, runId)
  const pk = await f.service.progress(f.b, { runId })
  assert.deepEqual(pk.snapshot.activities, [])
  assert.equal((await f.service.routeProgress(f.b, { routeId: 'combined' })).runId, solo.id)
  await f.service.registerMedia(f.b, { ...point, id: 'pk-photo', fileID: 'private' })
  await f.service.checkin(f.b, { ...point, mediaId: 'pk-photo', latitude: 22, longitude: 113 })
  assert.equal(await f.service.nodeRecord(f.b, { routeId: point.routeId, nodeId: point.nodeId }), null)
  assert.equal((await f.service.nodeRecord(f.b, point)).mediaId, 'pk-photo')
  await assert.rejects(f.service.nodeRecord(f.a, point), /NOT_FOUND/)
  assert.deepEqual((await f.service.progress(f.b, { runId: solo.id })).completed, [])
  await f.p.forfeitPk(f.b, { matchId: invited.id })
  assert.equal(await f.p.myPk(f.b), null)
})

async function completeAllNodes(f, user) {
  const match = await f.repo.get('fy-matches', f.match.id)
  const runId = match.runs[user.uid]
  const run = await f.repo.get('fy-runs', runId)
  for (const node of run.snapshot.nodes) {
    await f.repo.put('fy-checkins', key(runId, node.id), { uid: user.uid, runId, nodeId: node.id, createdAt: f.now() })
  }
}

test('concurrent first submissions settle the match exactly once', async () => {
  const f = await pkStarted()
  await completeAllNodes(f, f.a)
  await completeAllNodes(f, f.b)
  const results = await Promise.all([f.p.settlePk(f.a, { matchId: f.match.id }), f.p.settlePk(f.b, { matchId: f.match.id })])
  const winners = results.map(r => r.winner).filter(Boolean)
  assert.equal(new Set(winners).size, 1)
  const loser = winners[0] === f.a.uid ? f.b : f.a
  const winner = winners[0] === f.a.uid ? f.a : f.b
  // 结算只决定胜负，败者在胜者挑彩蛋前不受影响。
  assert.equal(await f.p.assignment(loser), null)
  assert.equal((await f.repo.list('fy-assignments', {})).length, 0)
  const pending = await f.p.myPk(winner)
  assert.equal(pending.status, 'settled')
  assert.equal(pending.eggPending, true)
  assert.equal(await f.p.myPk(loser), null)
  const eggs = await f.p.pkEggs(winner, { matchId: f.match.id })
  assert.deepEqual(eggs.map(egg => egg.id), ['e1', 'e2'])
  assert.deepEqual(await f.p.pkEggs(loser, { matchId: f.match.id }), [])
  await assert.rejects(f.p.chooseEgg(loser, { matchId: f.match.id, eggId: 'e1' }), /FORBIDDEN/)
  assert.equal(await f.p.assignment(loser), null)
  await f.p.chooseEgg(winner, { matchId: f.match.id, eggId: 'e2' })
  const task = await f.p.assignment(loser)
  assert.equal(task.status, 'pending')
  assert.equal(task.title, '找一段转向的针脚')
  assert.equal(task.description, '在第二站附近找到改变方向的线条。')
  assert.equal(task.nodeId, 'n2')
  assert.equal(task.nodeTitle, '湖南节点')
  assert.equal((await f.repo.list('fy-assignments', {})).length, 1)
  // 重复提交同一彩蛋幂等，换成别的彩蛋冲突。
  await f.p.chooseEgg(winner, { matchId: f.match.id, eggId: 'e2' })
  await assert.rejects(f.p.chooseEgg(winner, { matchId: f.match.id, eggId: 'e1' }), /CONFLICT/)
  assert.deepEqual(await f.p.pkEggs(winner, { matchId: f.match.id }), [])
  assert.equal(await f.p.myPk(winner), null)
})

test('a route without eggs falls back to its first node', async () => {
  const draft = { ...coopDraft, culture: { tile: coopDraft.culture.tile, quiz: coopDraft.culture.quiz } }
  const f = await pkStarted(true, draft)
  await completeAllNodes(f, f.a)
  await completeAllNodes(f, f.b)
  const { winner } = await f.p.settlePk(f.a, { matchId: f.match.id })
  const winnerUser = winner === f.a.uid ? f.a : f.b
  const loser = winner === f.a.uid ? f.b : f.a
  const eggs = await f.p.pkEggs(winnerUser, { matchId: f.match.id })
  assert.deepEqual(eggs.map(egg => egg.id), ['fallback'])
  await f.p.chooseEgg(winnerUser, { matchId: f.match.id, eggId: 'fallback' })
  assert.equal((await f.p.assignment(loser)).nodeId, 'n1')
})

test('an unfinished match expires after 24 hours without an assignment', async () => {
  const f = await pkStarted()
  f.advance(24 * 3600 * 1000 + 1)
  const r = await f.p.settlePk(f.a, { matchId: f.match.id })
  assert.equal(r.expired, true)
  assert.equal(await f.p.assignment(f.b), null)
  assert.equal((await f.repo.list('fy-audit', {})).filter(row => row.action === 'pk-expire').length, 1)
})

test('a failure task locks the next match until rejected after 72 hours', async () => {
  const f = await pkStarted()
  await f.p.forfeitPk(f.a, { matchId: f.match.id })
  const task = await f.p.assignment(f.a)
  await assert.rejects(f.p.invitePk(f.a, { code: f.codes.b, routeId: 'combined', requestId: 'pk-2' }), /ASSIGNMENT_PENDING/)
  f.advance(72 * 3600 * 1000 - 1)
  await assert.rejects(f.p.rejectAssignment(f.a, { assignmentId: task.id }), /TOO_EARLY/)
  f.advance(1)
  await f.p.rejectAssignment(f.a, { assignmentId: task.id })
  assert.equal(await f.p.assignment(f.a), null)
})

test('an admin cancellation ends the match with no failure task', async () => {
  const f = await pkStarted()
  await f.p.cancelPk({ uid: 'admin', admin: true }, { matchId: f.match.id, reason: '路线关闭' })
  assert.equal(await f.p.assignment(f.a), null)
  assert.equal(await f.p.assignment(f.b), null)
})
