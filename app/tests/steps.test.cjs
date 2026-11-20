const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCipheriv, randomBytes } = require('node:crypto')
const { createStepService } = require('../uniCloud-alipay/cloudfunctions/fy-api/step-service')
const { activityDate, decodeTodaySteps, verifyWechatRun } = require('../uniCloud-alipay/cloudfunctions/fy-api/wechat-run')
const { key } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')

function setup() {
  const rows = new Map()
  let clock = Date.parse('2026-11-21T12:00:00+08:00')
  const db = {
    async get(c, id) { return structuredClone(rows.get(c + id) ?? null) },
    async put(c, id, row) { rows.set(c + id, structuredClone({ ...row, _id: id })) },
    async list(c, q) {
      return [...rows].filter(([id, row]) => id.startsWith(c) && Object.entries(q).every(([k, v]) => row[k] === v))
        .map(([, row]) => structuredClone(row))
    },
    async page(c, q, { field, after, size }) {
      return (await this.list(c, q)).filter(row => after == null || row[field] > after)
        .sort((a, b) => field === '_id' ? a._id.localeCompare(b._id) : b[field].localeCompare(a[field])).slice(0, size)
    }
  }
  let tail = Promise.resolve()
  const repo = { ...db, tx(fn) {
    const next = tail.then(async () => {
      const before = structuredClone(rows)
      try { return await fn(db) }
      catch (error) { rows.clear(); for (const [id, row] of before) rows.set(id, row); throw error }
    })
    tail = next.catch(() => {})
    return next
  } }
  const user = { uid: 'alice' }
  const service = createStepService({ repo, now: () => clock, verify: async payload => payload })
  return { repo, service, user, now: () => clock, advance: ms => { clock += ms },
    proof: (steps, uid = user.uid) => ({ steps, uid, date: activityDate(clock) }) }
}
function encryptedProof(now, steps = 12345) {
  const sessionKey = randomBytes(16), iv = randomBytes(16), appId = 'wx-fixture'
  const payload = {
    watermark: { appid: appId, timestamp: Math.floor(now / 1000) },
    stepInfoList: [
      { timestamp: Math.floor(now / 1000) - 86400, step: 34567 },
      { timestamp: Math.floor(now / 1000), step: steps }
    ]
  }
  function encrypt(value) {
    const cipher = createCipheriv('aes-128-cbc', sessionKey, iv)
    return Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64')
  }
  return { payload, encrypt, proof: {
    encryptedData: encrypt(payload), sessionKey: sessionKey.toString('base64'),
    iv: iv.toString('base64'), appId, now
  } }
}

test('WeRun reuses UTC+8 daily selection and rejects modified, stale and cross-app proof', () => {
  const now = Date.parse('2026-11-21T00:01:00+08:00')
  const { payload, encrypt, proof } = encryptedProof(now)
  assert.deepEqual(decodeTodaySteps(proof), { date: '2026-11-21', steps: 12345 })
  for (const patch of [
    { appId: 'wx-other' }, { now: now + 601000 }, { encryptedData: 'invalid' },
    { iv: Buffer.alloc(15).toString('base64') },
    { encryptedData: encrypt({ ...payload, stepInfoList: [...payload.stepInfoList, payload.stepInfoList[1]] }) },
    { encryptedData: encrypt({ ...payload, stepInfoList: [{ timestamp: now / 1000, step: -1 }] }) },
    { encryptedData: encrypt({ ...payload, stepInfoList: payload.stepInfoList.slice(0, 1) }) }
  ]) assert.throws(() => decodeTodaySteps({ ...proof, ...patch }), /INVALID_WERUN_PROOF/)
  assert.equal(activityDate(Date.parse('2026-11-20T15:59:59Z')), '2026-11-20')
  assert.equal(activityDate(Date.parse('2026-11-20T16:00:00Z')), '2026-11-21')
})

test('WeRun exchanges code server-side and only returns verified steps and derived member identity', async () => {
  const now = Date.now()
  const { proof } = encryptedProof(now)
  const payload = { code: 'fresh-code', encryptedData: proof.encryptedData, iv: proof.iv, steps: 999999 }
  const http = { async request(url, options) {
    assert.equal(url, 'https://api.weixin.qq.com/sns/jscode2session')
    assert.equal(options.data.secret, 'server-only-secret')
    assert.equal(options.data.js_code, payload.code)
    return { status: 200, data: { openid: 'real-openid', session_key: proof.sessionKey } }
  } }
  const verified = await verifyWechatRun(payload, { http, now, appId: proof.appId, secret: 'server-only-secret' })
  assert.deepEqual(verified, { date: activityDate(now), steps: 12345, uid: key(proof.appId, 'real-openid') })
  assert.doesNotMatch(JSON.stringify(verified), /secret|openid|session_key|encryptedData/)
  await assert.rejects(verifyWechatRun(payload, { http, appId: proof.appId }), /CONFIG_REQUIRED/)
  await assert.rejects(verifyWechatRun({ code: 'fake' }, { http, now, appId: proof.appId, secret: 'x' }), /INVALID_WERUN_PROOF/)
  await assert.rejects(verifyWechatRun(payload, { http: { request: async () => ({ status: 200, data: { errcode: 40029 } }) },
    now, appId: proof.appId, secret: 'x' }), /WERUN_SESSION_FAILED/)
})

test('sync keeps the verified daily maximum and milestones exactly once under concurrent retries', async () => {
  const f = setup()
  const empty = await f.service.stepStatus(f.user)
  assert.equal(empty.steps, null)
  assert.equal(empty.nextMilestone, 10000)
  const first = await f.service.stepSync(f.user, f.proof(12500))
  const reachedAt = first.milestones[0].reachedAt
  f.advance(1000)
  await Promise.all([25000, 12000, 25000, 23000].map(steps => f.service.stepSync(f.user, f.proof(steps))))
  const today = await f.service.stepStatus(f.user)
  assert.equal(today.steps, 25000)
  assert.deepEqual(today.milestones.map(item => item.reached), [true, true, false])
  assert.equal(today.milestones[0].reachedAt, reachedAt)
  assert.equal(today.nextMilestone, 30000)
  assert.equal((await f.repo.list('fy-daily-steps', { uid: f.user.uid })).length, 1)
  const capped = await f.service.stepSync(f.user, f.proof(80000))
  assert.equal(capped.steps, 60000)
  assert.equal(capped.nextMilestone, null)
})

test('sync rejects another WeChat identity, invalid values and midnight-crossing proof without recording data', async () => {
  const f = setup()
  await assert.rejects(f.service.stepSync(f.user, f.proof(10000, 'bob')), /WERUN_ACCOUNT_MISMATCH/)
  await assert.rejects(f.service.stepSync(f.user, f.proof(-1)), /INVALID_WERUN_PROOF/)
  const yesterday = f.proof(10000)
  f.advance(86400000)
  await assert.rejects(f.service.stepSync(f.user, yesterday), /WERUN_DAY_CHANGED/)
  assert.equal((await f.service.stepStatus(f.user)).steps, null)
  assert.equal((await f.repo.list('fy-daily-steps', { uid: f.user.uid })).length, 0)
})

test('history is private, covers 30 days, and distinguishes unsynced days from a verified zero', async () => {
  const f = setup()
  await f.service.stepSync(f.user, f.proof(0))
  f.advance(86400000)
  await f.service.stepSync(f.user, f.proof(15000))
  const history = await f.service.stepHistory(f.user, { uid: 'bob' })
  assert.equal(history.days.length, 30)
  assert.equal(history.days[0].steps, 15000)
  assert.equal(history.days[1].steps, 0)
  assert.equal(history.days[2].steps, null)
  assert.equal((await f.service.stepHistory({ uid: 'bob' }, { uid: 'alice' })).days[0].steps, null)
  f.advance(30 * 86400000)
  assert.ok((await f.service.stepHistory(f.user)).days.every(day => day.steps == null))
})

test('daily ranks include accepted friends only, keep ties and hide account IDs and historical totals', async () => {
  const f = setup()
  for (const uid of ['alice', 'bob', 'stranger', 'blocked', 'waiting', 'zero', 'unsynced']) {
    await f.repo.put('uni-id-users', uid, { status: uid === 'blocked' ? 1 : 0 })
    await f.repo.put('fy-profiles', key('profile', uid), { uid, code: uid.toUpperCase(), nickname: uid + ' display' })
    if (uid !== 'unsynced') await f.service.stepSync({ uid }, f.proof(uid === 'zero' ? 0 : 15000, uid))
    if (uid !== 'alice' && uid !== 'stranger') await f.repo.put('fy-friends', uid, {
      from: uid, to: 'alice', status: uid === 'waiting' ? 'pending' : 'accepted'
    })
  }
  const ranking = await f.service.stepRanking(f.user, { uid: 'stranger', date: '2026-11-20' })
  assert.deepEqual(ranking.rows.map(row => row.nickname), ['alice display', 'bob display', 'zero display', 'unsynced display'])
  assert.deepEqual(ranking.rows.map(row => row.rank), [1, 1, 3, null])
  assert.doesNotMatch(JSON.stringify(ranking), /"uid"|"token"|openid|session_key/)
  f.advance(86400000)
  assert.ok((await f.service.stepRanking(f.user)).rows.every(row => row.steps == null && row.rank == null))
})

test('step ranking reads accepted friends beyond the first database page', async () => {
  const f = setup()
  for (let i = 0; i < 105; i++) {
    const uid = 'friend-' + i.toString().padStart(3, '0')
    await f.repo.put('uni-id-users', uid, { status: 0 })
    await f.repo.put('fy-profiles', uid, { uid, code: uid, nickname: uid })
    await f.repo.put('fy-friends', uid, { from: 'alice', to: uid, status: 'accepted' })
  }
  const rows = (await f.service.stepRanking(f.user)).rows
  assert.equal(rows.length, 106)
  assert.ok(rows.some(row => row.code === 'friend-104'))
})

test('every step entry point requires a member and rejects administrator sessions', async () => {
  const f = setup()
  for (const action of ['stepStatus', 'stepSync', 'stepHistory', 'stepRanking']) {
    for (const user of [null, {}, { uid: 'admin', admin: true }]) {
      await assert.rejects(f.service[action](user, {}), /AUTH_REQUIRED/)
    }
  }
})
