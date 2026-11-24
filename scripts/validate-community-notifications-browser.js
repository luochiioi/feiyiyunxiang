// Playwright CLI: run-code --filename scripts/validate-community-notifications-browser.js
// Serve app and admin Web build directories on loopback ports 8421 and 8422.
// Local fixture only: intercept compiled cloud call boundary; never contact development cloud.
async (page) => {
 page.setDefaultTimeout(10000);
 const origins=['http://127.0.0.1:8421','http://127.0.0.1:8422'];
 await page.route('**/*', route=>origins.includes(new URL(route.request().url()).origin)?route.fallback():route.abort());
 await page.route('**/assets/*.js',async route=>{
  const response=await route.fetch();let body=await response.text();body=body.replace(/\b\w+\.callFunction\(\{name:/g,'window.__mockCloud({name:');await route.fulfill({response,body})
 });
 await page.addInitScript(()=>{
  window.__calls=[];window.__readFail=true;window.__moreFail=true;
  const first={id:'rev',postId:'post',revisionId:'rev',title:'九图本地验收',body:'本地模拟内容',imageCount:9,status:'pending',author:'测试作者',createdAt:2};
  const second={...first,id:'rev2',postId:'post2',revisionId:'rev2',title:'下一篇待审帖子',imageCount:0,createdAt:1};
  const pendingComment={id:'comment',postId:'post2',revisionId:'old',body:'待审评论正文',status:'pending',author:'模拟评论作者',createdAt:1};
  const old={id:'old',title:'旧公开版',body:'旧公开版正文',status:'approved',imageCount:0};
  const reviewed=new Set();
  window.__mockCloud=async({data})=>{
   const {action,payload={}}=data;window.__calls.push({action,payload});let result={};let code='OK';
   const item={id:'notice-1',kind:'community.post.rejected',title:'帖子审核未通过',preview:'请补充内容说明',createdAt:1795356000000,read:false};
   if(action==='notificationsSummary'||action==='communityReviewNotices')result={unread:1};
   else if(action==='notificationsList') {if(payload.cursor&&window.__moreFail){window.__moreFail=false;throw Error('NETWORK')} result={items:[{...item,id:payload.cursor?'notice-2':'notice-1'}],next:payload.cursor?'':'1795356000000-'+ 'a'.repeat(64)};}
   else if(action==='notificationDetail')result={...item,reason:'请补充内容说明',target:null};
   else if(action==='notificationRead'){if(window.__readFail){window.__readFail=false;throw Error('NETWORK')}result={};}
   else if(action==='aomiaoStatus')result={claimed:true};
   else if(action==='adminLogin')result={uid:'reviewer',username:'本地审核员',token:'local-only',expiresAt:Date.now()+3600000,admin:false};
   else if(action==='communityOverview')result={pendingPosts:[first,second].filter(row=>!reviewed.has(row.id)).length,pendingComments:Number(!reviewed.has(pendingComment.id)),openReports:0};
   else if(action==='communityReviewList'){
    if(window.__failQueue){window.__failQueue=false;throw Error('QUEUE_READ_FAILED')}
    const rows=payload.group==='pending'?[first,second]:payload.group==='comments'?[pendingComment]:[];
    result={items:rows.filter(row=>!reviewed.has(row.id)),next:''};
   }
   else if(action==='communityReviewDetail'){
    const row=payload.postId===first.postId?first:second;
    result={postId:row.postId,author:row.author,latestRevision:row.id,status:row===first?'unpublished':'public',
     selected:payload.commentId?old:row,current:row===first?null:old,reportedComment:payload.commentId?pendingComment:null};
   }
   else if(action==='communityReviewPost'||action==='communityReviewComment'){
    reviewed.add(payload.commentId||payload.revisionId);
    if(payload.revisionId===first.id)window.__failQueue=true;
   }
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
 await page.setViewportSize({width:1440,height:900});
 const legacyDetail=page.locator('.results .result').filter({hasText:'九图本地验收'}).getByText('查看详情',{exact:true});
 if(await legacyDetail.count()) await legacyDetail.click();
 else {
  const row=page.locator('.results .result').filter({hasText:'九图本地验收'});
  await row.focus();
  await row.press('Enter');
 }
 await page.getByText('重试图片',{exact:true}).waitFor();
 if(await page.locator('.photo-tile').count()!==9)throw Error('nine image tiles missing');
 const before=await page.evaluate(()=>window.__calls.filter(x=>x.action==='communityReviewImage').length);
 await page.getByText('重试图片',{exact:true}).click();await page.getByText('重试图片',{exact:true}).waitFor({state:'hidden'});
 const after=await page.evaluate(()=>window.__calls.filter(x=>x.action==='communityReviewImage').length);
 if(before!==9||after!==10)throw Error('single retry failed');
 const approve=page.getByText('通过所选版本',{exact:true});
 const approveBox=await approve.boundingBox();
 if(!approveBox||approveBox.y<0||approveBox.y+approveBox.height>900){
  await page.screenshot({path:'.superpowers/admin-nine-images-failure.png'});
  throw Error('Nine-image review actions are outside the viewport: '+JSON.stringify({
   approveBox, inspector:await page.locator('.inspector').boundingBox(),
   viewport:await page.evaluate(()=>({height:innerHeight,scroll:scrollY}))
  }));
 }
 if(await page.locator('.versions .version').count()!==1)throw Error('First submission still displays an empty public panel');
 await approve.focus();
 if(!await approve.evaluate(button=>button===document.activeElement))throw Error('Keyboard focus did not reach approval');
 await approve.press('Enter');
 await page.getByText('确定',{exact:true}).click();
 await page.getByText('重试读取队列',{exact:true}).click();
 await page.locator('.inspector').getByText('下一篇待审帖子',{exact:true}).waitFor();
 if(await page.locator('.versions .version').count()!==2)throw Error('An existing public version is missing from comparison');
 if(await page.evaluate(()=>window.__calls.filter(call=>call.action==='communityReviewPost').length)!==1)throw Error('Queue retry repeated approval');
 await page.setViewportSize({width:1024,height:768});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Review workspace overflows at 1024px');
 await approve.click();
 await page.getByText('确定',{exact:true}).click();
 await page.getByText('当前没有记录。',{exact:true}).waitFor();
 await page.locator('.tabs').getByText('待审评论',{exact:true}).click();
 await page.locator('.results .result').filter({hasText:'待审评论正文'}).click();
 await page.getByText('通过评论',{exact:true}).click();
 await page.getByText('确定',{exact:true}).click();
 await page.getByText('当前没有记录。',{exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:1000});
 const logout=await page.getByText('退出登录',{exact:true}).boundingBox();
 if(!logout||logout.x>260||logout.y<800)throw Error('sidebar footer lost');
 await page.screenshot({path:'.superpowers/admin-nine-images-browser.png',fullPage:true});
 return 'Verified message pagination and read retry, nine-image review, consecutive post review and comments';
}
