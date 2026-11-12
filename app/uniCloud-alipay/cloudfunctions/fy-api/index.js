const crypto=require('node:crypto')
const {createService,key}=require('./service')
const {createPartnershipService}=require('./partnership-service')
const {createCommunityService}=require('./community-service')
const {createCommunityMedia}=require('./community-media')
const {createCommunityOperations}=require('./community-operations')
const {createRepository}=require('./repository')
const {encrypt,decrypt,decodeImage,authenticate}=require('./security')
const { createAdminSession, authenticateAdmin, revokeAdminSession, updateAdminCredentials } = require('./admin-session')
const reviewActions = new Set(['communityReviewList', 'communityReviewDetail', 'communityReviewImage', 'communityReviewPost',
  'communityReviewComment', 'communityResolveReport', 'communityMute', 'communityPolicy', 'communitySavePolicy'])
const operationsActions = new Set(['communityOverview', 'communityUsers', 'communityUserDetail', 'communityAccountStatus'])
const adminActions = new Set(['saveDraft', 'previewDraft', 'publish', 'drafts', 'adminLogout', 'adminChangePassword', 'adminUpdateCredentials', ...reviewActions, ...operationsActions])
const guestActions = new Set(['communityFeed', 'communityPost', 'communityImage', 'communityShare', 'communityComments'])
const communityActions = new Set([...guestActions, ...reviewActions, 'communityStageImage', 'communitySubmit', 'communitySubmitGallery', 'communityReaction', 'communityComment',
  'communityReport', 'communityRanking', 'communityRemoveOwn'])
const serviceActions = new Set(['saveDraft', 'previewDraft', 'publish', 'drafts', 'start', 'checkin', 'progress', 'routeProgress',
  'diary', 'nodeRecord', 'saveTile', 'works', 'activityStatus', 'answerQuiz', 'readCard', 'storyLibrary', 'storyChapter', 'saveReading',
  'ensureProfile', 'findByCode', 'requestFriend', 'respondFriend', 'withdrawFriend', 'friends',
  'inviteCoop', 'respondCoop', 'withdrawCoop', 'leaveCoop', 'coopStatus', 'myCoop', 'settleCoop',
  'invitePk', 'respondPk', 'readyPk', 'myPk', 'settlePk', 'forfeitPk', 'assignment', 'completeAssignment', 'rejectAssignment'])
const known=new Set(['FORBIDDEN','AUTH_REQUIRED','NOT_FOUND','CONFLICT','REQUEST_CONFLICT','OUTSIDE_RANGE','MEDIA_MISMATCH','MEDIA_UPLOAD_FAILED','PHOTO_UNAVAILABLE','TEST_CONTENT_DISABLED','CONTENT_REVIEW_REQUIRED','CONFIG_REQUIRED','INVALID_IMAGE','RATE_LIMITED','LOGIN_FAILED','INVALID_PASSWORD','PASSWORD_INCORRECT','PASSWORD_UNCHANGED','USERNAME_TAKEN','CREDENTIALS_UNCHANGED','ACTIVITY_LOCKED','EXPIRED','NOT_PENDING','NOT_FRIENDS','NOT_READY','ASSIGNMENT_PENDING','TOO_EARLY','STALE_VERSION','COMMENT_REJECTED','DUPLICATE_COMMENT','COMMUNITY_MUTED','UPLOAD_NOT_AVAILABLE','UPLOAD_STAGING_UNAVAILABLE','ACCOUNT_DISABLED'])
exports.main=async(event,context)=>{
  try {
    const db=uniCloud.database(), repo=createRepository(db)
    const cfg=require('uni-config-center')({pluginId:'fy', root:__dirname, cache:false}).config()
    if(!cfg?.wechatAppId) throw new Error('CONFIG_REQUIRED')
    function memberIdentity() {
      if (!cfg.identity?.tokenSecret) throw new Error('CONFIG_REQUIRED')
      return require('uni-id-common').createInstance({ context, config: cfg.identity })
    }
    const service=createService({repo,allowTestContent:cfg.environment==='development'})
    const partners=createPartnershipService({repo})
    const action=event.action, p=event.payload??{}
    let user=null
    if (adminActions.has(action)) {
      user = await authenticateAdmin(repo, event.token)
    } else if (!['catalog', 'wxLogin', 'adminLogin'].includes(action) && !(guestActions.has(action) && !event.token)) {
      if (typeof event.token === 'string' && event.token.startsWith('fy_admin_')) {
        throw new Error('AUTH_REQUIRED')
      }
      const member = await authenticate(memberIdentity(), event.token, id => repo.get('uni-id-users', id))
      user = { uid: member.uid }
    }
    async function limited(subject,limit) {
      const bucket=key(subject,Math.floor(Date.now()/60000))
      await repo.tx(async t=>{const value=await t.get('fy-limits',bucket);if((value?.count??0)>=limit)throw new Error('RATE_LIMITED');await t.put('fy-limits',bucket,{count:(value?.count??0)+1,expiresAt:Date.now()+120000})})
    }
    let data
    if(action==='catalog') data=await service.catalog()
    else if(action==='wxLogin') {
      await limited('wx:'+context.CLIENTIP,20)
      if(typeof p.code!=='string'||p.code.length>256||!p.code)throw new Error('LOGIN_FAILED')
      if(!cfg.wechatSecret)throw new Error('CONFIG_REQUIRED')
      const result=await uniCloud.httpclient.request('https://api.weixin.qq.com/sns/jscode2session',{method:'GET',data:{appid:cfg.wechatAppId,secret:cfg.wechatSecret,js_code:p.code,grant_type:'authorization_code'},dataType:'json',timeout:10000})
      // session_key deliberately never persisted or returned.
      if(result.data?.errcode||typeof result.data?.openid!=='string')throw new Error('LOGIN_FAILED')
      const uid=key(cfg.wechatAppId,result.data.openid)
      await repo.tx(async t=>{if(!await t.get('uni-id-users',uid))await t.put('uni-id-users',uid,{role:[],token:[],status:0,dcloud_appid:[context.APPID],register_date:Date.now()})})
      const account=await repo.get('uni-id-users',uid)
      if(account.status!==0)throw new Error(account.status===1?'ACCOUNT_DISABLED':'LOGIN_FAILED')
      const token=await memberIdentity().createToken({uid})
      if(token.errCode)throw new Error('LOGIN_FAILED')
      data={uid,token:token.token,expiresAt:token.tokenExpired}
    } else if(action==='adminLogin') {
      await limited('admin:'+context.CLIENTIP,6)
      data = await createAdminSession(repo, p.username, p.password)
    } else if (action === 'adminLogout') {
      await revokeAdminSession(repo, user)
      data = {}
    } else if (action === 'adminChangePassword' || action === 'adminUpdateCredentials') {
      await limited('admin-password:' + user.uid, 5)
      if (action === 'adminChangePassword' && p.newPassword === undefined) throw new Error('INVALID_PASSWORD')
      await updateAdminCredentials(repo, user, {
        currentPassword: p.currentPassword,
        newPassword: p.newPassword,
        newUsername: action === 'adminUpdateCredentials' ? p.newUsername : undefined
      })
      data = {}
    } else if(action==='session') data=user
    else if(action==='logout') {
      await repo.tx(async t=>{const account=await t.get('uni-id-users',user.uid);await t.put('uni-id-users',user.uid,{...account,token:(account.token??[]).filter(v=>v!==event.token)})});data={}
    } else if(action==='uploadMedia') {
      if(cfg.privateStorageVerified!==true||!cfg.mediaEncryptionKey)throw new Error('CONFIG_REQUIRED')
      await limited('upload:'+user.uid,15)
      await service.mediaBinding(user,p)
      const {bytes,mime}=decodeImage(p.base64)
      const mediaKey=Buffer.from(cfg.mediaEncryptionKey,'base64')
      if(mediaKey.length!==32)throw new Error('CONFIG_REQUIRED')
      const mediaId=crypto.randomBytes(24).toString('hex')
      const upload = await uniCloud.uploadFile({ cloudPath: 'fy-private/' + user.uid + '/' + mediaId + '.bin', fileContent: encrypt(bytes, mediaKey) })
      // The storage SDK can return an error result without rejecting the promise.
      const fileID = upload?.fileID
      if (typeof fileID !== 'string' || !fileID.trim()) throw new Error('MEDIA_UPLOAD_FAILED')
      try {data=await service.registerMedia(user,{...p,id:mediaId,fileID,mime})}
      catch(e){await uniCloud.deleteFile({fileList:[fileID]}).catch(()=>{});throw e}
    } else if(action==='readMedia') {
      const media=await service.readMedia(user,p)
      const mediaKey=Buffer.from(cfg.mediaEncryptionKey??'','base64')
      if(mediaKey.length!==32)throw new Error('CONFIG_REQUIRED')
      const {fileContent}=await uniCloud.downloadFile({fileID:media.fileID})
      if (!Buffer.isBuffer(fileContent) || fileContent.length < 28) throw new Error('SERVICE_UNAVAILABLE')
      data={src:'data:'+media.mime+';base64,'+decrypt(fileContent,mediaKey).toString('base64')}
    } else if (operationsActions.has(action)) {
      data = await createCommunityOperations({ repo })[action](user, p)
    } else if (communityActions.has(action)) {
      const media = createCommunityMedia({ cloud: uniCloud, cfg, service, limited })
      const community = createCommunityService({ repo, media })
      if (action === 'communitySubmitGallery' && !Array.isArray(p.images)) throw new Error('INVALID_IMAGES')
      data = await community[action === 'communitySubmitGallery' ? 'communitySubmit' : action](user, p)
    } else {
      if(!serviceActions.has(action))throw new Error('NOT_FOUND')
      data=await (partners[action] ?? service[action])(user,p)
    }
    return {code:'OK',data}
  } catch(e) {
    // Do not log SDK errors, request bodies, tokens, exchange responses or config.
    const code=known.has(e.message)||/^INVALID_[A-Z_]+$/.test(e.message)?e.message:'SERVICE_UNAVAILABLE'
    return {code,data:null}
  }
}
