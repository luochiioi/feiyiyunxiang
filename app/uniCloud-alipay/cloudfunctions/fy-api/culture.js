const tilePatterns = ['rose', 'sail', 'geometry']
const tilePalettes = ['indigo', 'cobalt', 'mist']
const quizIds = ['tileQuiz', 'quiz']
const activityIds = ['tile', ...quizIds, 'learning']
const illustrations = ['threads', 'threads-direction', 'tile', 'tile-rose', 'tile-sail']
const cardIllustrations = ['direction', 'length', 'color', 'layers']

function requireValue(ok, code) {
  if (!ok) throw new Error(code)
}

const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const isId = value => typeof value === 'string' && /^[a-z0-9_-]{1,40}$/.test(value)
const distinct = values => new Set(values).size === values.length

function checkGate(after, nodeIds, code, min = 1) {
  requireValue(Array.isArray(after) && after.length >= min && after.length <= nodeIds.size &&
    distinct(after) && after.every(id => nodeIds.has(id)), code)
  return after
}

function activityHeader(activity, nodeIds, code) {
  requireValue(isText(activity?.title, 80), code)
  return { title: activity.title, after: checkGate(activity.after, nodeIds, code + '_GATE', 0) }
}

function validateCulture(value, nodeIds) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CULTURE')
  requireValue(Object.keys(value).length > 0 && Object.keys(value).every(id => activityIds.includes(id) || id === 'chapters'),
    'INVALID_CULTURE_FIELDS')
  const result = {}
  if ('tile' in value) result.tile = activityHeader(value.tile, nodeIds, 'INVALID_TILE')
  for (const quizId of quizIds) {
    if (!(quizId in value)) continue
    const quiz = value[quizId]
    const header = activityHeader(quiz, nodeIds, 'INVALID_QUIZ')
    requireValue(isText(quiz.prompt, 300) && isText(quiz.explanation, 500) &&
      (quiz.hint == null || isText(quiz.hint, 300)) &&
      Array.isArray(quiz.options) && quiz.options.length >= 2 && quiz.options.length <= 4, 'INVALID_QUIZ')
    const options = quiz.options.map(option => {
      requireValue(isId(option?.id) && isText(option.label, 80) && illustrations.includes(option.illustration), 'INVALID_QUIZ_OPTION')
      return { id: option.id, label: option.label, illustration: option.illustration }
    })
    requireValue(distinct(options.map(option => option.id)) && options.some(option => option.id === quiz.answer), 'INVALID_QUIZ_ANSWER')
    result[quizId] = { ...header, prompt: quiz.prompt, explanation: quiz.explanation, options, answer: quiz.answer }
    if (quiz.hint != null) result[quizId].hint = quiz.hint
  }
  if ('learning' in value) {
    const learning = value.learning
    const header = activityHeader(learning, nodeIds, 'INVALID_LEARNING')
    requireValue(result.quiz && Array.isArray(learning.cards) && learning.cards.length === 4, 'INVALID_LEARNING')
    const cards = learning.cards.map(card => {
      requireValue(isId(card?.id) && isText(card.title, 80) && isText(card.hotspot, 80) && isText(card.body, 500) &&
        (card.illustration == null || cardIllustrations.includes(card.illustration)), 'INVALID_CARD')
      const illustration = card.illustration == null ? {} : { illustration: card.illustration }
      return { id: card.id, title: card.title, hotspot: card.hotspot, body: card.body, ...illustration }
    })
    requireValue(distinct(cards.map(card => card.id)), 'INVALID_CARD')
    result.learning = { ...header, cards }
  }
  if ('chapters' in value) result.chapters = validateChapters(value.chapters, nodeIds, result)
  return result
}

const chapterActivities = { 2: null, 3: 'tile', 4: null, 5: 'quiz', 6: 'learning' }
const sceneAssets = ['aomiao']

function validateChapters(chapters, nodeIds, activities) {
  requireValue(Array.isArray(chapters) && chapters.length > 0 && chapters.length <= 5, 'INVALID_CHAPTERS')
  const acts = new Set()
  return chapters.map(chapter => {
    const act = chapter?.act
    requireValue(Number.isInteger(act) && Object.prototype.hasOwnProperty.call(chapterActivities, act) && !acts.has(act) &&
      isText(chapter.title, 80), 'INVALID_CHAPTER')
    acts.add(act)
    const activity = act === 4 && activities.tileQuiz ? 'tileQuiz' : chapterActivities[act]
    requireValue(activity == null || activities[activity], 'INVALID_CHAPTER_GATE')
    const after = checkGate(chapter.after, nodeIds, 'INVALID_CHAPTER_GATE', activity == null ? 1 : 0)
    requireValue(chapter.checkinMode == null || (act === 2 && chapter.checkinMode === 'any'), 'INVALID_CHAPTER_GATE')
    const result = { act, title: chapter.title, after, activity, ...validateScenes(chapter) }
    if (chapter.checkinMode === 'any') result.checkinMode = 'any'
    return result
  })
}

function sceneTargets(scene) {
  return scene.kind === 'choice' ? scene.choices.map(choice => choice.nextSceneId) :
    scene.kind === 'dialogue' ? [scene.nextSceneId] : []
}

function validateScenes(chapter) {
  requireValue(Array.isArray(chapter.scenes) && chapter.scenes.length >= 2 && chapter.scenes.length <= 24, 'INVALID_SCENES')
  const byId = new Map()
  for (const scene of chapter.scenes) {
    requireValue(isId(scene?.id) && !byId.has(scene.id) && isText(scene.text, 260) &&
      ['dialogue', 'choice', 'ending'].includes(scene.kind) &&
      (scene.asset == null || sceneAssets.includes(scene.asset)), 'INVALID_SCENE')
    const safe = { id: scene.id, kind: scene.kind, text: scene.text }
    if (scene.asset != null) safe.asset = scene.asset
    if (scene.kind === 'dialogue') {
      requireValue(isText(scene.speaker, 40) && isId(scene.nextSceneId), 'INVALID_DIALOGUE')
      Object.assign(safe, { speaker: scene.speaker, nextSceneId: scene.nextSceneId })
    }
    if (scene.kind === 'choice') {
      requireValue(Array.isArray(scene.choices) && scene.choices.length >= 2 && scene.choices.length <= 4, 'INVALID_CHOICES')
      safe.choices = scene.choices.map(choice => {
        requireValue(isText(choice?.label, 80) && isId(choice.nextSceneId), 'INVALID_CHOICE')
        return { label: choice.label, nextSceneId: choice.nextSceneId }
      })
      requireValue(distinct(sceneTargets(safe)), 'INVALID_CHOICE')
    }
    byId.set(scene.id, safe)
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(id) {
    requireValue(byId.has(id) && !visiting.has(id), 'INVALID_SCENE_GRAPH')
    if (visited.has(id)) return
    visiting.add(id)
    for (const target of sceneTargets(byId.get(id))) visit(target)
    visiting.delete(id)
    visited.add(id)
  }
  visit(chapter.start)
  requireValue(visited.size === byId.size && byId.get(chapter.start).kind !== 'ending', 'INVALID_SCENE_GRAPH')
  return { start: chapter.start, scenes: [...byId.values()] }
}

function validPath(chapter, path) {
  if (!Array.isArray(path) || path.length === 0 || path.length > chapter.scenes.length || path[0] !== chapter.start) return false
  return path.every((id, index) => {
    const scene = chapter.scenes.find(scene => scene.id === id)
    return scene && (index === path.length - 1 || sceneTargets(scene).includes(path[index + 1]))
  })
}

function cultureSummary(culture) {
  return activityIds.filter(id => culture?.[id]).map(id => ({ id, title: culture[id].title }))
}

function completedActivities(run) {
  const completed = []
  if (run.culture?.tile) completed.push('tile')
  for (const id of quizIds) {
    if (run.culture?.[id] === true) completed.push(id)
  }
  if (run.snapshot.culture?.learning && run.culture?.cards?.length === run.snapshot.culture.learning.cards.length) completed.push('learning')
  return completed
}

function tileWork(p, at) {
  requireValue(tilePatterns.includes(p.pattern) && tilePalettes.includes(p.palette), 'INVALID_TILE_SELECTION')
  return { pattern: p.pattern, palette: p.palette, savedAt: at }
}

module.exports = { activityIds, quizIds, requireValue, validateCulture, cultureSummary, completedActivities, validPath, tileWork }
