const { test } = require('node:test')
const assert = require('node:assert/strict')
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
  assert.deepEqual((await s.catalog())[0].activities, [{ id: 'tile', title: culture.tile.title }])
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
async function checkPoint(s, user, runId) {
  const payload = { runId, nodeId: 'n1', requestId: 'complete-test-point' }
  await s.registerMedia(user, { ...payload, id: 'photo', fileID: 'private-photo' })
  await s.checkin(user, { ...payload, mediaId: 'photo', latitude: 22, longitude: 113 })
}

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
