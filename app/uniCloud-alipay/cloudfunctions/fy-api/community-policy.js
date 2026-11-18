// Curated phrases, with sources and matching limitations in docs/validation/community-admin-iteration.md.
const starterRules = [
  ...['傻逼', '傻屄', '煞笔', '操你妈', '草你妈', '去你妈的', '你妈死了', '全家死光', '废物滚开',
    '买卖发票', '出售银行卡', '收购银行卡', '出售身份证', '买卖个人信息', '出售个人信息',
    '色情陪聊', '成人视频', '裸聊服务', '约炮服务', '六合彩特码', '赌博下注', '博彩送彩金', '百家乐开户', '赌场代理招募'
  ].map(word => ({ word, term: normalize(word), action: 'reject' })),
  ...['刷单返利', '稳赚不赔', '内幕消息', '高额返佣', '加群赚钱', '贷款套现',
    '人肉搜索', '曝光住址', '曝光手机号', '上门报复', '色情资源', '赌博平台'
  ].map(word => ({ word, term: normalize(word), action: 'pending' }))
]
const defaults = { minSeconds: 10, maxPerWindow: 20, duplicateSeconds: 300, rules: starterRules, revision: 0 }
const fail = code => { throw new Error(code) }
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\p{P}\p{Cf}\p{Cc}|+~^=<>]+/gu, '')
}

function requiredText(value, limit, error = 'INVALID_CONTENT') {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(error)
  return value.trim()
}

function validatePolicy(p) {
  function bounded(value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) fail('INVALID_POLICY')
    return value
  }
  if (!Array.isArray(p.rules) || p.rules.length > 200) fail('INVALID_POLICY')
  const seen = new Set()
  const rules = p.rules.map(rule => {
    const word = requiredText(rule?.word, 80, 'INVALID_POLICY')
    const term = normalize(word)
    if (!term || seen.has(term) || !['reject', 'pending', 'allow'].includes(rule.action)) fail('INVALID_POLICY')
    seen.add(term)
    return { word, term, action: rule.action }
  })
  return {
    minSeconds: bounded(p.minSeconds, 0, 600),
    maxPerWindow: bounded(p.maxPerWindow, 1, 100),
    duplicateSeconds: bounded(p.duplicateSeconds, 1, 300),
    rules
  }
}

function decide(policy, normalized) {
  const matches = policy.rules.filter(rule => normalized.includes(rule.term))
  if (matches.some(rule => rule.action === 'reject')) fail('COMMENT_REJECTED')
  if (matches.some(rule => rule.action === 'allow' && normalized === rule.term)) return 'public'
  return matches.some(rule => rule.action === 'pending') ? 'pending' : 'public'
}

function consume(state, policy, at, digest) {
  const recent = (state?.recent ?? []).filter(event => event.at > at - 600000)
  if (recent.some(event => event.digest === digest && event.at > at - policy.duplicateSeconds * 1000)) fail('DUPLICATE_COMMENT')
  if (recent.length >= policy.maxPerWindow || at - (state?.lastAt ?? -Infinity) < policy.minSeconds * 1000) fail('RATE_LIMITED')
  return { lastAt: at, recent: [...recent, { at, digest }] }
}

module.exports = { defaults, starterRules, fail, identifier, normalize, requiredText, validatePolicy, decide, consume }
