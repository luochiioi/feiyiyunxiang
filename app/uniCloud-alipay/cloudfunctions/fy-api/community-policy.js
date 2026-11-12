const defaults = { minSeconds: 10, maxPerWindow: 20, duplicateSeconds: 300, rules: [], revision: 0 }
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

module.exports = { defaults, fail, identifier, normalize, requiredText, validatePolicy, decide, consume }
