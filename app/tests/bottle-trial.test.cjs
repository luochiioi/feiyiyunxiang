const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

const source = readFileSync(join(__dirname, '../features/partner/bottle-trial.uts'), 'utf8')
const trial = import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))

test('cross-region bottle demo needs consent from both roles and shows each route', async () => {
  const { newBottleTrial, stepBottleTrial: step, bottleTrialRegion: region } = await trial
  let state = step(newBottleTrial(), 'throw')
  assert.equal(step(state, 'pick'), state)
  state = step(step(state, 'switch'), 'pick')
  state = step(state, 'accept')
  assert.equal(state.phase, 'offer')
  assert.equal(step(state, 'accept').phase, 'offer')
  assert.equal(region(state), 'hunan')
  state = step(step(state, 'switch'), 'accept')
  assert.equal(state.phase, 'paired')
  assert.equal(region(state), 'macau')
  assert.equal(step(state, 'leave').phase, 'closed')
})

test('nearby bottle demo keeps both roles in the same region and can be declined or withdrawn', async () => {
  const { newBottleTrial, stepBottleTrial: step, bottleTrialRegion: region } = await trial
  const floating = step({ ...newBottleTrial(), mode: 'nearby', region: 'hunan' }, 'throw')
  const guest = step(floating, 'switch')
  assert.equal(region(guest), 'hunan')
  const declined = step(step(guest, 'pick'), 'decline')
  assert.equal(declined.phase, 'closed')
  assert.equal(step(declined, 'restart').phase, 'idle')
  assert.equal(step(floating, 'withdraw').phase, 'closed')
})
