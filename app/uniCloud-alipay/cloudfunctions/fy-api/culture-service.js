const { activityIds, quizIds, chapterGuide, completedActivities, requireValue, tileWork, validPath } = require('./culture')

function createCultureService({ repo, owned, key, now, attachCulture }) {
  async function checkinsMet(db, runId, after, mode = 'all') {
    for (const nodeId of after) {
      const checked = !!await db.get('fy-checkins', key(runId, nodeId))
      if (checked && mode === 'any') return true
      if (!checked && mode !== 'any') return false
    }
    return mode !== 'any'
  }

  async function activityStatus(db, run, runId, activityId) {
    requireValue(activityIds.includes(activityId), 'NOT_FOUND')
    const definition = run.snapshot.culture?.[activityId]
    requireValue(definition, 'NOT_FOUND')
    const quizMet = activityId !== 'learning' || run.culture?.quiz === true
    const unlocked = quizMet && await checkinsMet(db, runId, definition.after)
    const status = { title: definition.title, unlocked, testOnly: run.snapshot.testOnly }
    if (!unlocked) {
      return { ...status, lockText: quizMet ? '完成路线指定的定位照片打卡后解锁。' : '答对湘绣辨认题后解锁。' }
    }
    if (activityId === 'tile') return { ...status, work: run.culture?.tile ?? null }
    if (quizIds.includes(activityId)) {
      const done = run.culture?.[activityId] === true
      return { ...status, prompt: definition.prompt, options: definition.options, done,
        explanation: done ? definition.explanation : '' }
    }
    return { ...status, cards: definition.cards, read: run.culture?.cards ?? [] }
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
      await checkinsMet(db, p.runId, chapter.after, chapter.checkinMode), 'ACTIVITY_LOCKED')
    return chapter
  }

  return {
    async activityStatus(u, p) {
      const run = await attachCulture(await owned(repo, u, p.runId), p.runId)
      return activityStatus(repo, run, p.runId, p.activityId)
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
      const quizId = p.activityId ?? 'quiz'
      requireValue(quizIds.includes(quizId), 'INVALID_QUIZ')
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const status = await activityStatus(db, run, p.runId, quizId)
        requireValue(status.unlocked, 'ACTIVITY_LOCKED')
        const quiz = run.snapshot.culture[quizId]
        requireValue(quiz.options.some(option => option.id === p.option), 'INVALID_QUIZ_OPTION')
        if (!status.done && p.option !== quiz.answer) {
          return { done: false, explanation: '', hint: quiz.hint ?? '再观察一下两幅图的细节，选另一项试试。' }
        }
        if (!status.done) await setCulture(db, run, p.runId, { [quizId]: true })
        return { done: true, explanation: quiz.explanation }
      })
    },
    async readCard(u, p) {
      return repo.tx(async db => {
        const run = await owned(db, u, p.runId)
        const status = await activityStatus(db, run, p.runId, 'learning')
        requireValue(status.unlocked, 'ACTIVITY_LOCKED')
        requireValue(status.cards.some(card => card.id === p.cardId), 'INVALID_CARD')
        const alreadyRead = status.read.includes(p.cardId)
        const read = alreadyRead ? status.read : [...status.read, p.cardId]
        const completesSeat = run.purpose === 'coop' && read.length === status.cards.length && !run.culture?.learning
        if (completesSeat) await setCulture(db, run, p.runId, { cards: read, learning: true })
        else if (!alreadyRead) await setCulture(db, run, p.runId, { cards: read })
        return read
      })
    },
    async works(u) {
      requireValue(u?.uid, 'AUTH_REQUIRED')
      const runs = await repo.list('fy-runs', { uid: u.uid })
      const copied = new Set(runs.map(run => run.cultureTileSourceId).filter(Boolean))
      return runs.filter(run => run.culture?.tile && !copied.has(run._id)).map(run => ({
        runId: run._id, routeName: run.snapshot.name, ...run.culture.tile
      })).sort((a, b) => b.savedAt - a.savedAt)
    },
    async storyLibrary(u) {
      requireValue(u?.uid, 'AUTH_REQUIRED')
      const runs = await repo.list('fy-runs', { uid: u.uid })
      const latest = new Map()
      for (const run of runs.sort((a, b) => b.createdAt - a.createdAt)) {
        if ((run.purpose ?? 'solo') === 'solo' && !latest.has(run.routeId)) latest.set(run.routeId, run)
      }
      const items = await Promise.all(Array.from(latest.values(), async original => {
        const run = await attachCulture(original, original._id)
        const chapters = run.snapshot.culture?.chapters ?? []
        if (chapters.length === 0) return []
        const checks = await repo.list('fy-checkins', { runId: run._id, uid: u.uid })
        const ids = new Set(checks.map(check => check.nodeId))
        const completed = completedActivities(run)
        return chapters.map(chapter => {
          const any = chapter.checkinMode === 'any'
          const checked = any ? chapter.after.some(id => ids.has(id)) : chapter.after.every(id => ids.has(id))
          const done = chapter.activity == null || completed.includes(chapter.activity)
          const nextActivityId = !checked || done ? null :
            chapter.activity === 'learning' && !completed.includes('quiz') ? 'quiz' : chapter.activity
          return {
            ...chapterGuide(run.snapshot.culture, chapter), runId: run._id, routeId: run.routeId,
            unlocked: checked && done, started: !!run.story?.[chapter.act], nextActivityId
          }
        })
      }))
      return items.flat()
    },
    async storyChapter(u, p) {
      const run = await attachCulture(await owned(repo, u, p.runId), p.runId)
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
