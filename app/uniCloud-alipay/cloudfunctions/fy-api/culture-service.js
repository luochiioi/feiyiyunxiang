const { activityIds, completedActivities, requireValue, tileWork, validPath } = require('./culture')

function createCultureService({ repo, owned, key, now }) {
  async function checkinsMet(db, runId, after) {
    for (const nodeId of after) {
      if (!await db.get('fy-checkins', key(runId, nodeId))) return false
    }
    return true
  }

  async function activityStatus(db, run, runId, activityId) {
    requireValue(activityIds.includes(activityId), 'NOT_FOUND')
    const definition = run.snapshot.culture?.[activityId]
    requireValue(definition, 'NOT_FOUND')
    const unlocked = (activityId !== 'learning' || !!run.culture?.quiz) && await checkinsMet(db, runId, definition.after)
    const status = { title: definition.title, unlocked, testOnly: run.snapshot.testOnly }
    if (activityId === 'tile') return { ...status, work: unlocked ? run.culture?.tile ?? null : null }
    if (activityId === 'quiz' && unlocked) {
      return { ...status, prompt: definition.prompt, options: definition.options, done: !!run.culture?.quiz,
        explanation: run.culture?.quiz ? definition.explanation : '' }
    }
    if (activityId === 'learning' && unlocked) return { ...status, cards: definition.cards, read: run.culture?.cards ?? [] }
    return status
  }

  async function setCulture(db, run, runId, value) {
    await db.put('fy-runs', runId, { ...run, culture: { ...run.culture, ...value }, revision: run.revision + 1 })
  }

  function checkpoint(run, chapter) {
    return run.story?.[chapter.act] ?? { path: [chapter.start], revision: 0 }
  }

  async function unlockedChapter(db, run, p) {
    const chapter = run.snapshot.culture?.chapters?.find(item => item.act === p.act)
    requireValue(chapter, 'NOT_FOUND')
    requireValue((chapter.activity == null || completedActivities(run).includes(chapter.activity)) &&
      await checkinsMet(db, p.runId, chapter.after), 'ACTIVITY_LOCKED')
    return chapter
  }

  return {
    async activityStatus(u, p) {
      return activityStatus(repo, await owned(repo, u, p.runId), p.runId, p.activityId)
    },
    async saveTile(u, p) {
      const work = tileWork(p, now())
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const status = await activityStatus(db, run, p.runId, 'tile')
        requireValue(status.unlocked, 'ACTIVITY_LOCKED')
        if (status.work) return status.work
        await setCulture(db, run, p.runId, { tile: work })
        return work
      })
    },
    async answerQuiz(u, p) {
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const status = await activityStatus(db, run, p.runId, 'quiz')
        requireValue(status.unlocked, 'ACTIVITY_LOCKED')
        const quiz = run.snapshot.culture.quiz
        requireValue(quiz.options.some(option => option.id === p.option), 'INVALID_QUIZ_OPTION')
        if (!status.done && p.option !== quiz.answer) return { done: false, explanation: '' }
        if (!status.done) await setCulture(db, run, p.runId, { quiz: true })
        return { done: true, explanation: quiz.explanation }
      })
    },
    async readCard(u, p) {
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const status = await activityStatus(db, run, p.runId, 'learning')
        requireValue(status.unlocked, 'ACTIVITY_LOCKED')
        requireValue(status.cards.some(card => card.id === p.cardId), 'INVALID_CARD')
        if (status.read.includes(p.cardId)) return status.read
        const read = [...status.read, p.cardId]
        await setCulture(db, run, p.runId, { cards: read })
        return read
      })
    },
    async works(u) {
      requireValue(u?.uid, 'AUTH_REQUIRED')
      const runs = await repo.list('fy-runs', { uid: u.uid })
      return runs.filter(run => run.culture?.tile).map(run => ({
        runId: run._id, routeName: run.snapshot.name, ...run.culture.tile
      })).sort((a, b) => b.savedAt - a.savedAt)
    },
    async storyLibrary(u) {
      requireValue(u?.uid, 'AUTH_REQUIRED')
      const runs = await repo.list('fy-runs', { uid: u.uid })
      const latest = new Map()
      for (const run of runs.sort((a, b) => b.createdAt - a.createdAt)) {
        if (!latest.has(run.routeId)) latest.set(run.routeId, run)
      }
      const items = await Promise.all(Array.from(latest.values(), async run => {
        const chapters = run.snapshot.culture?.chapters ?? []
        if (chapters.length === 0) return []
        const checks = await repo.list('fy-checkins', { runId: run._id, uid: u.uid })
        const ids = new Set(checks.map(check => check.nodeId))
        const completed = completedActivities(run)
        return chapters.map(chapter => ({
          act: chapter.act, title: chapter.title, runId: run._id, routeId: run.routeId,
          unlocked: chapter.after.every(id => ids.has(id)) && (chapter.activity == null || completed.includes(chapter.activity)),
          started: !!run.story?.[chapter.act]
        }))
      }))
      return items.flat()
    },
    async storyChapter(u, p) {
      const run = await owned(repo, u, p.runId)
      const chapter = await unlockedChapter(repo, run, p)
      return { chapter, checkpoint: checkpoint(run, chapter), testOnly: run.snapshot.testOnly }
    },
    async saveReading(u, p) {
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const chapter = await unlockedChapter(db, run, p)
        requireValue(validPath(chapter, p.path) && Number.isInteger(p.revision) && p.revision >= 0, 'INVALID_READING_PATH')
        const current = checkpoint(run, chapter)
        if (JSON.stringify(current.path) === JSON.stringify(p.path)) return current
        requireValue(current.revision === p.revision, 'CONFLICT')
        const value = { path: p.path, revision: current.revision + 1 }
        await db.put('fy-runs', p.runId, { ...run, story: { ...run.story, [chapter.act]: value }, revision: run.revision + 1 })
        return value
      })
    }
  }
}

module.exports = { createCultureService }
