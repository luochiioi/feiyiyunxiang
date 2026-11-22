// Playwright CLI run-code --filename scripts/validate-friend-notifications-browser.js
// Serve this worktree's app Web build on 127.0.0.1:8421. All cloud calls are local fixtures.
async (page) => {
 await page.route('**/assets/*.js',async route=>{
  const response=await route.fetch();let body=await response.text();body=body.replace(/\b\w+\.callFunction\(\{name:/g,'window.__mockCloud({name:');await route.fulfill({response,body});
 });
 await page.addInitScript(()=>{
  window.__friendState='pending';window.__calls=[];window.__receipts=[];window.__failReceipt=true;window.__failReload=false;window.__sendLost=true;
  window.__mockCloud=async({data})=>{
   const {action,payload={}}=data,uid=data.token==='local-A'?'A':'B';window.__calls.push({action,payload,uid});let value={};
   const id=uid==='A'?'accepted':'received',kind=uid==='A'?'friend.request.accepted':'friend.request.received';
   const item={id,kind,title:uid==='A'?'好友申请已通过':'收到好友申请',preview:uid==='A'?'Bob':'Alice',createdAt:1795363200000,read:window.__receipts.includes(id)};
   if(action==='notificationsList')value={items:uid==='A'&&window.__friendState!=='accepted'?[]:[item],next:''};
   else if(action==='notificationsSummary')value={unread:window.__receipts.includes(id)?0:(uid==='B'||window.__friendState==='accepted'?1:0)};
   else if(action==='notificationDetail'){if(payload.id!==id)return {result:{code:'NOT_FOUND',data:null}};value={...item,reason:'',target:null,friend:{nickname:uid==='A'?'Bob':'Alice',status:window.__friendState}};}
   else if(action==='notificationRead'){if(window.__failReceipt){window.__failReceipt=false;throw Error('NETWORK')}window.__receipts.push(payload.id);}
   else if(action==='communityReviewNotices')value={unread:0};
   else if(action==='ensureProfile')value={code:uid==='A'?'ABCDEFGH':'BCDEFGH2'};
   else if(action==='friends'){
    if(window.__failReload){window.__failReload=false;throw Error('READ_FAILED')}
    value=window.__friendState==='pending'?(uid==='B'?[{id:'opaque-incoming-handle',kind:'incoming',nickname:'Alice',code:'ABCDEFGH'}]:[]):[{nickname:uid==='A'?'Bob':'Alice',code:uid==='A'?'BCDEFGH2':'ABCDEFGH'}];
   }
   else if(action==='assignment')value=null;
   else if(action==='respondFriend'){window.__friendState=payload.accept?'accepted':'rejected';window.__failReload=true;value={id:'pair',status:window.__friendState};}
   else if(action==='requestFriend'){if(window.__sendLost){window.__sendLost=false;throw Error('RESPONSE_LOST')}value={id:'pair'};}
   return {result:{code:'OK',data:value}};
  };
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:8421/#/packages/profile/messages/messages');
 await page.getByText('微信登录后查看本人的消息。',{exact:true}).waitFor();
 await page.evaluate(async()=>{const entry=performance.getEntriesByType('resource').find(x=>/\/api\.[^/]+\.js/.test(x.name));const api=await import(entry.name);window.__memberSession=api.s;api.s.value={uid:'B',token:'local-B',expiresAt:Date.now()+3600000};});
 await page.getByText('收到好友申请',{exact:true}).click();await page.getByText('前往旅伴处理申请',{exact:true}).waitFor();
 await page.getByText('重试标为已读',{exact:true}).click();await page.getByText('重试标为已读',{exact:true}).waitFor({state:'hidden'});
 if(await page.evaluate(()=>window.__calls.some(x=>x.action==='respondFriend')))throw Error('reading notification accepted the request');
 await page.screenshot({path:'.superpowers/friend-received-browser.png',fullPage:true});
 await page.getByText('前往旅伴处理申请',{exact:true}).click();await page.getByText('接受',{exact:true}).click();
 await page.getByText('已接受好友申请。',{exact:true}).waitFor();await page.getByText('重试读取旅伴',{exact:true}).waitFor();
 await page.getByText('重试读取旅伴',{exact:true}).click();await page.getByText('重试读取旅伴',{exact:true}).waitFor({state:'hidden'});
 if(await page.evaluate(()=>window.__calls.filter(x=>x.action==='respondFriend').length)!==1)throw Error('read retry repeated decision');
 await page.screenshot({path:'.superpowers/friend-companion-browser.png',fullPage:true});
 await page.goBack();await page.getByText('好友关系已建立，可以前往旅伴查看。',{exact:true}).waitFor();
 await page.evaluate(()=>window.__memberSession.value={uid:'A',token:'local-A',expiresAt:Date.now()+3600000});
 await page.getByText('返回消息列表',{exact:true}).click();await page.getByText('好友申请已通过',{exact:true}).click();await page.getByText('Bob',{exact:true}).waitFor();
 await page.screenshot({path:'.superpowers/friend-accepted-browser.png',fullPage:true});
 await page.getByText('查看旅伴',{exact:true}).click();await page.locator('input').fill('BCDEFGH2');await page.getByText('添加',{exact:true}).click();
 // Simulated lost write response: code remains and the same requestId is reused.
 await page.getByText('添加',{exact:true}).click();await page.getByText('好友请求已发送。',{exact:true}).waitFor();
 const sent=await page.evaluate(()=>window.__calls.filter(x=>x.action==='requestFriend'));
 if(sent.length!==2||sent[0].payload.requestId!==sent[1].payload.requestId)throw Error('lost response retried with another request id');
}
