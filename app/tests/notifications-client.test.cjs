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
 session.value=null;s.change();await s.run('refreshNotificationsSummary()');assert.equal(calls,2)
})
test('list preserves items and cursor on second-page failure, retries, and discards account changes',async()=>{
 const session={value:{uid:'A'}},pending=deferred();let mode='first',calls=0
 const s=script('packages/profile/messages/messages.uvue',{session,login:async()=>{},refreshNotificationsSummary:async()=>{},listNotifications:async cursor=>{calls++;if(mode==='fail')throw Error('NETWORK');if(mode==='pending')return pending.promise;return {items:[{id:cursor?'second':'first'}],next:cursor?'':'cursor'} }})
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
