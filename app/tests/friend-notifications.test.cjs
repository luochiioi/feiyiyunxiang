const {test}=require('node:test'), assert=require('node:assert/strict')
const {transactionFixture}=require('./helpers/transaction-fixture.cjs')
const {createPartnershipService}=require('../uniCloud-alipay/cloudfunctions/fy-api/partnership-service')
const {createNotificationService}=require('../uniCloud-alipay/cloudfunctions/fy-api/notification-service')
const a={uid:'A'},b={uid:'B'},c={uid:'C'}
async function fixture(){const f=transactionFixture();let at=1784000000000;f.p=createPartnershipService({repo:f.repo,now:()=>at});f.n=createNotificationService({repo:f.repo,now:()=>at});f.advance=ms=>at+=ms;f.code={};for(const u of[a,b,c]){await f.repo.put('uni-id-users',u.uid,{status:0});f.code[u.uid]=(await f.p.ensureProfile(u)).code}f.request=(requestId='first')=>f.p.requestFriend(a,{code:f.code.B,requestId});f.list=u=>f.n.notificationsList(u,{});f.detail=(u,id)=>f.n.notificationDetail(u,{id});return f}
test('friend request and acceptance notify only verified recipients and preserve community DTO compatibility',async()=>{
 const f=await fixture();await f.request();let inbox=await f.list(b);assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].kind,'friend.request.received');assert.equal((await f.list(a)).items.length,0)
 const detail=await f.detail(b,inbox.items[0].id);assert.equal(detail.friend.status,'pending');assert.equal(detail.friend.nickname,'旅伴A');assert.equal(detail.target,null);assert.doesNotMatch(JSON.stringify(detail),/"uid"|friendId|requestId|recipientUid|actorUid/)
 await f.n.notificationRead(b,{id:detail.id});assert.equal((await f.repo.list('fy-friends',{}))[0].status,'pending')
 await f.p.respondFriend(b,{requestId:'first',accept:true});const accepted=(await f.list(a)).items[0];assert.equal(accepted.kind,'friend.request.accepted');assert.equal((await f.detail(a,accepted.id)).friend.nickname,'旅伴B');assert.equal((await f.detail(b,detail.id)).friend.status,'accepted');assert.equal((await f.list(c)).items.length,0)
 for(const method of['notificationDetail','notificationRead'])await assert.rejects(f.n[method](c,{id:detail.id,recipientUid:'B'}),/NOT_FOUND/)
})
test('request and same-decision acceptance retries preserve one event and its read receipt after lost responses',async()=>{
 const f=await fixture();f.loseNextResponse();await assert.rejects(f.request(),/RESPONSE_LOST/);await f.request();const id=(await f.list(b)).items[0].id;await f.n.notificationRead(b,{id});await f.request();assert.equal((await f.list(b)).items.length,1);assert.equal((await f.detail(b,id)).read,true)
 f.loseNextResponse();await assert.rejects(f.p.respondFriend(b,{requestId:'first',accept:true}),/RESPONSE_LOST/);await f.p.respondFriend(b,{requestId:'first',accept:true});assert.equal((await f.list(a)).items.length,1);await assert.rejects(f.p.respondFriend(b,{requestId:'first',accept:false}),/NOT_PENDING/)
})
test('notification failures roll back request records and acceptance status',async()=>{
 const f=await fixture();f.failNextNotification();await assert.rejects(f.request(),/NOTIFICATION_FAILED/);assert.equal((await f.repo.list('fy-friends',{})).length,0);assert.equal((await f.repo.list('fy-requests',{})).length,0)
 await f.request();f.failNextNotification();await assert.rejects(f.p.respondFriend(b,{requestId:'first',accept:true}),/NOTIFICATION_FAILED/);assert.equal((await f.repo.list('fy-friends',{}))[0].status,'pending');assert.equal((await f.list(a)).items.length,0)
})
test('concurrent request/accept and accept versus reject/withdraw remain atomic',async()=>{
 const f=await fixture();await Promise.all([f.request(),f.request()]);assert.equal((await f.list(b)).items.length,1)
 const accepted=await Promise.allSettled([f.p.respondFriend(b,{requestId:'first',accept:true}),f.p.respondFriend(b,{requestId:'first',accept:true})]);assert.equal(accepted.every(x=>x.status==='fulfilled'),true);assert.equal((await f.list(a)).items.length,1);assert.ok(f.conflicts()>0)
 for(const competing of['reject','withdraw']){const g=await fixture();await g.request();await Promise.allSettled([g.p.respondFriend(b,{requestId:'first',accept:true}),competing==='reject'?g.p.respondFriend(b,{requestId:'first',accept:false}):g.p.withdrawFriend(a,{requestId:'first'})]);const row=(await g.repo.list('fy-friends',{}))[0];assert.equal((await g.list(a)).items.length,row.status==='accepted'?1:0)}
})
test('withdrawn/rejected/expired and replaced requests retain snapshots without acting on a new generation',async()=>{
 for(const outcome of['withdrawn','rejected','expired']){const f=await fixture();await f.request();const id=(await f.list(b)).items[0].id;if(outcome==='withdrawn')await f.p.withdrawFriend(a,{requestId:'first'});else if(outcome==='rejected')await f.p.respondFriend(b,{requestId:'first',accept:false});else f.advance(86400000)
 assert.equal((await f.detail(b,id)).friend.status,outcome);assert.equal((await f.list(a)).items.length,0)
 await f.request('second');assert.equal((await f.detail(b,id)).friend.status,'unavailable');await assert.rejects(f.p.respondFriend(b,{requestId:'first',accept:true}),/NOT_FOUND/);await assert.rejects(f.p.withdrawFriend(a,{requestId:'first'}),/NOT_FOUND/);assert.equal((await f.repo.list('fy-friends',{}))[0].status,'pending')
 }
})
test('equal client requestIds from different senders never mix messages; missing/disabled targets are unavailable',async()=>{
 const f=await fixture();await f.request('same');await f.p.requestFriend(c,{code:f.code.B,requestId:'same'});const list=await f.list(b);assert.equal(list.items.length,2);assert.notEqual(list.items[0].id,list.items[1].id)
 await f.repo.put('uni-id-users','A',{status:1});const states=await Promise.all(list.items.map(x=>f.detail(b,x.id)));assert.equal(states.find(x=>x.friend.nickname==='旅伴A').friend.status,'unavailable');assert.equal(states.find(x=>x.friend.nickname==='旅伴C').friend.status,'pending')
})

test('separate incoming handles answer the intended sender even when raw requestIds collide',async()=>{
 const f=await fixture();await f.request('same');await f.p.requestFriend(c,{code:f.code.B,requestId:'same'})
 const incoming=(await f.p.friends(b)).filter(x=>x.kind==='incoming');assert.equal(incoming.length,2);assert.notEqual(incoming[0].id,incoming[1].id)
 const fromC=incoming.find(x=>x.nickname==='旅伴C');await f.p.respondFriend(b,{requestId:fromC.id,accept:true})
 assert.equal((await f.list(c)).items.length,1);assert.equal((await f.list(a)).items.length,0);assert.equal((await f.repo.list('fy-friends',{from:'A'}))[0].status,'pending')
})
