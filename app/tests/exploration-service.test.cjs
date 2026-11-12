const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { createService } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')

function setup() {
  const rows = new Map()
  const db = { async get(c,id) { return structuredClone(rows.get(c+id) ?? null) }, async put(c,id,v) { rows.set(c+id,structuredClone({...v,_id:id})) }, async list(c,q) {return [...rows].filter(([k,v])=>k.startsWith(c)&&Object.entries(q).every(([a,b])=>v[a]===b)).map(([,v])=>structuredClone(v))} }
  // Serial test adapter; production transaction adapter is separately reviewed.
  let tail = Promise.resolve()
  const repo = {...db, tx(fn) { const p = tail.then(async()=>{ const saved = structuredClone(rows); try { return await fn(db) } catch(e) { rows.clear(); for(const [k,v] of saved) rows.set(k,v); throw e } }); tail=p.catch(()=>{}); return p }}
  const s = createService({repo, now:()=>1000000})
  const admin = {uid:'admin',admin:true}, a={uid:'a'}, b={uid:'b'}
  return { s, repo, admin,a,b }
}
const draft = {id:'macau', revision:0, name:'测试路线', region:'澳门', description:'开发测试', testOnly:true, viewport:{latitude:22,longitude:113,scale:16}, museum:{name:'测试馆',description:'测试'}, nodes:[{id:'n1',title:'测试节点',description:'定位照片',latitude:22,longitude:113,radius:100}]}
async function ready() {const f=setup(); await f.s.saveDraft(f.admin,draft); await f.s.publish(f.admin,{id:'macau',revision:1}); f.run=await f.s.start(f.a,{routeId:'macau',requestId:'start-0001'}); return f}
test('public cannot manage drafts; malformed published coordinates rejected',async()=>{const {s,a,admin}=setup(); await assert.rejects(s.saveDraft(a,draft),/FORBIDDEN/); await assert.rejects(s.saveDraft(admin,{...draft,nodes:[{...draft.nodes[0],latitude:NaN}]}),/INVALID/);})
test('draft optimistic revision and immutable run snapshot',async()=>{const f=await ready(); await assert.rejects(f.s.saveDraft(f.admin,draft),/CONFLICT/); await f.s.saveDraft(f.admin,{...draft,revision:1,name:'第二版'}); await f.s.publish(f.admin,{id:'macau',revision:2}); const run=await f.repo.get('fy-runs',f.run.id); assert.equal(run.snapshot.name,'测试路线');})
test('same start request returns same exploration, other user cannot read run',async()=>{const f=await ready(); assert.equal((await f.s.start(f.a,{routeId:'macau',requestId:'start-0001'})).id,f.run.id); await assert.rejects(f.s.progress(f.b,{runId:f.run.id}),/NOT_FOUND/);})
test('media belongs to user, run, node and submission; invalid location denied',async()=>{const f=await ready(); const p={runId:f.run.id,nodeId:'n1',requestId:'check-0001'}; await f.s.registerMedia(f.a,{...p,id:'media-a',fileID:'server-only'}); await assert.rejects(f.s.checkin(f.b,{...p,mediaId:'media-a',latitude:22,longitude:113}),/NOT_FOUND/); for(const latitude of [NaN,91,'22',0]) await assert.rejects(f.s.checkin(f.a,{...p,mediaId:'media-a',latitude,longitude:113}),/INVALID|OUTSIDE/); await assert.rejects(f.s.checkin(f.a,{...p,requestId:'check-0002',mediaId:'media-a',latitude:22,longitude:113}),/MEDIA/);})
test('concurrent and response-lost retries yield one checkin and diary',async()=>{const f=await ready(); const p={runId:f.run.id,nodeId:'n1',requestId:'check-0001'}; await f.s.registerMedia(f.a,{...p,id:'media-a',fileID:'server-only'}); const args={...p,mediaId:'media-a',latitude:22,longitude:113,note:'第一站'}; const results=await Promise.all(Array.from({length:8},()=>f.s.checkin(f.a,args))); assert.equal(new Set(results.map(r=>r.id)).size,1); assert.equal((await f.s.progress(f.a,{runId:f.run.id})).done,1); assert.equal((await f.s.diary(f.a)).length,1); await assert.rejects(f.s.readMedia(f.b,{id:'media-a'}),/NOT_FOUND/); assert.equal((await f.s.readMedia(f.a,{id:'media-a'})).fileID,'server-only');})

test('public catalog strips internal author fields',async()=>{const f=await ready();const [route]=await f.s.catalog();assert.equal(route.publishedBy,undefined);assert.equal(route.updatedBy,undefined);assert.equal(route._id,undefined);})
test('one request cannot complete two nodes',async()=>{const f=setup();await f.s.saveDraft(f.admin,{...draft,nodes:[...draft.nodes,{...draft.nodes[0],id:'n2'}]});await f.s.publish(f.admin,{id:'macau',revision:1});const run=await f.s.start(f.a,{routeId:'macau',requestId:'start-0001'});const p={runId:run.id,nodeId:'n1',requestId:'check-0001'};await f.s.registerMedia(f.a,{...p,id:'media-a',fileID:'private'});await f.s.checkin(f.a,{...p,mediaId:'media-a',latitude:22,longitude:113});await assert.rejects(f.s.checkin(f.a,{...p,nodeId:'n2',mediaId:'media-a',latitude:22,longitude:113}),/REQUEST_CONFLICT/);})
test('failed transaction leaves no partial checkin and can retry',async()=>{const f=await ready();const p={runId:f.run.id,nodeId:'n1',requestId:'check-0001'};await f.s.registerMedia(f.a,{...p,id:'media-a',fileID:'private'});const original=f.repo.tx;let once=true;f.repo.tx=fn=>original(async db=>fn({...db,async put(c,id,v){if(c==='fy-diary'&&once){once=false;throw new Error('WRITE_FAILED')}return db.put(c,id,v)}}));const args={...p,mediaId:'media-a',latitude:22,longitude:113};await assert.rejects(f.s.checkin(f.a,args),/WRITE_FAILED/);assert.equal((await f.s.progress(f.a,{runId:f.run.id})).done,0);assert.equal((await f.s.diary(f.a)).length,0);await f.s.checkin(f.a,args);assert.equal((await f.s.diary(f.a)).length,1);})

test('point entry restores its private record and existing route progress by owner', async () => {
  const f = await ready()
  const point = { routeId: 'macau', nodeId: 'n1' }
  const submission = { runId: f.run.id, nodeId: point.nodeId, requestId: 'point-entry-1' }
  await f.s.registerMedia(f.a, { ...submission, id: 'media-a', fileID: 'private-file' })
  await f.s.checkin(f.a, { ...submission, mediaId: 'media-a', latitude: 22, longitude: 113, note: '第一站' })
  assert.deepEqual(await f.s.nodeRecord(f.a, point), { title: '测试节点', createdAt: 1000000, note: '第一站', mediaId: 'media-a' })
  assert.equal(await f.s.nodeRecord(f.a, { ...point, routeId: 'another-route' }), null)
  assert.equal(await f.s.nodeRecord(f.b, { ...point, uid: f.a.uid }), null)
  const progress = await f.s.routeProgress(f.a, { routeId: point.routeId })
  assert.equal(progress.runId, f.run.id)
  assert.deepEqual(progress.completed, [point.nodeId])
  assert.equal(await f.s.routeProgress(f.b, { routeId: point.routeId }), null)
})

test('Macau route gates its private tile work on a real check-in and pins the activity version', async () => {
  const { s, admin, a, b } = setup()
  const culture = { tile: { title: '蓝白瓷砖配色', after: ['n1'] } }
  await assert.rejects(s.saveDraft(admin, { ...draft, culture: { tile: { ...culture.tile, after: ['missing'] } } }), /INVALID_TILE_GATE/)
  await s.saveDraft(admin, { ...draft, culture })
  await s.publish(admin, { id: draft.id, revision: 1 })
  const { id: runId } = await s.start(a, { routeId: draft.id, requestId: 'macau-test' })
  assert.deepEqual((await s.catalog())[0].activities, [{ id: 'tile', title: culture.tile.title, after: ['n1'] }])
  assert.equal((await s.progress(a, { runId })).total, 2)
  const selection = { runId, pattern: 'sail', palette: 'cobalt' }
  await assert.rejects(s.saveTile(a, selection), /ACTIVITY_LOCKED/)
  await assert.rejects(s.activityStatus(b, { runId, activityId: 'tile' }), /NOT_FOUND/)
  const p = { runId, nodeId: 'n1', requestId: 'tile-gate' }
  await s.registerMedia(a, { ...p, id: 'media', fileID: 'private-photo' })
  await s.checkin(a, { ...p, mediaId: 'media', latitude: 22, longitude: 113 })
  await s.saveDraft(admin, { ...draft, revision: 1 })
  await s.publish(admin, { id: draft.id, revision: 2 })
  assert.deepEqual((await s.catalog())[0].activities, [])
  assert.equal((await s.activityStatus(a, { runId, activityId: 'tile' })).unlocked, true)
  await assert.rejects(s.saveTile(a, { ...selection, pattern: 'bogus' }), /INVALID_TILE_SELECTION/)
  const work = await s.saveTile(a, selection)
  assert.deepEqual(await s.saveTile(a, { ...selection, palette: 'mist' }), work)
  assert.equal((await s.progress(a, { runId })).done, 2)
  assert.deepEqual(await s.works(a), [{ runId, routeName: draft.name, ...work }])
  assert.deepEqual(await s.works(b), [])
  assert.equal((await s.diary(a)).length, 1)
})

const hunan = { ...draft, id: 'hunan', region: '湖南' }
const quiz = { title: '湘绣辨认', after: ['n1'], prompt: '哪幅是丝线示意？', explanation: '答案说明',
  options: [{ id: 'a', label: '图 A', illustration: 'tile' }, { id: 'b', label: '图 B', illustration: 'threads' }], answer: 'b' }
const cards = ['line', 'color', 'layer', 'direction'].map(id => ({ id, title: id, hotspot: '观察', body: '待校订' }))
const scenes = [
  { id: 'start', kind: 'choice', text: '选一项', choices: [{ label: '左', nextSceneId: 'left' }, { label: '右', nextSceneId: 'right' }] },
  { id: 'left', kind: 'dialogue', speaker: '旁白', text: '左边', nextSceneId: 'right' },
  { id: 'right', kind: 'ending', text: '完' }
]
const chapter = { act: 5, title: '湘绣相遇', after: [], start: 'start', scenes }
const hunanCulture = { quiz, learning: { title: '针法学习', after: [], cards }, chapters: [chapter, { ...chapter, act: 6, title: '针法学习' }] }
async function checkPoint(s, user, runId, nodeId = 'n1') {
  const payload = { runId, nodeId, requestId: 'complete-test-' + nodeId }
  const mediaId = 'photo-' + nodeId
  await s.registerMedia(user, { ...payload, id: mediaId, fileID: 'private-photo' })
  await s.checkin(user, { ...payload, mediaId, latitude: 22, longitude: 113 })
}

test('new Macau release separates the first visit, tile design and motif quiz while an old run retains its gates', async () => {
  const { s, admin, a, b } = setup()
  const route = { ...draft, nodes: [...draft.nodes, { ...draft.nodes[0], id: 'n2' }] }
  const tile = { title: '蓝白瓷砖配色', after: ['n1'] }
  const storm = { ...chapter, act: 2, after: ['n1'] }
  const shore = { ...chapter, act: 4, after: ['n1', 'n2'] }
  await s.saveDraft(admin, { ...route, culture: { tile, chapters: [storm, shore] } })
  await s.publish(admin, { id: route.id, revision: 1 })
  const old = await s.start(a, { routeId: route.id, requestId: 'macau-old-gates' })

  const tileQuiz = { ...quiz, title: '瓷砖纹样辨认', after: [], hint: '看看帆和浪',
    options: [{ id: 'a', label: '图 A', illustration: 'tile-rose' }, { id: 'b', label: '图 B', illustration: 'tile-sail' }] }
  const culture = { tile: { ...tile, after: [] }, tileQuiz, chapters: [
    { ...storm, after: ['n1', 'n2'], checkinMode: 'any' },
    { ...chapter, act: 3 },
    { ...shore, after: [] }
  ] }
  await s.saveDraft(admin, { ...route, revision: 1, culture })
  await s.publish(admin, { id: route.id, revision: 2 })
  const { id: runId } = await s.start(b, { routeId: route.id, requestId: 'macau-cultural-gates' })

  assert.equal((await s.activityStatus(a, { runId: old.id, activityId: 'tile' })).unlocked, false)
  assert.deepEqual((await s.storyLibrary(a)).map(entry => [entry.act, entry.unlocked]), [[2, false], [4, false]])
  await assert.rejects(s.storyChapter(b, { runId, act: 2 }), /ACTIVITY_LOCKED/)
  assert.match((await s.storyLibrary(b))[0].gateText, /任一/)
  await s.saveTile(b, { runId, pattern: 'sail', palette: 'cobalt' })
  assert.equal((await s.storyChapter(b, { runId, act: 3 })).chapter.act, 3)
  const question = await s.activityStatus(b, { runId, activityId: 'tileQuiz' })
  assert.equal(question.unlocked, true)
  assert.equal(question.answer, undefined)
  assert.match((await s.answerQuiz(b, { runId, activityId: 'tileQuiz', option: 'a' })).hint, /帆和浪/)
  await assert.rejects(s.storyChapter(b, { runId, act: 4 }), /ACTIVITY_LOCKED/)
  await assert.rejects(s.answerQuiz(a, { runId, activityId: 'tileQuiz', option: 'b' }), /NOT_FOUND/)
  await s.answerQuiz(b, { runId, activityId: 'tileQuiz', option: 'b' })
  assert.equal((await s.storyChapter(b, { runId, act: 4 })).chapter.act, 4)
  const progress = await s.progress(b, { runId })
  assert.deepEqual(progress.completed, [])
  assert.deepEqual(progress.activities, ['tile', 'tileQuiz'])
  assert.deepEqual(await s.diary(b), [])
  await checkPoint(s, b, runId, 'n2')
  assert.equal((await s.storyChapter(b, { runId, act: 2 })).chapter.act, 2)
  assert.deepEqual((await s.storyLibrary(b)).map(entry => [entry.act, entry.unlocked]), [[2, true], [3, true], [4, true]])
})

test('new Hunan release opens the quiz and unlocks acts five and six without a location check-in', async () => {
  const { s, admin, a } = setup()
  await s.saveDraft(admin, { ...hunan, culture: { ...hunanCulture, quiz: { ...quiz, after: [] } } })
  await s.publish(admin, { id: hunan.id, revision: 1 })
  const { id: runId } = await s.start(a, { routeId: hunan.id, requestId: 'hunan-no-visit' })
  assert.equal((await s.activityStatus(a, { runId, activityId: 'quiz' })).unlocked, true)
  await assert.rejects(s.readCard(a, { runId, cardId: cards[0].id }), /ACTIVITY_LOCKED/)
  await s.answerQuiz(a, { runId, option: 'b' })
  assert.equal((await s.storyChapter(a, { runId, act: 5 })).chapter.act, 5)
  for (const card of cards.slice(0, 3)) await s.readCard(a, { runId, cardId: card.id })
  await assert.rejects(s.storyChapter(a, { runId, act: 6 }), /ACTIVITY_LOCKED/)
  await s.readCard(a, { runId, cardId: cards[3].id })
  assert.equal((await s.storyChapter(a, { runId, act: 6 })).chapter.act, 6)
  assert.deepEqual((await s.progress(a, { runId })).completed, [])
})

test('Hunan can complete quiz and all cards independently, and only its owner can read the story', async () => {
  const { s, admin, a, b } = setup()
  await s.saveDraft(admin, { ...hunan, culture: hunanCulture })
  await s.publish(admin, { id: hunan.id, revision: 1 })
  const { id: runId } = await s.start(a, { routeId: hunan.id, requestId: 'hunan-test' })
  await assert.rejects(s.storyChapter(a, { runId, act: 5 }), /ACTIVITY_LOCKED/)
  await assert.rejects(s.answerQuiz(a, { runId, option: 'b' }), /ACTIVITY_LOCKED/)
  await checkPoint(s, a, runId)
  const question = await s.activityStatus(a, { runId, activityId: 'quiz' })
  assert.equal(question.answer, undefined)
  assert.equal(question.explanation, '')
  assert.equal((await s.answerQuiz(a, { runId, option: 'a' })).done, false)
  assert.equal((await s.progress(a, { runId })).done, 1)
  await assert.rejects(s.readCard(a, { runId, cardId: 'line' }), /ACTIVITY_LOCKED/)
  assert.equal((await s.answerQuiz(a, { runId, option: 'b' })).done, true)
  assert.equal((await s.storyChapter(a, { runId, act: 5 })).chapter.title, chapter.title)
  await assert.rejects(s.storyChapter(b, { runId, act: 5 }), /NOT_FOUND/)
  await assert.rejects(s.storyChapter(a, { runId, act: 6 }), /ACTIVITY_LOCKED/)
  await assert.rejects(s.readCard(a, { runId, cardId: 'missing' }), /INVALID_CARD/)
  await Promise.all(cards.map(card => s.readCard(a, { runId, cardId: card.id })))
  assert.equal((await s.readCard(a, { runId, cardId: 'line' })).length, 4)
  const status = await s.activityStatus(a, { runId, activityId: 'learning' })
  assert.deepEqual(new Set(status.read), new Set(cards.map(card => card.id)))
  const progress = await s.progress(a, { runId })
  assert.equal(progress.done, progress.total)
  assert.deepEqual(progress.activities, ['quiz', 'learning'])
  assert.deepEqual((await s.storyLibrary(a)).map(entry => [entry.act, entry.unlocked]), [[5, true], [6, true]])
  assert.deepEqual(await s.storyLibrary(b), [])
})

test('reader checkpoint validates graph paths, retries, and concurrent updates on the pinned release', async () => {
  const { s, admin, a, b } = setup()
  await s.saveDraft(admin, { ...hunan, culture: hunanCulture })
  await s.publish(admin, { id: hunan.id, revision: 1 })
  const { id: runId } = await s.start(a, { routeId: hunan.id, requestId: 'reader-test' })
  await checkPoint(s, a, runId)
  await s.answerQuiz(a, { runId, option: 'b' })
  const p = { runId, act: 5, revision: 0 }
  await assert.rejects(s.saveReading(a, { ...p, path: ['start', 'right', 'left'] }), /INVALID_READING_PATH/)
  await assert.rejects(s.saveReading(b, { ...p, path: ['start', 'left'] }), /NOT_FOUND/)
  const checkpoint = await s.saveReading(a, { ...p, path: ['start', 'left'] })
  assert.deepEqual(await s.saveReading(a, { ...p, path: ['start', 'left'] }), checkpoint)
  await assert.rejects(s.saveReading(a, { ...p, path: ['start', 'right'] }), /CONFLICT/)
  await s.saveDraft(admin, { ...hunan, revision: 1, culture: { ...hunanCulture, chapters: [{ ...chapter, title: '新版' }] } })
  await s.publish(admin, { id: hunan.id, revision: 2 })
  const resumed = await s.storyChapter(a, p)
  assert.equal(resumed.chapter.title, chapter.title)
  assert.deepEqual(resumed.checkpoint, checkpoint)
  assert.deepEqual(await s.saveReading(a, { ...p, revision: checkpoint.revision, path: ['start'] }), { path: ['start'], revision: 2 })
})

test('content validation rejects cycles, unreachable scenes, missing targets and unknown assets', async () => {
  const { s, admin } = setup()
  const left = scenes[1]
  for (const nextSceneId of ['start', 'missing']) {
    await assert.rejects(s.saveDraft(admin, { ...hunan, culture: { quiz, chapters: [{ ...chapter, scenes: [scenes[0], { ...left, nextSceneId }, scenes[2]] }] } }), /INVALID_SCENE_GRAPH/)
  }
  const withExtra = [...scenes, { id: 'hidden', kind: 'ending', text: '隐藏' }]
  await assert.rejects(s.saveDraft(admin, { ...hunan, culture: { quiz, chapters: [{ ...chapter, scenes: withExtra }] } }), /INVALID_SCENE_GRAPH/)
  const withUnknownAsset = [{ ...scenes[0], asset: 'missing' }, ...scenes.slice(1)]
  await assert.rejects(s.saveDraft(admin, { ...hunan, culture: { quiz, chapters: [{ ...chapter, scenes: withUnknownAsset }] } }), /INVALID_SCENE/)
})

test('the bundled route templates preview without writes and publish only their selected revisions', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/features/stage-three-content.uts'), 'utf8')
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
  const { macauContent, hunanContent } = await import(moduleUrl)
  const { s, repo, admin, a } = setup()
  const macau = { ...draft, nodes: [...draft.nodes, { ...draft.nodes[0], id: 'n2' }], culture: macauContent(['n1', 'n2']) }
  const expected = [2, 3, 4]
  const macauPreview = (await s.previewDraft(admin, macau)).culture
  const hunanPreview = (await s.previewDraft(admin, { ...hunan, culture: hunanContent() })).culture
  assert.deepEqual(macauPreview.chapters.map(chapter => chapter.act), expected)
  assert.equal(macauPreview.chapters[0].checkinMode, 'any')
  assert.equal(macauPreview.chapters[2].activity, 'tileQuiz')
  assert.deepEqual(macauPreview.tile.after, [])
  assert.deepEqual(hunanPreview.chapters.map(chapter => chapter.act), [5, 6])
  assert.deepEqual(hunanPreview.quiz.after, [])
  await assert.rejects(s.previewDraft(a, macau), /FORBIDDEN/)
  assert.deepEqual(await s.drafts(admin), [])
  assert.deepEqual(await s.catalog(), [])
  await s.saveDraft(admin, macau)
  const v1 = await s.publish(admin, { id: macau.id, revision: 1 })
  const savedVersion = await repo.get('fy-versions', v1.version)
  await s.saveDraft(admin, { ...macau, revision: 1, name: '修订二' })
  await assert.rejects(s.publish(admin, { id: macau.id, revision: 3 }), /CONFLICT/)
  const v2 = await s.publish(admin, { id: macau.id, revision: 2 })
  assert.notEqual(v1.version, v2.version)
  assert.deepEqual(await s.publish(admin, { id: macau.id, revision: 1 }), v1)
  assert.deepEqual(await repo.get('fy-versions', v1.version), savedVersion)
  assert.equal((await s.catalog())[0].version, v2.version)
  const production = createService({ repo, allowTestContent: false })
  assert.equal((await production.previewDraft(admin, macau)).releaseAllowed, false)
  await production.saveDraft(admin, { ...macau, revision: 2 })
  await assert.rejects(production.publish(admin, { id: macau.id, revision: 3 }), /TEST_CONTENT_DISABLED/)
})

test('combined test revision attaches four tasks to old explorations and carries matching progress by owner', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/features/stage-three-content.uts'), 'utf8')
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
  const { combinedContent, macauContent, hunanContent } = await import(moduleUrl)
  const { s, repo, admin, a, b } = setup()
  const macauSource = { ...draft, id: 'trial-macau', culture: macauContent(['n1']) }
  const hunanSource = { ...hunan, id: 'trial-hunan', culture: hunanContent() }
  for (const route of [draft, macauSource, hunanSource]) {
    await s.saveDraft(admin, route)
    await s.publish(admin, { id: route.id, revision: 1 })
  }
  const old = (await s.start(a, { routeId: draft.id, requestId: 'main-old' })).id
  await checkPoint(s, a, old)
  const before = await s.progress(a, { runId: old })
  const macauRun = (await s.start(a, { routeId: macauSource.id, requestId: 'trial-macau' })).id
  const work = await s.saveTile(a, { runId: macauRun, pattern: 'sail', palette: 'mist' })
  await s.answerQuiz(a, { runId: macauRun, activityId: 'tileQuiz', option: 'b' })
  const checkpoint = await s.saveReading(a, { runId: macauRun, act: 4, revision: 0, path: ['shore', 'exchange'] })
  const hunanRun = (await s.start(a, { routeId: hunanSource.id, requestId: 'trial-hunan' })).id
  await s.answerQuiz(a, { runId: hunanRun, option: 'b' })
  await s.readCard(a, { runId: hunanRun, cardId: 'direction' })

  const merged = {
    ...draft, revision: 1, nodes: [{ ...draft.nodes[0], id: 'new-map-point' }],
    culture: combinedContent(['new-map-point']), cultureUpgrade: [macauSource.id, hunanSource.id]
  }
  await assert.rejects(s.saveDraft(admin, { ...merged, cultureUpgrade: [merged.id] }), /INVALID_CULTURE_UPGRADE/)
  await s.saveDraft(admin, merged)
  const { version } = await s.publish(admin, { id: merged.id, revision: 2 })
  const [progress, library] = await Promise.all([s.routeProgress(a, { routeId: merged.id }), s.storyLibrary(a)])
  assert.equal(progress.runId, old)
  assert.equal(progress.version, before.version)
  assert.deepEqual(progress.snapshot.nodes, before.snapshot.nodes)
  assert.deepEqual(progress.completed, ['n1'])
  assert.deepEqual(progress.activities, ['tile', 'tileQuiz', 'quiz'])
  assert.equal((await repo.get('fy-runs', old)).cultureVersion, version)
  assert.equal((await s.diary(a)).length, 1)
  assert.deepEqual(await s.works(a), [{ runId: old, routeName: draft.name, ...work }])
  assert.deepEqual((await s.storyChapter(a, { runId: old, act: 4 })).checkpoint, checkpoint)
  assert.deepEqual(library.filter(entry => entry.routeId === merged.id).map(e => [e.act, e.unlocked, e.nextActivityId]),
    [[2, true, null], [3, true, null], [4, true, null], [5, true, null], [6, false, 'learning']])
  assert.deepEqual((await s.activityStatus(a, { runId: old, activityId: 'learning' })).read, ['direction'])
  const fresh = (await s.start(b, { routeId: merged.id, requestId: 'main-other' })).id
  const second = await s.progress(b, { runId: fresh })
  assert.deepEqual(second.activities, [])
  assert.equal((await s.storyLibrary(b)).find(entry => entry.act === 6).nextActivityId, 'quiz')
  await assert.rejects(s.progress(b, { runId: old }), /NOT_FOUND/)
  const visible = await s.catalog()
  assert.deepEqual(visible.map(route => route.id), [merged.id])
  assert.equal(visible[0].chapters.length, 5)
  assert.deepEqual((await s.routeProgress(a, { routeId: macauSource.id })).activities, ['tile', 'tileQuiz'])
})

test('exhibit clues gate the next solo check-in, keep answers private, and pin the release', async () => {
  const { s, repo, a, b, admin } = setup()
  const first = { ...draft.nodes[0], clue: { story: '蓝白图案有船帆和海浪。', question: '输入提示航行的两个字。', answer: '船帆' } }
  const next = { ...draft.nodes[0], id: 'n2', afterClue: first.id, clue: { story: '下一站故事。', question: '下一站问题？', answer: '答案' } }
  const route = { ...draft, nodes: [first, next] }
  for (const nodes of [[next, first], [draft.nodes[0], next]]) {
    await assert.rejects(s.previewDraft(admin, { ...route, nodes }), /INVALID_CLUE_GATE/)
  }
  await s.saveDraft(admin, route)
  await s.publish(admin, { id: route.id, revision: 1 })
  const { id: runId } = await s.start(a, { routeId: route.id, requestId: 'clue-start-a' })
  const { id: otherRun } = await s.start(b, { routeId: route.id, requestId: 'clue-start-b' })
  const [published] = await s.catalog()
  assert.deepEqual(published.nodes[0].clue, { story: first.clue.story, question: first.clue.question })
  assert.equal(published.nodes[1].clue, undefined)
  const initial = await s.progress(a, { runId })
  assert.equal(initial.snapshot.nodes[0].clue.answer, undefined)
  assert.equal(initial.snapshot.nodes[1].clue, undefined)

  const station = { runId, nodeId: first.id, requestId: 'clue-check-a' }
  const later = { runId, nodeId: next.id, requestId: 'clue-check-next' }
  await assert.rejects(s.mediaBinding(a, later), /CLUE_LOCKED/)
  await assert.rejects(s.checkin(a, later), /CLUE_LOCKED/)
  await s.registerMedia(a, { ...station, id: 'clue-media', fileID: 'private' })
  const checkin = { ...station, latitude: 22, longitude: 113, mediaId: 'clue-media' }
  await assert.rejects(s.checkin(a, { ...checkin, clueAnswer: '海浪' }), /CLUE_INCORRECT/)
  await assert.rejects(s.checkin(a, { ...checkin, clueAnswer: '船帆', latitude: 23 }), /OUTSIDE_RANGE/)
  assert.equal((await repo.get('fy-media', 'clue-media')).used, false)
  assert.deepEqual((await s.progress(a, { runId })).completed, [])
  await s.saveDraft(admin, { ...route, revision: 1, nodes: [{ ...first, clue: { ...first.clue, answer: '海浪' } }, next] })
  await s.publish(admin, { id: route.id, revision: 2 })
  const { id: freshRun } = await s.start(b, { routeId: route.id, requestId: 'clue-fresh' })
  await assert.rejects(s.checkin(b, { ...checkin, runId: freshRun, clueAnswer: '船帆' }), /CLUE_INCORRECT/)
  await s.checkin(a, { ...checkin, clueAnswer: ' 船帆 ' })
  assert.equal((await s.checkin(a, checkin)).alreadyCompleted, true)
  const reopened = await s.progress(a, { runId })
  assert.deepEqual(reopened.completed, [first.id])
  assert.deepEqual(reopened.snapshot.nodes[1].clue, { story: next.clue.story, question: next.clue.question })
  await s.mediaBinding(a, later)
  await assert.rejects(s.mediaBinding(b, { ...later, runId: otherRun }), /CLUE_LOCKED/)
  await assert.rejects(s.readMedia(b, { id: 'clue-media' }), /NOT_FOUND/)
})

test('legacy routes, cooperation and PK snapshots do not require solo exhibit clues', async () => {
  const { s, repo, a, admin } = setup()
  await s.saveDraft(admin, draft)
  await s.publish(admin, { id: draft.id, revision: 1 })
  const { id: legacy } = await s.start(a, { routeId: draft.id, requestId: 'legacy-start' })
  const first = { ...draft.nodes[0], clue: { story: '绣线转向。', question: '线索是什么？', answer: '走向' } }
  await s.saveDraft(admin, { ...draft, revision: 1, nodes: [first, { ...first, id: 'n2', afterClue: first.id }] })
  const { version } = await s.publish(admin, { id: draft.id, revision: 2 })
  await repo.put('fy-runs', 'pk-clue', { uid: a.uid, routeId: draft.id, version, snapshot: await repo.get('fy-versions', version), purpose: 'pk', matchId: 'clue-match', revision: 0 })
  await repo.put('fy-matches', 'clue-match', { status: 'running', startedAt: 1000000, runs: { [a.uid]: 'pk-clue' } })
  const snapshot = await repo.get('fy-versions', version)
  const cooperation = { ...snapshot, culture: { tile: { after: ['n1'] }, quiz: { after: ['n2'] } } }
  await repo.put('fy-runs', 'coop-clue', { uid: a.uid, routeId: draft.id, version, snapshot: cooperation, purpose: 'coop', teamId: 'clue-team', revision: 0 })
  await repo.put('fy-teams', 'clue-team', { seats: { macau: 'partner', hunan: a.uid }, runs: { [a.uid]: 'coop-clue' } })

  for (const [runId, nodeId] of [[legacy, first.id], ['pk-clue', 'n2'], ['coop-clue', 'n2']]) {
    const check = { runId, nodeId, requestId: 'check-' + runId }
    await s.mediaBinding(a, check)
    await s.registerMedia(a, { ...check, id: 'media-' + runId, fileID: 'private' })
    await s.checkin(a, { ...check, latitude: 22, longitude: 113, mediaId: 'media-' + runId })
    const progress = await s.progress(a, { runId })
    assert.deepEqual(progress.completed, [nodeId])
    assert.equal(progress.snapshot.nodes[0].clue, undefined)
    assert.equal(progress.snapshot.nodes.at(-1).afterClue, undefined)
  }

  const { id: hunanRun } = await s.start(a, { routeId: draft.id, requestId: 'hunan-exhibit' })
  const check = { runId: hunanRun, nodeId: first.id, requestId: 'hunan-clue' }
  await s.registerMedia(a, { ...check, id: 'hunan-media', fileID: 'private' })
  await s.checkin(a, { ...check, latitude: 22, longitude: 113, mediaId: 'hunan-media', clueAnswer: '走向' })
  await s.mediaBinding(a, { runId: hunanRun, nodeId: 'n2', requestId: 'hunan-next' })
})

test('scripted chapter draft previews the five published acts without altering the active exploration', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/features/stage-three-content.uts'), 'utf8')
  const { combinedContent, scriptedContent } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  const { s, repo, admin, a, b } = setup()
  const old = { ...draft, culture: combinedContent(['n1']) }
  await s.saveDraft(admin, old)
  const first = await s.publish(admin, { id: draft.id, revision: 1 })
  const { id: existing } = await s.start(a, { routeId: draft.id, requestId: 'before-script' })
  await checkPoint(s, a, existing)
  const oldCheckpoint = await s.saveReading(a, { runId: existing, act: 2, revision: 0, path: ['wave', 'hold', 'rope'] })
  const revised = { ...old, revision: 1, culture: scriptedContent(['n1']) }
  const preview = await s.previewDraft(admin, revised)
  assert.deepEqual(preview.culture.chapters.map(chapter => chapter.act), [2, 3, 4, 5, 6])
  assert.equal(preview.culture.chapters[0].checkinMode, 'any')
  assert.equal((await repo.get('fy-drafts', draft.id)).revision, 1)
  await s.saveDraft(admin, revised)
  const second = await s.publish(admin, { id: draft.id, revision: 2 })
  assert.notEqual(second.version, first.version)
  assert.equal((await s.progress(a, { runId: existing })).version, first.version)
  assert.deepEqual((await s.storyChapter(a, { runId: existing, act: 2 })).checkpoint, oldCheckpoint)
  const { id: fresh } = await s.start(b, { routeId: draft.id, requestId: 'after-script' })
  assert.equal((await s.progress(b, { runId: fresh })).version, second.version)
  await assert.rejects(s.storyChapter(b, { runId: fresh, act: 2 }), /ACTIVITY_LOCKED/)
})

test('museum visit presets unlock their culture after a valid outdoor clue check-in', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/features/stage-three-content.uts'), 'utf8')
  const { museumRouteDraft } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  const { repo, admin, a } = setup()
  const s = createService({ repo, allowTestContent: false })
  for (const [route, episode, museum, activityId, radius, acts] of [
    [museumRouteDraft(true), '上集', '澳门博物馆', 'tile', 100, [2, 3, 4]],
    [museumRouteDraft(false), '下集', '湖南湘绣博物馆', 'quiz', 80, [5, 6]]
  ]) {
    const [node] = route.nodes
    const preview = await s.previewDraft(admin, route)
    assert.equal(preview.name, '海丝瓷绣·一念归期（' + episode + '）')
    assert.equal(preview.museum.name, museum)
    assert.equal(preview.testOnly, false)
    const sections = preview.description.split('\n\n')
    assert.ok(sections.length >= 5)
    assert.match(sections[1], episode === '上集' ? /澳门博物馆前地112号/ : /车站北路39号/)
    assert.match(sections[2], episode === '上集' ? /国际通商口岸/ : /针尖之源/)
    assert.equal(preview.nodes[0].radius, radius)
    assert.deepEqual(preview.culture.chapters.map(chapter => chapter.act), acts)
    for (const chapter of preview.culture.chapters) {
      const asset = chapter.scenes[0].asset
      if (asset != null) assert.ok(fs.existsSync(path.join(__dirname, '../packages/story/static', asset + '.jpg')))
    }
    await s.saveDraft(admin, route)
    await assert.rejects(s.publish(admin, { id: route.id, revision: 1 }), /CONTENT_REVIEW_REQUIRED/)
    const saved = await repo.get('fy-drafts', route.id)
    await repo.put('fy-drafts', route.id, { ...saved, contentVerified: true })
    await s.publish(admin, { id: route.id, revision: 1 })
    const published = (await s.catalog()).find(item => item.id === route.id)
    assert.equal(published.name, route.name)
    assert.equal(published.nodes[0].clue.answer, undefined)
    const { id: runId } = await s.start(a, { routeId: route.id, requestId: 'start-' + route.id })
    assert.equal((await s.activityStatus(a, { runId, activityId })).unlocked, false)
    const payload = { runId, nodeId: node.id, requestId: 'visit-' + node.id, latitude: node.latitude, longitude: node.longitude, clueAnswer: node.clue.answer }
    const mediaId = 'media-' + node.id
    await s.registerMedia(a, { ...payload, id: mediaId, fileID: 'private' })
    await assert.rejects(s.checkin(a, { ...payload, mediaId, latitude: node.latitude + 0.002 }), /OUTSIDE_RANGE/)
    await s.checkin(a, { ...payload, mediaId })
    assert.equal((await s.activityStatus(a, { runId, activityId })).unlocked, true)
  }
})
