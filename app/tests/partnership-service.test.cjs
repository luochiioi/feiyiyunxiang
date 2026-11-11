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
