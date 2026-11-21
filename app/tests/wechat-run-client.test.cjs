const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

function client({ permission, privacy = true, allow = true } = {}) {
  const calls = []
  const storage = new Map()
  let proofRead = 0, logins = 0
  const wx = {
    getPrivacySetting(options) { calls.push('privacy-status'); options.success({ needAuthorization: !privacy }) },
    requirePrivacyAuthorize(options) { calls.push('privacy'); (privacy ? options.success : options.fail)() },
    getSetting(options) { calls.push('setting'); options.success({ authSetting: { 'scope.werun': permission } }) },
    authorize(options) { calls.push('authorize'); (allow ? options.success : options.fail)() },
    openSetting(options) { calls.push('openSetting'); options.success({ authSetting: { 'scope.werun': allow } }) },
    login(options) { logins++; options.success({ code: 'fresh-code' }) },
    getWeRunData(options) { proofRead++; options.success({ encryptedData: 'ciphertext', iv: 'iv' }) }
  }
  const uni = {
    showModal(options) { calls.push('modal'); options.success({ confirm: allow }) },
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) }
  }
  let source = readFileSync(resolve(__dirname, '../features/steps.uts'), 'utf8')
  source = source.replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  source = stripTypeScriptTypes(source).replace(/\bexport /g, '')
  const functions = new Function('wx', 'uni', source + '\nreturn { read: readWechatRunProof, set: setStepAutoSync, enabled: stepAutoSyncEnabled, due: stepSyncDue, note: noteStepSyncAttempt }')(wx, uni)
  return { ...functions, calls, counts: () => ({ proofRead, logins }) }
}

test('WeRun client asks for privacy and motion permission before reading a fresh proof', async () => {
  const f = client()
  assert.deepEqual(await f.read(), { code: 'fresh-code', encryptedData: 'ciphertext', iv: 'iv' })
  assert.deepEqual(f.calls, ['privacy', 'setting', 'authorize'])
  await f.read()
  assert.deepEqual(f.counts(), { proofRead: 2, logins: 2 })
})

test('privacy and motion rejection never read step data or a login code', async () => {
  for (const options of [{ privacy: false }, { allow: false }, { permission: false, allow: false }]) {
    const f = client(options)
    await assert.rejects(f.read(), /WERUN_(PRIVACY|PERMISSION)_DENIED/)
    assert.deepEqual(f.counts(), { proofRead: 0, logins: 0 })
  }
})

test('a previously denied WeRun scope can be enabled in settings and retried', async () => {
  const f = client({ permission: false, allow: true })
  await f.read()
  assert.deepEqual(f.calls, ['privacy', 'setting', 'modal', 'openSetting'])
  assert.equal(f.counts().proofRead, 1)
})

test('automatic WeRun reads silently only while privacy and motion permissions are granted', async () => {
  const approved = client({ permission: true })
  await approved.read(true)
  assert.deepEqual(approved.calls, ['privacy-status', 'setting'])
  assert.deepEqual(approved.counts(), { proofRead: 1, logins: 1 })

  const missingPrivacy = client({ privacy: false, permission: true })
  await assert.rejects(missingPrivacy.read(true), /WERUN_PRIVACY_DENIED/)
  assert.deepEqual(missingPrivacy.calls, ['privacy-status'])
  assert.equal(missingPrivacy.counts().logins, 0)

  for (const permission of [false, undefined]) {
    const missingScope = client({ permission })
    await assert.rejects(missingScope.read(true), /WERUN_PERMISSION_DENIED/)
    assert.deepEqual(missingScope.calls, ['privacy-status', 'setting'])
    assert.deepEqual(missingScope.counts(), { proofRead: 0, logins: 0 })
  }
})

test('auto-sync preferences and cooldown are isolated by account', () => {
  const f = client()
  assert.equal(f.due('alice', 100000), false)
  f.set('alice', true)
  assert.equal(f.due('alice', 100000), true)
  assert.equal(f.due('bob', 100000), false)
  f.note('alice', 100000)
  assert.equal(f.due('alice', 159999), false)
  assert.equal(f.due('alice', 160000), true)
  f.set('alice', false)
  assert.equal(f.due('alice', 220000), false)
})

test('foreground views share a sync and account switches discard an in-flight proof', async () => {
  const { set, enabled, due, note } = client({ permission: true })
  set('alice', true)
  let release, proofReads = 0, sent = 0
  const session = { value: { uid: 'alice', expiresAt: 0 } }
  let renewals = 0
  const source = readFileSync(resolve(__dirname, '../features/step-sync.uts'), 'utf8').replace(/^import .*$/gm, '')
  const sync = new Function('session', 'api', 'login', 'readWechatRunProof', 'stepAutoSyncEnabled', 'stepSyncDue', 'noteStepSyncAttempt',
    stripTypeScriptTypes(source).replace(/\bexport /g, '') + '\nreturn syncWechatSteps')(
    session, async () => { sent++; return { steps: 1000 } }, async () => {
      renewals++; session.value.expiresAt = Date.now() + 60000
    }, () => {
      proofReads++
      return new Promise(resolve => { release = resolve })
    }, enabled, due, note
  )

  const home = sync('alice', true, () => true)
  const community = sync('alice', true, () => true)
  await Promise.resolve()
  assert.equal(renewals, 1)
  assert.equal(proofReads, 1)
  release({})
  assert.deepEqual(await Promise.all([home, community]), [{ steps: 1000 }, { steps: 1000 }])
  assert.equal(sent, 1)
  assert.equal(await sync('alice', true, () => true), null)

  const manual = sync('alice', false, () => true)
  session.value = { uid: 'bob' }
  release({})
  assert.equal(await manual, null)
  assert.equal(sent, 1)
})
