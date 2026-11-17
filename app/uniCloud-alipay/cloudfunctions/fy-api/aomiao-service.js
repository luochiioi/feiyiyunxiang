const { completedActivities } = require('./culture')

const appearances = [
  { id: 'default', name: '默认澳喵' },
  { id: 'macau', name: '蓝白瓷砖', routeId: 'yinian-guiqi-macau', activity: 'tile', requirement: '完成澳门路线的蓝白瓷砖配色' },
  { id: 'hunan', name: '湘绣纹样', routeId: 'yinian-guiqi-hunan', activity: 'learning', requirement: '读完湖南路线的湘绣观察卡' }
]

function createAomiaoService({ repo, key, now }) {
  const collection = 'fy-aomiao'
  function ownerKey(user) {
    if (!user?.uid) throw new Error('AUTH_REQUIRED')
    return key('aomiao', user.uid)
  }
  async function completedOnRoute(uid, routeId, activity) {
    const query = { uid, routeId }
    const qualifies = run => (run.purpose ?? 'solo') === 'solo' &&
      run.snapshot.testOnly !== true && completedActivities(run).includes(activity)
    const runs = await repo.list('fy-runs', query)
    if (runs.some(qualifies)) return true
    if (runs.length < 100 || !repo.page) return false

    let after
    while (true) {
      const page = await repo.page('fy-runs', query, { field: '_id', after, size: 100 })
      if (page.some(qualifies)) return true
      if (page.length < 100) return false
      after = page.at(-1)._id
    }
  }
  async function eligibility(user) {
    return Promise.all(appearances.map(async ({ id, name, routeId, activity, requirement }) => {
      const earned = routeId == null || await completedOnRoute(user.uid, routeId, activity)
      return { id, name, earned, demo: routeId != null, requirement: requirement ?? '' }
    }))
  }
  function view(record, options) {
    const claimed = record != null
    const selected = claimed ? options.find(option => option.id === record.selected && option.earned)?.id ?? 'default' : null
    return {
      claimed, selected,
      appearances: options.map(({ earned, ...option }) => ({
        ...option, earned, unlocked: claimed && earned
      }))
    }
  }
  return {
    async aomiaoStatus(user) {
      const id = ownerKey(user)
      const [record, options] = await Promise.all([repo.get(collection, id), eligibility(user)])
      return view(record, options)
    },
    async claimAomiao(user) {
      const id = ownerKey(user)
      const options = await eligibility(user)
      const record = await repo.tx(async db => {
        const existing = await db.get(collection, id)
        if (existing) return existing
        const value = { uid: user.uid, selected: 'default', claimedAt: now() }
        await db.put(collection, id, value)
        return value
      })
      return view(record, options)
    },
    async selectAomiao(user, { appearanceId }) {
      const id = ownerKey(user)
      if (!appearances.some(option => option.id === appearanceId)) throw new Error('INVALID_APPEARANCE')
      const options = await eligibility(user)
      const record = await repo.tx(async db => {
        const existing = await db.get(collection, id)
        if (!existing || !options.some(option => option.id === appearanceId && option.earned)) throw new Error('APPEARANCE_LOCKED')
        if (existing.selected === appearanceId) return existing
        const updated = { ...existing, selected: appearanceId }
        await db.put(collection, id, updated)
        return updated
      })
      return view(record, options)
    }
  }
}

module.exports = { createAomiaoService }
