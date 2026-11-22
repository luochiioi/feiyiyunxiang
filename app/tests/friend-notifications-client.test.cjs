const {test}=require('node:test'),assert=require('node:assert/strict')
const {clientScript}=require('./helpers/client-script.cjs')
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function partner(overrides={}){let counter=0;const toasts=[];return clientScript('packages/partner/partner/partner.uvue',{session:{value:{uid:'A'}},secured:async()=>({code:'ABCDEFGH'}),loadFriends:async()=>[],loadAssignment:async()=>null,refreshNotificationsSummary:async()=>{},requestId:()=> 'request-'+(++counter),uni:{showToast:x=>toasts.push(x)},showError:()=>{},...overrides})}
test('friend details go to the existing companion page, never a community target or decision call',()=>{
 const urls=[],s=clientScript('packages/profile/message-detail/message-detail.uvue',{session:{value:{uid:'A'}},openPage:url=>urls.push(url)})
 s.run("detail.value={kind:'friend.request.received',friend:{nickname:'旅伴',status:'pending'},target:null};openFriend()")
 assert.equal(urls[0],'/packages/partner/partner/partner')
 assert.equal(s.run("friendStatusText('expired')").includes('过期'),true);assert.equal(s.run("friendStatusText('unavailable')").length>0,true)
})
test('failed friend sends reuse the request id and successful write with failed reload only retries reads',async()=>{
 const calls=[];let failSend=true,failRead=false,reads=0
 const s=partner({sendFriendRequest:async(code,id)=>{calls.push({code,id});if(failSend)throw Error('NETWORK')},loadFriends:async()=>{reads++;if(failRead)throw Error('READ_FAILED');return []}})
 s.run("code.value='ABCDEFGH'");await s.run('addFriend()');assert.equal(s.run('code.value'),'ABCDEFGH')
 failSend=false;failRead=true;await s.run('addFriend()');assert.equal(calls[0].id,calls[1].id);assert.equal(s.run('code.value'),'');assert.equal(s.run('actionMessage.value.length>0'),true);assert.equal(s.run('loadError.value.length>0'),true)
 failRead=false;await s.run('loadPartner()');assert.equal(calls.length,2);assert.equal(reads,2)
})
test('account switches clear companion data and discard old list/decision/send responses',async()=>{
 const session={value:{uid:'A'}},pending=deferred();let mode='load'
 const s=partner({session,loadFriends:async()=>session.value?.uid==='A'?pending.promise:[],sendFriendRequest:async()=>pending.promise,answerFriendRequest:async()=>pending.promise})
 const old=s.run('loadPartner()');session.value={uid:'B'};s.change();pending.resolve([{kind:'incoming',id:'private-A',nickname:'private-A',code:'ABCDEFGH'}]);await old;await new Promise(r=>setImmediate(r));assert.equal(s.run('incoming.value.length'),0)
 const send=deferred();const q=partner({session,sendFriendRequest:async()=>send.promise});q.run("code.value='ABCDEFGH'");const writing=q.run('addFriend()');session.value={uid:'C'};q.change();send.resolve({});await writing;assert.equal(q.run('actionMessage.value'),'');assert.equal(q.run('code.value'),'')
})
test('a decision succeeds locally even if refresh fails and cannot be accidentally resubmitted by read retry',async()=>{
 let writes=0,fail=true;const s=partner({answerFriendRequest:async()=>{writes++;return{}},loadFriends:async()=>{if(fail)throw Error('READ_FAILED');return[]}})
 s.run("incoming.value=[{id:'request',code:'ABCDEFGH',nickname:'旅伴'}]");await s.run("answer('request',true)");assert.equal(writes,1);assert.equal(s.run('incoming.value.length'),0);assert.equal(s.run('friends.value.length'),1)
 fail=false;await s.run('loadPartner()');assert.equal(writes,1)
})

test('returning from companion handling reloads current friend status without repeating an acknowledged receipt',async()=>{
 let show=null,status='pending',read=false,receipts=0
 const s=clientScript('packages/profile/message-detail/message-detail.uvue',{session:{value:{uid:'B'}},onShow:fn=>show=fn,loadNotification:async()=>({id:'notice',kind:'friend.request.received',read,target:null,reason:'',friend:{nickname:'Alice',status}}),readNotification:async()=>{read=true;receipts++},refreshReviewNotices:async()=>{}})
 await s.run('loadDetail()');assert.equal(s.run('detail.value.friend.status'),'pending');status='accepted';assert.notEqual(show,null);await show();assert.equal(s.run('detail.value.friend.status'),'accepted');assert.equal(receipts,1)
})

test('same-account renewal preserves an unconfirmed send id while a different account clears it',async()=>{
 const session={value:{uid:'A'}},calls=[];let fail=true
 const s=partner({session,sendFriendRequest:async(code,id)=>{calls.push(id);if(fail)throw Error('RESPONSE_LOST');return{}}})
 s.run("code.value='ABCDEFGH'");await s.run('addFriend()');session.value=null;s.change();session.value={uid:'A'};s.change();await new Promise(r=>setImmediate(r));assert.equal(s.run('code.value'),'ABCDEFGH');fail=false;await s.run('addFriend()');assert.equal(calls[0],calls[1])
 fail=true;s.run("code.value='BCDEFGH2'");await s.run('addFriend()');session.value=null;s.change();session.value={uid:'B'};s.change();assert.equal(s.run('code.value'),'');assert.equal(s.run('pendingRequest.value'),'')
})
