const { key } = require('./service')
const { activityDate } = require('./wechat-run')
const DAY = 86400000
const MILESTONES = [10000, 20000, 30000]
const DAILY_CAP = 60000
const member = user => { if (!user?.uid || user.admin) throw new Error('AUTH_REQUIRED') }
const dailyId = (uid, date) => key('steps', uid, date)

function summary(date, row) {
  const steps = row?.steps ?? null
  return {
    date, steps, syncedAt: row?.syncedAt ?? null,
    milestones: MILESTONES.map(threshold => ({
      threshold, reached: steps != null && steps >= threshold,
      reachedAt: row?.milestones?.find(item => item.threshold === threshold)?.reachedAt ?? null
    })),
    nextMilestone: MILESTONES.find(threshold => threshold > (steps ?? 0)) ?? null,
    dailyCap: DAILY_CAP
  }
}
function createStepService({ repo, verify, now = Date.now }) {
  return {
    async stepStatus(user) {
      member(user)
      const date = activityDate(now())
      return summary(date, await repo.get('fy-daily-steps', dailyId(user.uid, date)))
    },
    async stepSync(user, payload) {
      member(user)
      const proof = await verify(payload)
      if (proof.uid !== user.uid) throw new Error('WERUN_ACCOUNT_MISMATCH')
      if (!Number.isSafeInteger(proof.steps) || proof.steps < 0) throw new Error('INVALID_WERUN_PROOF')
      return repo.tx(async db => {
        const at = now(), date = activityDate(at)
        if (proof.date !== date) throw new Error('WERUN_DAY_CHANGED')
        const id = dailyId(user.uid, date)
        const previous = await db.get('fy-daily-steps', id)
        // WeRun reports a daily total. Keep its maximum, never add daily totals.
        const steps = Math.max(previous?.steps ?? 0, Math.min(proof.steps, DAILY_CAP))
        const milestones = MILESTONES.filter(threshold => steps >= threshold).map(threshold => ({
          threshold, reachedAt: previous?.milestones?.find(item => item.threshold === threshold)?.reachedAt ?? at
        }))
        const row = { uid: user.uid, date, steps, milestones, source: 'wechat-werun', syncedAt: at }
        await db.put('fy-daily-steps', id, row)
        return summary(date, row)
      })
    },
    async stepHistory(user) {
      member(user)
      const at = now()
      const date = activityDate(at)
      const first = activityDate(at - 29 * DAY)
      const rows = await repo.page('fy-daily-steps', { uid: user.uid }, {
        field: 'date', after: activityDate(at - 30 * DAY), size: 30
      })
      return {
        date,
        days: Array.from({ length: 30 }, (_, index) => {
          const day = activityDate(at - index * DAY)
          const row = rows.find(item => item.date === day && item.date >= first && item.date <= date)
          return summary(day, row)
        })
      }
    },
    async stepRanking(user) {
      member(user)
      const date = activityDate(now())
      const ids = new Set([user.uid])
      for (const [field, other] of [['from', 'to'], ['to', 'from']]) {
        let after = null
        while (true) {
          const friends = await repo.page('fy-friends', { [field]: user.uid, status: 'accepted' }, {
            field: '_id', after, size: 100
          })
          for (const friend of friends) ids.add(friend[other])
          if (friends.length < 100) break
          after = friends.at(-1)._id
        }
      }
      const profiles = await publicProfiles(repo, ids)
      const candidates = await Promise.all([...ids].map(async uid => {
        if (uid !== user.uid && (await repo.get('uni-id-users', uid))?.status !== 0) return null
        const row = await repo.get('fy-daily-steps', dailyId(uid, date))
        return {
          ...profiles.get(uid), mine: uid === user.uid,
          steps: row?.steps ?? null, syncedAt: row?.syncedAt ?? null
        }
      }))
      const rows = candidates.filter(row => row != null)
      rows.sort((a, b) => (b.steps ?? -1) - (a.steps ?? -1) ||
        Number(b.mine) - Number(a.mine) || a.code.localeCompare(b.code))
      let rank = null
      return { date, rows: rows.map((row, index) => {
        if (row.steps == null) return { ...row, rank: null }
        if (index === 0 || row.steps !== rows[index - 1].steps) rank = index + 1
        return { ...row, rank }
      }) }
    }
  }
}
module.exports = { createStepService }
const { publicProfiles } = require('./profile-presenter')
