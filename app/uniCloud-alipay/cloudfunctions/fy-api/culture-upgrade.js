const { isDeepStrictEqual } = require('node:util')
const { completedActivities, validPath } = require('./culture')

function createCultureUpgrade({ repo, allowTestContent }) {
  return async function attachCulture(run, runId) {
    if ((run.purpose ?? 'solo') !== 'solo' || !allowTestContent || run.snapshot.testOnly !== true || run.cultureVersion) return run
    let version = run.version
    let edition = run.snapshot
    if (!edition.culture) {
      const route = await repo.get('fy-routes', run.routeId)
      if (!route?.enabled || !route.cultureUpgrade) return run
      version = route.version
      edition = await repo.get('fy-versions', version)
    }
    if (edition?.testOnly !== true || !Array.isArray(edition.cultureUpgrade)) return run
    const sourceRuns = edition.cultureUpgrade.length === 0 ? [] : await repo.list('fy-runs', { uid: run.uid })
    const sources = edition.cultureUpgrade.map(routeId => sourceRuns
      .filter(item => (item.purpose ?? 'solo') === 'solo' && item.uid === run.uid && item.routeId === routeId && item.snapshot.testOnly === true)
      .sort((a, b) => b.createdAt - a.createdAt)[0]).filter(Boolean)
    return repo.tx(async db => {
      const current = await db.get('fy-runs', runId)
      if (!current || current.uid !== run.uid) throw new Error('NOT_FOUND')
      if (current.cultureVersion) return current
      const culture = {
        ...edition.culture,
        chapters: edition.culture.chapters.map(chapter => chapter.act === 2
          ? { ...chapter, after: current.snapshot.nodes.map(node => node.id) } : chapter)
      }
      const updated = {
        ...current, snapshot: { ...current.snapshot, culture }, cultureVersion: version,
        culture: { ...current.culture }, story: { ...current.story }, revision: current.revision + 1
      }
      for (const candidate of sources) {
        const source = await db.get('fy-runs', candidate._id)
        if (!source || source.uid !== current.uid || source.snapshot.testOnly !== true) continue
        const matches = id => isDeepStrictEqual(source.snapshot.culture?.[id], culture[id])
        for (const id of ['tile', 'tileQuiz', 'quiz']) {
          if (matches(id) && source.culture?.[id] && !updated.culture[id]) {
            updated.culture[id] = source.culture[id]
            if (id === 'tile') updated.cultureTileSourceId = candidate._id
          }
        }
        if (matches('learning') && updated.culture.quiz && source.culture?.cards) {
          updated.culture.cards = [...new Set([...(updated.culture.cards ?? []), ...source.culture.cards])]
            .filter(id => culture.learning.cards.some(card => card.id === id))
        }
        for (const chapter of culture.chapters) {
          const saved = source.story?.[chapter.act]
          const original = source.snapshot.culture?.chapters?.find(item => item.act === chapter.act)
          if (chapter.activity && completedActivities(updated).includes(chapter.activity) && !updated.story[chapter.act] &&
            saved && isDeepStrictEqual(original, chapter) && validPath(chapter, saved.path)) updated.story[chapter.act] = saved
        }
      }
      await db.put('fy-runs', runId, updated)
      return updated
    })
  }
}

module.exports = { createCultureUpgrade }
