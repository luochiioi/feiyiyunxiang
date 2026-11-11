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
