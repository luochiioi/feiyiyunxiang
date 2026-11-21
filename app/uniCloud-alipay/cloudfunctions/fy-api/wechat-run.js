const { createDecipheriv, createHash } = require('node:crypto')
const { exchangeWechatSession } = require('./wechat-session')

// Reused from app_dev's activity-economy WeRun adapter.
const DAY_OFFSET_MS = 8 * 60 * 60 * 1000
function activityDate(now = Date.now()) {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10)
}
function base64(value, limit) {
  if (typeof value !== 'string' || !value || value.length > limit) throw new Error('INVALID_WERUN_PROOF')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('INVALID_WERUN_PROOF')
  return bytes
}
function decodeTodaySteps({ encryptedData, iv, sessionKey, appId, now }) {
  try {
    const key = base64(sessionKey, 24)
    const vector = base64(iv, 24)
    const ciphertext = base64(encryptedData, 8192)
    if (key.length !== 16 || vector.length !== 16) throw new Error('INVALID_WERUN_PROOF')
    const decipher = createDecipheriv('aes-128-cbc', key, vector)
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
    const mark = payload.watermark
    if (!mark || mark.appid !== appId || !Number.isSafeInteger(mark.timestamp) ||
        mark.timestamp * 1000 < now - 600000 || mark.timestamp * 1000 > now + 60000) throw new Error('INVALID_WERUN_PROOF')
    const rows = payload.stepInfoList
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 31 || rows.some(row =>
      !row || !Number.isSafeInteger(row.timestamp) || row.timestamp < 0 || row.timestamp * 1000 > now + 60000 ||
      !Number.isSafeInteger(row.step) || row.step < 0)) throw new Error('INVALID_WERUN_PROOF')
    const date = activityDate(now)
    const matches = rows.filter(row => activityDate(row.timestamp * 1000) === date)
    if (matches.length !== 1) throw new Error('INVALID_WERUN_PROOF')
    return { date, steps: matches[0].step }
  } catch (_) { throw new Error('INVALID_WERUN_PROOF') }
}
async function verifyWechatRun(data, { http, appId, secret, now = Date.now() }) {
  const { code, encryptedData, iv } = data ?? {}
  if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(code) ||
      typeof encryptedData !== 'string' || encryptedData.length < 24 || encryptedData.length > 8192 ||
      typeof iv !== 'string' || iv.length !== 24) throw new Error('INVALID_WERUN_PROOF')
  const session = await exchangeWechatSession({ http, appId, secret, code, rejectedCode: 'WERUN_SESSION_FAILED' })
  const daily = decodeTodaySteps({ encryptedData, iv, sessionKey: session.session_key, appId, now })
  const uid = createHash('sha256').update(JSON.stringify([appId, session.openid])).digest('hex')
  return { ...daily, uid }
}
module.exports = { activityDate, decodeTodaySteps, verifyWechatRun }
