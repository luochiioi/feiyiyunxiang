async function exchangeWechatSession({ http, appId, secret, code, rejectedCode }) {
  if (!appId || !secret) throw new Error('WECHAT_LOGIN_CONFIG')

  let response
  try {
    response = await http.request('https://api.weixin.qq.com/sns/jscode2session', {
      method: 'GET', dataType: 'json', timeout: 10000,
      data: { appid: appId, secret, js_code: code, grant_type: 'authorization_code' }
    })
  } catch (_) {
    throw new Error('SERVICE_UNAVAILABLE')
  }

  const session = response.data
  const errorCode = Number(session?.errcode ?? 0)
  if ([40013, 40125].includes(errorCode)) throw new Error('WECHAT_LOGIN_CONFIG')
  if (errorCode === 45011) throw new Error('RATE_LIMITED')
  if (response.status !== 200 || errorCode === -1) throw new Error('SERVICE_UNAVAILABLE')
  if (errorCode || typeof session?.openid !== 'string' || !session.openid) throw new Error(rejectedCode)
  return session
}

module.exports = { exchangeWechatSession }
