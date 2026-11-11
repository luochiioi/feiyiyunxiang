const crypto=require('node:crypto')
const {createService,key}=require('./service')
const {createRepository}=require('./repository')
const {encrypt,decrypt,decodeImage,authenticate}=require('./security')
const { createAdminSession, authenticateAdmin, revokeAdminSession, changeAdminPassword } = require('./admin-session')
const adminActions = new Set(['saveDraft', 'publish', 'drafts', 'adminLogout', 'adminChangePassword'])
const known=new Set(['FORBIDDEN','AUTH_REQUIRED','NOT_FOUND','CONFLICT','REQUEST_CONFLICT','OUTSIDE_RANGE','MEDIA_MISMATCH','TEST_CONTENT_DISABLED','CONTENT_REVIEW_REQUIRED','CONFIG_REQUIRED','INVALID_IMAGE','RATE_LIMITED','LOGIN_FAILED','INVALID_PASSWORD','PASSWORD_INCORRECT','PASSWORD_UNCHANGED'])
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
    const action=event.action, p=event.payload??{}
    let user=null
    if (adminActions.has(action)) {
      user = await authenticateAdmin(repo, event.token)
    } else if (!['catalog', 'wxLogin', 'adminLogin'].includes(action)) {
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
      if(account.status!==0)throw new Error('LOGIN_FAILED')
      const token=await memberIdentity().createToken({uid})
      if(token.errCode)throw new Error('LOGIN_FAILED')
      data={uid,token:token.token,expiresAt:token.tokenExpired}
    } else if(action==='adminLogin') {
      await limited('admin:'+context.CLIENTIP,6)
      data = await createAdminSession(repo, p.username, p.password)
    } else if (action === 'adminLogout') {
      await revokeAdminSession(repo, user)
      data = {}
    } else if (action === 'adminChangePassword') {
      await limited('admin-password:' + user.uid, 5)
      await changeAdminPassword(repo, user, p.currentPassword, p.newPassword)
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
      const {fileID}=await uniCloud.uploadFile({cloudPath:'fy-private/'+user.uid+'/'+mediaId+'.bin',fileContent:encrypt(bytes,mediaKey)})
      try {data=await service.registerMedia(user,{...p,id:mediaId,fileID,mime})}
      catch(e){await uniCloud.deleteFile({fileList:[fileID]}).catch(()=>{});throw e}
    } else if(action==='readMedia') {
      const media=await service.readMedia(user,p)
      const mediaKey=Buffer.from(cfg.mediaEncryptionKey??'','base64')
      if(mediaKey.length!==32)throw new Error('CONFIG_REQUIRED')
      const {fileContent}=await uniCloud.downloadFile({fileID:media.fileID})
      data={src:'data:'+media.mime+';base64,'+decrypt(fileContent,mediaKey).toString('base64')}
    } else {
      const methods={saveDraft:'saveDraft',publish:'publish',drafts:'drafts',start:'start',checkin:'checkin',progress:'progress',diary:'diary'}
      const method=methods[action]
      if(!method)throw new Error('NOT_FOUND')
      data=await service[method](user,p)
    }
    return {code:'OK',data}
  } catch(e) {
    // Do not log SDK errors, request bodies, tokens, exchange responses or config.
    const code=known.has(e.message)||/^INVALID_[A-Z_]+$/.test(e.message)?e.message:'SERVICE_UNAVAILABLE'
    return {code,data:null}
  }
}
