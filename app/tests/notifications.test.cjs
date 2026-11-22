const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createNotificationService, writeNotification, markNotificationRead } = require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')
const A = { uid: 'A' }, B = { uid: 'B' }
function fixture() {
  const rows = new Map(); let counts = 0
  const access = map => ({
    async get(c,id) { const v=map.get(c+'/'+id); return v ? {...structuredClone(v),_id:id} : null },
    async put(c,id,v) { map.set(c+'/'+id, structuredClone(v)) }
  })
  const repo = { ...access(rows),
    async tx(fn) { const copy=new Map(rows); const result=await fn(access(copy)); rows.clear(); for(const [k,v] of copy) rows.set(k,v); return result },
    async page(c,q,{before,size}) { return [...rows].filter(([k,v])=>k.startsWith(c+'/')&&Object.entries(q).every(([a,b])=>v[a]===b)&&(!before||v.order<before)).map(([k,v])=>({...v,_id:k.slice(c.length+1)})).sort((a,b)=>b.order.localeCompare(a.order)).slice(0,size) },
    async count(c,q) { counts++; return [...rows].filter(([k,v])=>k.startsWith(c+'/')&&Object.entries(q).every(([a,b])=>v[a]===b)).length }
  }
  return {repo, rows, counts:()=>counts, service:createNotificationService({repo,now:()=>1784000000010})}
}
const event = (n=0, extra={}) => ({recipientUid:'A', kind:'community.post.rejected', postId:'post'+n,revisionId:'version'+n,commentId:'',reason:'修改原因',createdAt:1784000000000,...extra})
test('notification pages are stable for same millisecond and insertion between pages; summary uses recipient count', async()=>{
 const f=fixture(); for(let n=0;n<45;n++) await writeNotification(f.repo,event(n))
 let page=await f.service.notificationsList(A,{recipientUid:'B'}); assert.equal(page.items.length,20)
 const ids=page.items.map(x=>x.id)
 await writeNotification(f.repo,event(99,{createdAt:1784000000001}))
 page=await f.service.notificationsList(A,{cursor:page.next}); assert.equal(page.items.length,20); ids.push(...page.items.map(x=>x.id))
 page=await f.service.notificationsList(A,{cursor:page.next}); assert.equal(page.items.length,5); assert.equal(page.next,'');ids.push(...page.items.map(x=>x.id));assert.equal(new Set(ids).size,45)
 assert.equal((await f.service.notificationsSummary(A)).unread,46);assert.equal((await f.service.notificationsSummary(B)).unread,0);assert.equal(f.counts(),2)
 await assert.rejects(f.service.notificationsList(A,{cursor:'wrong'}),/INVALID_CURSOR/)
})
test('only recipient can read; repeated writes and receipts preserve readAt; DTO does not leak internals',async()=>{
 const f=fixture(), id=await writeNotification(f.repo,event())
 for(const u of [null,{uid:'R',reviewer:true},{uid:'M',admin:true}]) await assert.rejects(f.service.notificationsSummary(u),/AUTH_REQUIRED/)
 for(const method of ['notificationDetail','notificationRead']) await assert.rejects(f.service[method](B,{id,recipientUid:'A'}),/NOT_FOUND/)
 await f.service.notificationRead(A,{id});const row=await f.repo.get('fy-notifications',id)
 await markNotificationRead(f.repo,'A',id,1784000000020);await writeNotification(f.repo,event());assert.equal((await f.repo.get('fy-notifications',id)).readAt,row.readAt)
 const detail=await f.service.notificationDetail(A,{id});assert.equal(detail.read,true);assert.equal(detail.target,null);assert.deepEqual(Object.keys(detail).sort(),['createdAt','id','kind','preview','read','reason','target','title'])
 for(const extra of [{kind:'unknown'},{recipientUid:''},{reason:'a'.repeat(301)}]) await assert.rejects(writeNotification(f.repo,event(1,extra)),/INVALID_NOTIFICATION/)
})
test('targets are revalidated; removed posts retain snapshot without link; only matching rejected version is marked',async()=>{
 const f=fixture(),id=await writeNotification(f.repo,event())
 await f.repo.put('fy-community-posts','post0',{uid:'A',latestRevision:'new',status:'unpublished'})
 await f.repo.put('fy-community-versions','version0',{uid:'A',postId:'post0',status:'rejected'})
 await f.repo.put('fy-community-versions','new',{uid:'A',postId:'post0',status:'rejected',reviewSeen:false})
 assert.deepEqual((await f.service.notificationDetail(A,{id})).target,{postId:'post0',revisionId:'version0',commentId:'',preview:true})
 await f.service.notificationRead(A,{id});assert.equal((await f.repo.get('fy-community-versions','version0')).reviewSeen,true);assert.equal((await f.repo.get('fy-community-versions','new')).reviewSeen,false)
 await f.repo.put('fy-community-posts','post0',{uid:'A',status:'removed'});assert.equal((await f.service.notificationDetail(A,{id})).target,null)
})
