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
      options: [{ id: 'a', label: '甲', illustration: 'threads' }, { id: 'b', label: '乙', illustration: 'tile' }], answer: 'a' }
  }
}

async function coopReady() {
  const f = await ready()
  f.service = createService({ repo: f.repo, now: () => f.now(), allowTestContent: true })
  const admin = { uid: 'admin', admin: true }
  await f.service.saveDraft(admin, coopDraft)
  await f.service.publish(admin, { id: 'combined', revision: 1 })
  f.routeId = 'combined'
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-coop' })
  await f.p.respondFriend(f.b, { requestId: 'fr-coop', accept: true })
  f.team = await f.p.inviteCoop(f.a, { code: f.codes.b, routeId: f.routeId, requestId: 'co-1' })
  await f.p.respondCoop(f.b, { teamId: f.team.id, accept: true })
  return f
}

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
