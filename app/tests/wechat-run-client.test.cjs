const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

function client({ permission, privacy = true, allow = true } = {}) {
  const calls = []
  let proofRead = 0, logins = 0
  const wx = {
    requirePrivacyAuthorize(options) { calls.push('privacy'); (privacy ? options.success : options.fail)() },
    getSetting(options) { calls.push('setting'); options.success({ authSetting: { 'scope.werun': permission } }) },
    authorize(options) { calls.push('authorize'); (allow ? options.success : options.fail)() },
    openSetting(options) { calls.push('openSetting'); options.success({ authSetting: { 'scope.werun': allow } }) },
    login(options) { logins++; options.success({ code: 'fresh-code' }) },
    getWeRunData(options) { proofRead++; options.success({ encryptedData: 'ciphertext', iv: 'iv' }) }
  }
  const uni = { showModal(options) { calls.push('modal'); options.success({ confirm: allow }) } }
  let source = readFileSync(resolve(__dirname, '../features/steps.uts'), 'utf8')
  source = source.replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  source = stripTypeScriptTypes(source).replace(/\bexport /g, '')
  const read = new Function('wx', 'uni', source + '\nreturn readWechatRunProof')(wx, uni)
  return { read, calls, counts: () => ({ proofRead, logins }) }
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
