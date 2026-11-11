const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

const source = fs.readFileSync(path.join(__dirname, '../features/partner/partner-view.uts'), 'utf8')
const stripped = stripTypeScriptTypes(source).replace(/^export /gm, '') + '\nmodule.exports = { partnerView, coopRouteEnabled }\n'
const tmp = path.join(os.tmpdir(), 'partner-view-stripped.cjs')
fs.writeFileSync(tmp, stripped)
const { partnerView, coopRouteEnabled } = require(tmp)

test('a coop route needs at least one check-in gate for each seat', () => {
  const macau = { id: 'tileQuiz', after: ['macau-point'] }
  const hunan = { id: 'learning', after: ['hunan-point'] }
  assert.equal(coopRouteEnabled([macau, hunan]), true)
  assert.equal(coopRouteEnabled([macau, { ...hunan, after: [] }]), false)
  assert.equal(coopRouteEnabled([{ id: 'tile' }, hunan]), false)
  assert.equal(coopRouteEnabled([{ id: 'quiz', after: ['hunan-point'] }, hunan]), false)
})

test('a pending failure task blocks the PK entry but not coop', () => {
  const view = partnerView({ assignment: { status: 'pending', rejectAvailableAt: 2000 }, now: 1000 })
  assert.equal(view.pkEnabled, false)
  assert.equal(view.coopEnabled, true)
  assert.equal(view.rejectEnabled, false)
})

test('the reject button appears only once 72 hours have passed', () => {
  const view = partnerView({ assignment: { status: 'pending', rejectAvailableAt: 2000 }, now: 2000 })
  assert.equal(view.rejectEnabled, true)
  assert.equal(view.pkEnabled, false)
})

test('a settled coop shows the seat label, never the partner name, to outsiders', () => {
  const view = partnerView({ result: { partnerLabel: '湖南旅伴', partnerNickname: '小陈' }, audience: 'public' })
  assert.equal(view.partnerText, '湖南旅伴')
  assert.equal(JSON.stringify(view).includes('小陈'), false)
})

test('the logged-in detail keeps the partner public card', () => {
  const view = partnerView({ result: { partnerLabel: '湖南旅伴', partnerNickname: '小陈' }, audience: 'member' })
  assert.equal(view.partnerText, '小陈')
})
