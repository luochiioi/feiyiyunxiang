// Playwright CLI: run-code --filename scripts/validate-community-notifications-browser.js
// Serve app and admin Web build directories on loopback ports 8421 and 8422.
// Local fixture only: intercept compiled cloud call boundary; never contact development cloud.
async (page) => {
 await page.route('**/assets/*.js',async route=>{
  const response=await route.fetch();let body=await response.text();body=body.replace(/\b\w+\.callFunction\(\{name:/g,'window.__mockCloud({name:');await route.fulfill({response,body})
 });
 await page.addInitScript(()=>{
  window.__calls=[];window.__readFail=true;window.__moreFail=true;
  window.__mockCloud=async({data})=>{
   const {action,payload={}}=data;window.__calls.push({action,payload});let result={};let code='OK';
   const item={id:'notice-1',kind:'community.post.rejected',title:'帖子审核未通过',preview:'请补充内容说明',createdAt:1795356000000,read:false};
   if(action==='notificationsSummary'||action==='communityReviewNotices')result={unread:1};
   else if(action==='notificationsList') {if(payload.cursor&&window.__moreFail){window.__moreFail=false;throw Error('NETWORK')} result={items:[{...item,id:payload.cursor?'notice-2':'notice-1'}],next:payload.cursor?'':'1795356000000-'+ 'a'.repeat(64)};}
   else if(action==='notificationDetail')result={...item,reason:'请补充内容说明',target:null};
   else if(action==='notificationRead'){if(window.__readFail){window.__readFail=false;throw Error('NETWORK')}result={};}
   else if(action==='aomiaoStatus')result={claimed:true};
   else if(action==='adminLogin')result={uid:'reviewer',username:'本地审核员',token:'local-only',expiresAt:Date.now()+3600000,admin:false};
   else if(action==='communityOverview')result={pendingPosts:1,pendingComments:0,reports:0,audit:[]};
   else if(action==='communityReviewList')result={items:[{id:'rev',postId:'post',revisionId:'rev',title:'九图本地验收',body:'本地模拟内容',imageCount:9,status:'pending',author:'测试作者'}],next:''};
   else if(action==='communityReviewDetail')result={postId:'post',revisionId:'rev',title:'九图本地验收',body:'本地模拟内容',imageCount:9,status:'pending',author:'测试作者',selected:{id:'rev',title:'九图本地验收',body:'本地模拟内容',imageCount:9,status:'pending'},current:null};
   else if(action==='communityReviewImage'){if(payload.index===8&&!window.__imageRetried){window.__imageRetried=true;throw Error('NETWORK')}result={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='};}
   return {result:{code,data:result}};
  };
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:8421/#/packages/profile/messages/messages');
 await page.getByText('微信登录后查看本人的消息。',{exact:true}).waitFor();
 await page.evaluate(async()=>{const entry=performance.getEntriesByType('resource').find(x=>/\/api\.[^/]+\.js/.test(x.name));const api=await import(entry.name);api.s.value={uid:'local-A',token:'local-only',expiresAt:Date.now()+3600000};});
 await page.getByText('帖子审核未通过',{exact:true}).first().waitFor();
 await page.getByText('加载更多',{exact:true}).click();await page.getByText('消息暂时无法读取，请重试。',{exact:true}).waitFor();
 await page.getByText('重试加载',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.unread').length===2);
 await page.screenshot({path:'.superpowers/messages-browser.png',fullPage:true});
 await page.getByText('帖子审核未通过',{exact:true}).first().click();
 await page.getByText('审核员处理原因',{exact:true}).waitFor();await page.getByText('重试标为已读',{exact:true}).waitFor();
 const loads=await page.evaluate(()=>window.__calls.filter(x=>x.action==='notificationDetail').length);
 await page.getByText('重试标为已读',{exact:true}).click();await page.getByText('重试标为已读',{exact:true}).waitFor({state:'hidden'});
 if(await page.evaluate(()=>window.__calls.filter(x=>x.action==='notificationDetail').length)!==loads)throw Error('receipt reloads detail');
 await page.screenshot({path:'.superpowers/message-detail-browser.png',fullPage:true});
 await page.goto('http://127.0.0.1:8422/');
 await page.getByRole('textbox').nth(0).fill('local-reviewer');await page.getByRole('textbox').nth(1).fill('local-only-password');await page.getByText('登录工作台',{exact:true}).click();
 await page.getByText('退出登录',{exact:true}).waitFor();await page.getByText('社区审核与治理',{exact:true}).click();
 await page.getByText('查看详情',{exact:true}).click();
 await page.getByText('重试图片',{exact:true}).waitFor();
 if(await page.locator('.photo-tile').count()!==9)throw Error('nine image tiles missing');
 const before=await page.evaluate(()=>window.__calls.filter(x=>x.action==='communityReviewImage').length);
 await page.getByText('重试图片',{exact:true}).click();await page.getByText('重试图片',{exact:true}).waitFor({state:'hidden'});
 const after=await page.evaluate(()=>window.__calls.filter(x=>x.action==='communityReviewImage').length);
 if(before!==9||after!==10)throw Error('single retry failed');
 await page.setViewportSize({width:1440,height:1000});
 const logout=await page.getByText('退出登录',{exact:true}).boundingBox();
 if(!logout||logout.x>260||logout.y<800)throw Error('sidebar footer lost');
 await page.screenshot({path:'.superpowers/admin-nine-images-browser.png',fullPage:true});
}
