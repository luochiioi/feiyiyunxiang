const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isDeepStrictEqual } = require('node:util')
const { createPartnershipService } = require('../uniCloud-alipay/cloudfunctions/fy-api/partnership-service')

function setup() {
  const rows = new Map()
  const db = {
    async get(c, id) { return structuredClone(rows.get(c + id) ?? null) },
    async put(c, id, v) { rows.set(c + id, structuredClone({ ...v, _id: id })) },
    async list(c, q) {
      return [...rows].filter(([k, v]) => k.startsWith(c) && Object.entries(q).every(([a, b]) =>
        Array.isArray(b) ? b.includes(v[a]) : v[a] === b)).map(([, v]) => structuredClone(v))
    }
  }
  db.page = async (collection, filter, { field, after, size }) => (await db.list(collection, filter))
    .filter(row => after == null || row[field] > after).sort((left, right) => left[field].localeCompare(right[field])).slice(0, size)
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
  for (const u of [f.a, f.b, f.c]) {
    await f.repo.put('uni-id-users', u.uid, { status: 0 })
    f.codes[u.uid] = (await f.p.ensureProfile(u)).code
  }
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

test('an expired coop invite releases both players and cannot create runs', async () => {
  const f = await coopReady(false)
  f.advance(24 * 3600 * 1000)
  assert.equal(await f.p.myCoop(f.a), null)
  assert.equal(await f.p.myCoop(f.b), null)
  assert.equal((await f.p.coopStatus(f.a, { teamId: f.team.id })).status, 'expired')
  await assert.rejects(f.p.respondCoop(f.b, { teamId: f.team.id, accept: true }), /EXPIRED/)
  assert.equal((await f.repo.get('fy-teams', f.team.id)).status, 'expired')
  assert.deepEqual(await f.repo.list('fy-runs', {}), [])
  const fresh = await f.p.inviteCoop(f.b, { code: f.codes.a, routeId: f.routeId, requestId: 'co-fresh' })
  assert.notEqual(fresh.id, f.team.id)
  assert.equal((await f.p.myCoop(f.a)).id, fresh.id)
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

test('a legacy invitation with no seat options can be accepted and read back', async () => {
  const f = await coopReady(false)
  const team = await f.repo.get('fy-teams', f.team.id)
  const snapshot = await f.repo.get('fy-versions', team.version)
  const legacyVersion = 'legacy-hunan-version'
  await f.repo.put('fy-versions', legacyVersion, { ...snapshot, culture: {}, nodes: snapshot.nodes.slice(1) })
  await f.repo.put('fy-teams', f.team.id, { ...team, memberRoutes: {
    [f.a.uid]: { region: 'macau', routeId: team.routeId, version: team.version },
    [f.b.uid]: { region: 'hunan', routeId: 'legacy-hunan', version: legacyVersion }
  } })
  const request = { teamId: f.team.id, accept: true }
  assert.deepEqual((await f.p.myCoop(f.b)).myTaskOptions, [])
  await assert.rejects(f.p.respondCoop(f.b, { ...request, activities: [] }), /INVALID_TASKS/)
  await f.p.respondCoop(f.b, request)
  const visible = await f.p.myCoop(f.b)
  assert.equal(visible.status, 'active')
  assert.deepEqual(visible.myTasks, [])
  assert.equal(visible.myProgress.total, 1)
  assert.deepEqual((await f.p.myCoop(f.a)).partnerTasks, [])
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

for (const [label, act] of [
  ['accept', (f, matchId) => f.p.respondPk(f.b, { matchId, accept: true })],
  ['decline', (f, matchId) => f.p.respondPk(f.b, { matchId, accept: false })],
  ['ready', (f, matchId) => f.p.readyPk(f.b, { matchId })]
]) {
  test(`expired PK ${label} persists the expiry and frees both participants`, async () => {
    const f = await pkStarted(false)
    if (label === 'ready') await f.p.respondPk(f.b, { matchId: f.match.id, accept: true })
    f.advance(24 * 3600 * 1000)
    await assert.rejects(act(f, f.match.id), /EXPIRED/)
    assert.equal((await f.repo.get('fy-matches', f.match.id)).status, 'expired')
    await assert.rejects(act(f, f.match.id), /EXPIRED/)
    assert.equal(await f.p.myPk(f.a), null)
    assert.equal(await f.p.myPk(f.b), null)
    const [sender, code] = label === 'decline' ? [f.a, f.codes.b] : [f.b, f.codes.a]
    const next = await f.p.invitePk(sender, { code, routeId: 'combined', requestId: 'next-pk' })
    assert.equal((await f.p.myPk(f.a)).id, next.id)
    assert.equal((await f.p.myPk(f.b)).id, next.id)
  })
}

for (const status of ['invited', 'preparing']) {
  test(`PK ${status} occupies a slot up to its deadline, even without a late action`, async () => {
    const f = await pkStarted(false)
    if (status === 'preparing') await f.p.respondPk(f.b, { matchId: f.match.id, accept: true })
    const nextInvite = () => f.p.invitePk(f.b, { code: f.codes.a, routeId: 'combined', requestId: 'next-pk' })
    f.advance(24 * 3600 * 1000 - 1)
    assert.equal((await f.p.myPk(f.a)).status, status)
    await assert.rejects(nextInvite(), /CONFLICT/)
    f.advance(1)
    assert.equal(await f.p.myPk(f.a), null)
    assert.equal(await f.p.myPk(f.b), null)
    const next = await nextInvite()
    if (status === 'preparing') await assert.rejects(f.p.readyPk(f.b, { matchId: f.match.id }), /EXPIRED/)
    else await assert.rejects(f.p.respondPk(f.b, { matchId: f.match.id, accept: true }), /EXPIRED/)
    assert.equal((await f.p.myPk(f.a)).id, next.id)
    assert.equal((await f.p.myPk(f.b)).id, next.id)
    assert.equal(await f.p.assignment(f.b), null)
    assert.equal(await f.p.assignment(f.a), null)
  })
}

test('forfeiting an expired preparation leaves a replacement PK and both players unpenalized', async () => {
  const f = await pkStarted(false)
  await f.p.respondPk(f.b, { matchId: f.match.id, accept: true })
  f.advance(24 * 3600 * 1000)
  const next = await f.p.invitePk(f.b, { code: f.codes.a, routeId: 'combined', requestId: 'next-pk' })
  await assert.rejects(f.p.forfeitPk(f.a, { matchId: f.match.id }), /EXPIRED/)
  assert.equal((await f.repo.get('fy-matches', f.match.id)).status, 'expired')
  for (const user of [f.a, f.b]) {
    assert.equal((await f.p.myPk(user)).id, next.id)
    assert.equal(await f.p.assignment(user), null)
  }
})

test('a PK readiness transaction crossing the deadline cannot commit alongside a replacement', async () => {
  const f = await pkStarted(false)
  await f.p.respondPk(f.b, { matchId: f.match.id, accept: true })
  await f.p.readyPk(f.a, { matchId: f.match.id })
  let reachedWrite, finishWrite
  const paused = new Promise(resolve => { reachedWrite = resolve })
  const resume = new Promise(resolve => { finishWrite = resolve })
  const optimisticRepo = { ...f.repo, async tx(work) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const writes = []
      const value = await work({ ...f.repo, async put(collection, id, next) {
        writes.push({ collection, id, next, previous: await f.repo.get(collection, id) })
        if (collection === 'fy-matches' && next.status === 'running') { reachedWrite(); await resume }
      } })
      const committed = await f.repo.tx(async db => {
        for (const write of writes) {
          if (!isDeepStrictEqual(await db.get(write.collection, write.id), write.previous)) return false
        }
        for (const { collection, id, next } of writes) await db.put(collection, id, next)
        return true
      })
      if (committed) return value
    }
    throw new Error('TRANSACTION_CONFLICT')
  } }
  const service = createPartnershipService({ repo: optimisticRepo, now: f.now })
  f.advance(24 * 3600 * 1000 - 1)
  const finalReady = service.readyPk(f.b, { matchId: f.match.id })
  const result = assert.rejects(finalReady, /EXPIRED/)
  await paused
  let next
  try {
    f.advance(1)
    next = await service.invitePk(f.b, { code: f.codes.a, routeId: 'combined', requestId: 'next-pk' })
  } finally { finishWrite() }
  await result
  assert.equal((await f.p.myPk(f.a)).id, next.id)
  assert.equal((await f.p.myPk(f.b)).id, next.id)
})

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

test('a failure task can be cleared by answering the published culture quiz', async () => {
  const f = await pkStarted()
  await f.p.forfeitPk(f.a, { matchId: f.match.id })
  const task = await f.p.assignment(f.a)
  assert.equal(task.quizAvailable, true)
  const quiz = await f.p.assignmentQuiz(f.a, { assignmentId: task.id })
  assert.equal(quiz.prompt, '哪一幅是湘绣？')
  assert.equal(quiz.answer, undefined)
  assert.deepEqual(quiz.options.map(option => option.id), ['a', 'b'])
  await assert.rejects(f.p.assignmentQuiz(f.b, { assignmentId: task.id }), /NOT_FOUND/)
  // 错答保留任务并允许重试
  const wrong = await f.p.answerAssignment(f.a, { assignmentId: task.id, optionId: 'b' })
  assert.equal(wrong.correct, false)
  assert.equal(wrong.attempts, 1)
  assert.equal((await f.p.assignment(f.a)).status, 'pending')
  // 答对即完成，解除下一场限制
  const right = await f.p.answerAssignment(f.a, { assignmentId: task.id, optionId: 'a' })
  assert.equal(right.correct, true)
  assert.equal(await f.p.assignment(f.a), null)
  const again = await f.p.answerAssignment(f.a, { assignmentId: task.id, optionId: 'a' })
  assert.equal(again.correct, true)
  assert.equal(again.alreadyDone, true)
  const next = await f.p.invitePk(f.a, { code: f.codes.b, routeId: 'combined', requestId: 'pk-2' })
  assert.ok(next.id)
})

test('an unfinished match expires after 24 hours without an assignment', async () => {
  const f = await pkStarted()
  f.advance(24 * 3600 * 1000 + 1)
  assert.equal((await f.p.myPk(f.a)).status, 'running')
  await assert.rejects(f.p.invitePk(f.a, { code: f.codes.b, routeId: 'combined', requestId: 'pk-2' }), /CONFLICT/)
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

async function bottleReady() {
  const fs = require('node:fs')
  const path = require('node:path')
  const { stripTypeScriptTypes } = require('node:module')
  const source = fs.readFileSync(path.join(__dirname, '../../admin/features/stage-three-content.uts'), 'utf8')
  const { museumRouteDraft } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  const f = await ready()
  f.service = createService({ repo: f.repo, now: f.now, allowTestContent: false })
  f.admin = { uid: 'admin', admin: true }
  f.routes = { macau: museumRouteDraft(true), hunan: museumRouteDraft(false) }
  f.versions = {}
  for (const [region, draft] of Object.entries(f.routes)) {
    await f.service.saveDraft(f.admin, draft)
    const saved = await f.repo.get('fy-drafts', draft.id)
    await f.repo.put('fy-drafts', draft.id, { ...saved, contentVerified: true })
    f.versions[region] = (await f.service.publish(f.admin, { id: draft.id, revision: 1 })).version
  }
  return f
}

test('friends can invite from either formal museum, keep pinned versions, and receive an anonymous keepsake at settlement', async () => {
  const f = await bottleReady()
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'museum-friend' })
  await f.p.respondFriend(f.b, { requestId: 'museum-friend', accept: true })
  const { macau, hunan } = f.routes
  const first = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: macau.id, seat: 'macau', requestId: 'macau-invite' })
  assert.equal((await f.p.coopStatus(f.b, { teamId: first.id })).routeId, hunan.id)
  assert.equal((await f.p.coopStatus(f.b, { teamId: first.id })).mySeat, 'hunan')
  assert.deepEqual(await f.repo.list('fy-runs', {}), [])
  await assert.rejects(f.p.withdrawCoop(f.b, { teamId: first.id }), /NOT_PENDING/)
  await f.p.withdrawCoop(f.a, { teamId: first.id })
  await assert.rejects(f.p.respondCoop(f.b, { teamId: first.id, accept: true }), /NOT_PENDING/)
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.b, routeId: hunan.id, seat: 'macau', requestId: 'wrong-seat' }), /INVALID_REQUEST/)
  const second = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: hunan.id, requestId: 'hunan-invite', activities: ['quiz'] })
  const newMacau = { ...macau, revision: 1, name: '新澳门路线' }
  await f.service.saveDraft(f.admin, newMacau)
  const draft = await f.repo.get('fy-drafts', macau.id)
  await f.repo.put('fy-drafts', macau.id, { ...draft, contentVerified: true })
  assert.notEqual((await f.service.publish(f.admin, { id: macau.id, revision: 2 })).version, f.versions.macau)
  await assert.rejects(f.p.respondCoop(f.c, { teamId: second.id, accept: true }), /NOT_FOUND/)
  await f.p.respondCoop(f.b, { teamId: second.id, accept: true, activities: ['tile'] })
  const runs = []
  for (const [user, region] of [[f.a, 'hunan'], [f.b, 'macau']]) {
    const local = f.routes[region]
    const { myRunId: runId, routeId, version } = await f.p.myCoop(user)
    assert.equal(routeId, local.id)
    assert.equal(version, f.versions[region])
    assert.equal((await f.service.coopStory(user, { runId })).keepsake, undefined)
    const node = local.nodes[0]
    const visit = { runId, nodeId: node.id, requestId: 'invite-' + region, latitude: node.latitude, longitude: node.longitude }
    const mediaId = 'invite-photo-' + region
    await f.service.registerMedia(user, { ...visit, id: mediaId, fileID: 'private' })
    await assert.rejects(f.service.checkin(user, { ...visit, mediaId, clueAnswer: 'wrong' }), /CLUE_INCORRECT/)
    await f.service.checkin(user, { ...visit, mediaId, clueAnswer: node.clue.answer })
    if (region === 'macau') await f.service.saveTile(user, { runId, pattern: 'sail', palette: 'cobalt' })
    else await f.service.answerQuiz(user, { runId, option: local.culture.quiz.answer })
    runs.push([user, runId])
  }
  await f.p.settleCoop(f.a, { teamId: second.id })
  for (const [user, runId] of runs) {
    const story = await f.service.coopStory(user, { runId })
    assert.equal(story.full, true)
    assert.deepEqual(story.keepsake, { pattern: 'sail', palette: 'cobalt' })
    await assert.rejects(f.service.coopStory(f.c, { runId }), /NOT_FOUND/)
  }
})

test('leaving a formal friend team blocks new writes but keeps personal records', async () => {
  const f = await bottleReady()
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'leave-friend' })
  await f.p.respondFriend(f.b, { requestId: 'leave-friend', accept: true })
  const route = f.routes.macau
  await f.repo.put('fy-routes', f.routes.hunan.id, { enabled: false })
  await assert.rejects(f.p.inviteCoop(f.a, { code: f.codes.b, routeId: route.id, requestId: 'disabled' }), /INVALID_ROUTE/)
  await f.repo.put('fy-routes', f.routes.hunan.id, { enabled: true, version: f.versions.hunan })
  const invite = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: route.id, requestId: 'leave-invite' })
  await f.p.respondCoop(f.b, { teamId: invite.id, accept: true })
  const { myRunId: runId } = await f.p.myCoop(f.a)
  const { myRunId: otherRun } = await f.p.myCoop(f.b)
  const node = route.nodes[0]
  const visit = { runId, nodeId: node.id, requestId: 'leave-visit', latitude: node.latitude, longitude: node.longitude }
  await f.service.registerMedia(f.a, { ...visit, id: 'left-photo', fileID: 'private' })
  await f.service.checkin(f.a, { ...visit, mediaId: 'left-photo', clueAnswer: node.clue.answer })
  await f.p.leaveCoop(f.b, { teamId: invite.id })
  assert.equal(await f.p.myCoop(f.a), null)
  assert.equal(await f.p.myCoop(f.b), null)
  await assert.rejects(f.service.mediaBinding(f.b, { runId: otherRun, nodeId: f.routes.hunan.nodes[0].id, requestId: 'late' }), /NOT_PENDING/)
  await assert.rejects(f.service.saveTile(f.a, { runId, pattern: 'rose', palette: 'mist' }), /NOT_PENDING/)
  assert.deepEqual((await f.service.progress(f.a, { runId })).completed, [node.id])
  assert.equal((await f.service.readMedia(f.a, { id: 'left-photo' })).fileID, 'private')
  assert.equal((await f.service.coopStory(f.a, { runId })).keepsake, undefined)
  await assert.rejects(f.p.settleCoop(f.a, { teamId: invite.id }), /NOT_PENDING/)
})

test('cross-region bottles require both users and create separate private museum explorations once', async () => {
  const f = await bottleReady()
  const a = await f.p.joinBottle(f.a, { region: 'macau', mode: 'cross', requestId: 'bottle-a' })
  assert.equal(a.status, 'waiting')
  const b = await f.p.joinBottle(f.b, { region: 'hunan', mode: 'cross', requestId: 'bottle-b' })
  assert.equal(b.status, 'matched')
  assert.deepEqual(Object.keys(b.partner).sort(), ['nickname', 'region'])
  assert.equal(b.partner.region, 'macau')
  assert.equal(await f.p.bottleStatus(f.c), null)
  await assert.rejects(f.p.respondBottle(f.c, { matchId: b.matchId, accept: true }), /NOT_FOUND/)
  await f.p.respondBottle(f.b, { matchId: b.matchId, accept: true })
  assert.deepEqual(await f.repo.list('fy-runs', {}), [])
  const payload = { matchId: b.matchId, accept: true }
  const [accepted, replay] = await Promise.all([f.p.respondBottle(f.a, payload), f.p.respondBottle(f.a, payload)])
  assert.equal(accepted.status, 'paired')
  assert.deepEqual(accepted, replay)
  assert.equal((await f.repo.list('fy-runs', {})).length, 2)
  assert.equal((await f.p.friends(f.a)).length, 0)
  await assert.rejects(f.p.coopStatus(f.c, { teamId: accepted.teamId }), /NOT_FOUND/)
  const runs = {}
  for (const [user, region] of [[f.a, 'macau'], [f.b, 'hunan']]) {
    const route = f.routes[region]
    const team = await f.p.myCoop(user)
    assert.equal(team.routeId, route.id)
    assert.equal(team.version, f.versions[region])
    const ownStory = { runId: team.myRunId }
    runs[region] = ownStory
    const story = await f.service.coopStory(user, ownStory)
    assert.equal(story.pending, true)
    assert.equal(story.full, false)
    assert.deepEqual(story.chapters.map(chapter => chapter.act), route.culture.chapters.map(chapter => chapter.act))
    assert.ok(story.chapters.every(chapter => !chapter.unlocked))
    await assert.rejects(f.service.coopStory(f.c, ownStory), /NOT_FOUND/)
    await assert.rejects(f.service.storyChapter(user, { ...ownStory, act: 7 }), /NOT_FOUND/)
    const progress = await f.service.progress(user, { runId: team.myRunId })
    const node = progress.snapshot.nodes[0]
    assert.equal(node.clue.answer, undefined)
    assert.equal(progress.snapshot.exhibitTitle, undefined)
    assert.ok(node.clue.question)
    assert.equal(await f.service.routeProgress(user, { routeId: route.id }), null)
    await assert.rejects(f.service.progress(f.c, { runId: team.myRunId }), /NOT_FOUND/)
    const visit = { runId: team.myRunId, nodeId: node.id, requestId: 'visit-' + region, latitude: node.latitude, longitude: node.longitude }
    const mediaId = 'photo-' + region
    await f.service.registerMedia(user, { ...visit, id: mediaId, fileID: 'private' })
    await assert.rejects(f.service.checkin(user, { ...visit, mediaId, clueAnswer: 'incorrect' }), /CLUE_INCORRECT/)
    await f.service.checkin(user, { ...visit, mediaId, clueAnswer: route.nodes[0].clue.answer })
    await assert.rejects(f.service.readMedia(region === 'macau' ? f.b : f.a, { id: mediaId }), /NOT_FOUND/)
    if (region === 'macau') {
      await f.service.saveTile(user, { runId: team.myRunId, pattern: 'sail', palette: 'cobalt' })
      await f.service.answerQuiz(user, { runId: team.myRunId, activityId: 'tileQuiz', option: route.culture.tileQuiz.answer })
      const localStory = await f.service.coopStory(user, ownStory)
      assert.ok(localStory.chapters.every(chapter => chapter.unlocked))
      await assert.rejects(f.service.storyChapter(user, { ...ownStory, act: 5 }), /NOT_FOUND/)
      await assert.rejects(f.p.settleCoop(user, { teamId: accepted.teamId }), /NOT_READY/)
    } else {
      await f.service.answerQuiz(user, { runId: team.myRunId, option: route.culture.quiz.answer })
      for (const card of route.culture.learning.cards) await f.service.readCard(user, { runId: team.myRunId, cardId: card.id })
    }
  }
  assert.equal((await f.p.settleCoop(f.a, { teamId: accepted.teamId })).alreadySettled, false)
  assert.equal((await f.p.settleCoop(f.b, { teamId: accepted.teamId })).alreadySettled, true)
  assert.equal(await f.p.bottleStatus(f.a), null)
  assert.deepEqual(await f.service.coopStoryHistory(f.c), [])
  const newHunan = { ...f.routes.hunan, revision: 1, name: '新湖南路线' }
  newHunan.culture = { ...newHunan.culture, chapters: newHunan.culture.chapters.map(chapter => ({ ...chapter, title: '新版 ' + chapter.title })) }
  await f.service.saveDraft(f.admin, newHunan)
  const savedDraft = await f.repo.get('fy-drafts', newHunan.id)
  await f.repo.put('fy-drafts', newHunan.id, { ...savedDraft, contentVerified: true })
  const newVersion = await f.service.publish(f.admin, { id: newHunan.id, revision: 2 })
  assert.notEqual(newVersion.version, f.versions.hunan)
  for (const [user, region] of [[f.a, 'macau'], [f.b, 'hunan']]) {
    const own = runs[region]
    const story = await f.service.coopStory(user, own)
    assert.equal(story.pending, false)
    assert.equal(story.full, true)
    assert.deepEqual(story.chapters.filter(chapter => chapter.unlocked).map(chapter => chapter.act), [2, 3, 4, 5, 6, 7])
    assert.equal(story.chapters.find(chapter => chapter.act === 5).title, f.routes.hunan.culture.chapters[0].title)
    assert.deepEqual(await f.service.coopStoryHistory(user), [{ id: accepted.teamId, ...own, completedAt: f.now() }])
  }
  const macauFinale = { ...runs.macau, act: 7 }
  const hunanFinale = { ...runs.hunan, act: 7 }
  assert.deepEqual((await f.service.storyChapter(f.a, macauFinale)).checkpoint.path, ['museum'])
  await assert.rejects(f.service.saveReading(f.a, { ...macauFinale, revision: 0, path: ['museum', 'together'] }), /INVALID_READING_PATH/)
  const checkpoint = await f.service.saveReading(f.a, { ...macauFinale, revision: 0, path: ['museum', 'macau'] })
  assert.deepEqual((await f.service.storyChapter(f.a, macauFinale)).checkpoint, checkpoint)
  assert.deepEqual((await f.service.storyChapter(f.b, hunanFinale)).checkpoint.path, ['museum'])
  await assert.rejects(f.service.storyChapter(f.b, macauFinale), /NOT_FOUND/)
})

test('same-region bottles keep both seats on the same route and decline releases both users', async () => {
  const f = await bottleReady()
  const a = { mode: 'same', region: 'hunan', requestId: 'same-a' }
  const b = { ...a, requestId: 'same-b' }
  await f.p.joinBottle(f.a, a)
  const match = await f.p.joinBottle(f.b, b)
  assert.equal(match.partner.region, 'hunan')
  assert.equal(await f.p.respondBottle(f.a, { matchId: match.matchId, accept: false }), null)
  assert.equal(await f.p.bottleStatus(f.b), null)
  assert.equal(await f.p.joinBottle(f.b, b), null)
  await f.p.joinBottle(f.a, { ...a, requestId: 'same-new-a' })
  const fresh = await f.p.joinBottle(f.b, { ...b, requestId: 'same-new-b' })
  await Promise.all([f.p.respondBottle(f.a, { matchId: fresh.matchId, accept: true }),
    f.p.respondBottle(f.b, { matchId: fresh.matchId, accept: true })])
  const local = await f.p.myCoop(f.a), remote = await f.p.myCoop(f.b)
  assert.equal(local.partnerSeat, 'hunan')
  assert.equal(local.routeId, remote.routeId)
  assert.notEqual(local.myRunId, remote.myRunId)
  const story = await f.service.coopStory(f.a, { runId: local.myRunId })
  assert.equal(story.pending, false)
  assert.equal(story.full, false)
  assert.deepEqual(story.chapters.map(chapter => chapter.act), f.routes.hunan.culture.chapters.map(chapter => chapter.act))
  await f.p.leaveCoop(f.a, { teamId: local.id })
  assert.equal(await f.p.bottleStatus(f.b), null)
})

test('settling a same-region team unlocks only its local chapters', async () => {
  const f = await bottleReady()
  const route = f.routes.hunan
  await f.p.joinBottle(f.a, { mode: 'same', region: 'hunan', requestId: 'local-a' })
  const match = await f.p.joinBottle(f.b, { mode: 'same', region: 'hunan', requestId: 'local-b' })
  await f.p.respondBottle(f.a, { matchId: match.matchId, accept: true })
  const paired = await f.p.respondBottle(f.b, { matchId: match.matchId, accept: true })
  for (const user of [f.a, f.b]) {
    const { myRunId: runId } = await f.p.myCoop(user)
    const node = route.nodes[0]
    const visit = { runId, nodeId: node.id, requestId: 'local-visit', latitude: node.latitude, longitude: node.longitude }
    const mediaId = 'local-' + user.uid
    await f.service.registerMedia(user, { ...visit, id: mediaId, fileID: 'private' })
    await f.service.checkin(user, { ...visit, mediaId, clueAnswer: node.clue.answer })
    await f.service.answerQuiz(user, { runId, option: route.culture.quiz.answer })
    for (const card of route.culture.learning.cards) await f.service.readCard(user, { runId, cardId: card.id })
  }
  await f.p.settleCoop(f.a, { teamId: paired.teamId })
  const [{ runId }] = await f.service.coopStoryHistory(f.a)
  const story = await f.service.coopStory(f.a, { runId })
  assert.equal(story.full, false)
  assert.deepEqual(story.chapters.map(chapter => [chapter.act, chapter.unlocked]), [[5, true], [6, true]])
  await assert.rejects(f.service.storyChapter(f.a, { runId, act: 7 }), /NOT_FOUND/)
})

test('withdrawn and expired bottles cannot be matched by delayed requests', async () => {
  const f = await bottleReady()
  const a = { mode: 'same', region: 'macau', requestId: 'close-a' }
  await f.p.joinBottle(f.a, a)
  await f.p.cancelBottle(f.a)
  assert.equal(await f.p.joinBottle(f.a, a), null)
  const waiting = await f.p.joinBottle(f.b, { ...a, requestId: 'close-b' })
  assert.equal(waiting.status, 'waiting')
  const paired = await f.p.joinBottle(f.a, { ...a, requestId: 'close-a-new' })
  f.advance(24 * 60 * 60 * 1000)
  await assert.rejects(f.p.respondBottle(f.a, { matchId: paired.matchId, accept: true }), /EXPIRED/)
  assert.equal(await f.p.bottleStatus(f.b), null)
  assert.deepEqual(await f.repo.list('fy-runs', {}), [])
})
