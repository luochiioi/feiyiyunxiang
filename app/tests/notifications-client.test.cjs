const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path')
const {stripTypeScriptTypes}=require('node:module')
function script(file,globals={}) {
 let source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');if(file.endsWith('.uvue'))source=source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
 source=source.replace(/^import .+$/gm,'').replace(/export /g,'')
 const watches=[];const context=vm.createContext({ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch:(fn,cb)=>watches.push(cb),nextTick:async()=>{},onShow(){},onLoad(){},...globals})
 vm.runInContext(stripTypeScriptTypes(source),context)
 return {run:code=>vm.runInContext(code,context),change:()=>watches.forEach(cb=>cb())}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
test('summary is account bound and stale responses cannot restore a previous unread count',async()=>{
 const session={value:{uid:'A'}},pending=deferred();let calls=0
 const s=script('features/notifications.uts',{session,secured:async()=>++calls===1?pending.promise:{unread:0}})
 const old=s.run('refreshNotificationsSummary()');session.value={uid:'B'};s.change();await s.run('refreshNotificationsSummary()');pending.resolve({unread:8});await old;assert.equal(s.run('hasUnreadNotifications.value'),false)
 session.value=null;s.change();await s.run('refreshNotificationsSummary()');assert.equal(calls,3)
})
test('list preserves items and cursor on second-page failure, retries, and discards account changes',async()=>{
 const session={value:{uid:'A'}},pending=deferred();let mode='first',calls=0
 const s=script('packages/profile/messages/messages.uvue',{session,login:async()=>{},refreshNotificationsSummary:async()=>{},listNotifications:async cursor=>{if(session.value?.uid==='B')return {items:[],next:''};calls++;if(mode==='fail')throw Error('NETWORK');if(mode==='pending')return pending.promise;return {items:[{id:cursor?'second':'first'}],next:cursor?'':'cursor'} }})
 await s.run('loadMessages(true)');mode='fail';await s.run('loadMessages(false)');assert.equal(s.run('items.value.length'),1);assert.equal(s.run('cursor.value'),'cursor');assert.equal(s.run('error.value.length > 0'),true)
 mode='ok';await s.run('loadMessages(false)');assert.equal(s.run('items.value.length'),2)
 mode='pending';const old=s.run('loadMessages(true)');session.value={uid:'B'};s.change();pending.resolve({items:[{id:'private-A'}],next:''});await old;assert.equal(s.run('items.value.length'),0)
 session.value=null;s.change();await s.run('loadMessages(true)');assert.equal(calls,4)
})
test('detail renders before read, retries only failed receipt and hides prior-account data',async()=>{
 const session={value:{uid:'A'}};let loads=0,receipts=0,fail=true
 const s=script('packages/profile/message-detail/message-detail.uvue',{session,loadNotification:async()=>{loads++;return {id:'id',read:false,target:null,reason:'原因'}},readNotification:async()=>{receipts++;if(fail)throw Error('NETWORK')},refreshReviewNotices:async()=>{}})
 s.run("id.value='id'");await s.run('loadDetail()');assert.equal(s.run('detail.value.reason'),'原因');assert.equal(s.run('readError.value.length>0'),true)
 fail=false;await s.run('markRead()');assert.equal(loads,1);assert.equal(receipts,2);assert.equal(s.run('detail.value.read'),true)
 session.value={uid:'B'};s.change();assert.equal(s.run('detail.value'),null)
})

test('comment notifications open the public post while author versions retain exact preview links',()=>{
 const urls=[],s=script('packages/profile/message-detail/message-detail.uvue',{session:{value:{uid:'A'}},openPage:url=>urls.push(url)})
 s.run("detail.value={target:{postId:'post',revisionId:'version',commentId:'comment',preview:false}};openTarget()")
 assert.equal(urls[0],'/packages/community/community-post/community-post?postId=post')
 s.run('detail.value.target.preview=true;openTarget()');assert.match(urls[1],/revisionId=version/)
})
test('detail failure can retry and old-account detail and receipt responses are discarded',async()=>{
 const session={value:{uid:'A'}},pending=deferred();let mode='fail'
 const s=script('packages/profile/message-detail/message-detail.uvue',{session,loadNotification:async()=>{if(session.value?.uid==='B')throw Error('NOT_FOUND');if(mode==='fail')throw Error('NETWORK');return pending.promise},readNotification:async()=>{},refreshReviewNotices:async()=>{}})
 await s.run('loadDetail()');assert.equal(s.run('error.value.length>0'),true)
 mode='pending';const old=s.run('loadDetail()');session.value={uid:'B'};s.change();pending.resolve({id:'A-private',read:false,reason:'private'});await old;assert.equal(s.run('detail.value'),null)
})

test('refresh retry replaces the list instead of appending the first page',async()=>{
 let fail=false
 const s=script('packages/profile/messages/messages.uvue',{session:{value:{uid:'A'}},listNotifications:async()=>{if(fail)throw Error('NETWORK');return {items:[{id:'one'}],next:''}},refreshNotificationsSummary:async()=>{}})
 await s.run('loadMessages(true)');fail=true;await s.run('loadMessages(true)');fail=false;await s.run('retryLoad()');assert.equal(s.run('items.value.length'),1)
})
test('member renewal A to null to A reloads list and detail without displaying a previous request',async()=>{
 const session={value:{uid:'A'}},listCalls=[],detailCalls=[]
 const l=script('packages/profile/messages/messages.uvue',{session,listNotifications:async()=>new Promise(resolve=>listCalls.push(resolve)),refreshNotificationsSummary:async()=>{}})
 const d=script('packages/profile/message-detail/message-detail.uvue',{session,loadNotification:async()=>new Promise(resolve=>detailCalls.push(resolve)),readNotification:async()=>{},refreshReviewNotices:async()=>{}})
 const oldList=l.run('loadMessages(true)'),oldDetail=d.run('loadDetail()')
 session.value=null;l.change();d.change();session.value={uid:'A'};l.change();d.change()
 assert.equal(listCalls.length,2);assert.equal(detailCalls.length,2)
 listCalls[0]({items:[{id:'stale'}],next:''});detailCalls[0]({id:'stale',read:true});await oldList;await oldDetail
 listCalls[1]({items:[{id:'fresh'}],next:''});detailCalls[1]({id:'fresh',read:true});await new Promise(r=>setImmediate(r))
 assert.equal(l.run('items.value[0].id'),'fresh');assert.equal(d.run('detail.value.id'),'fresh')
})

test('an old account cloud response cannot clear the current session or retry under another account',async()=>{
 const pending=deferred();let calls=0
 const s=script('features/api.uts',{uni:{getStorageSync:()=>'',removeStorageSync(){throw Error('must not clear B')},setStorageSync(){}},uniCloud:{callFunction:async()=>{calls++;return pending.promise}}})
 s.run("session.value={uid:'A',token:'A-token',expiresAt:Date.now()+100000}")
 const old=s.run("secured('notificationRead',{id:'A-notice'})")
 s.run("session.value={uid:'B',token:'B-token',expiresAt:Date.now()+100000}")
 pending.resolve({result:{code:'AUTH_REQUIRED',data:null}})
 await assert.rejects(old,/SESSION_CHANGED/);assert.equal(s.run('session.value.uid'),'B');assert.equal(calls,1)
})
