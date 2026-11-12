const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const entry=path.resolve(__dirname,'../uniCloud-alipay/cloudfunctions/fy-api/index.js')
const nativeRequire=createRequire(entry)
function gateway({configured=true,validCode=true,privateStorageVerified=false,storage=null,missingCollection=null}={}) {
 const rows=new Map()
 const db={collection(c){if(c===missingCollection)throw new Error('collection does not exist');return {doc(id){return {async get(){return {data:rows.has(c+id)?[{...rows.get(c+id),_id:id}]:[]}},async set(v){rows.set(c+id,v)}}},where(q){return {limit(){return {async get(){return {data:[...rows].filter(([k,v])=>k.startsWith(c)&&Object.entries(q).every(([a,b])=>v[a]===b)).map(([k,v])=>({...v,_id:k.slice(c.length)}))}}}}}}}},async startTransaction(){return {...db,async commit(){},async rollback(){}}}}
 let exchanges=0,uploads=0
 const cloud={database:()=>db,httpclient:{async request(url,opts){exchanges++;assert.equal(url,'https://api.weixin.qq.com/sns/jscode2session');assert.equal(opts.data.js_code,'wx-code');assert.equal(opts.data.secret,'server-fixture-secret');return {data:validCode?{openid:'fixture-openid',session_key:'never-return-this'}:{errcode:40029}}}},async uploadFile(args){uploads++;assert.ok(storage,'unexpected upload');return storage.uploadFile(args)},async downloadFile(args){assert.ok(storage,'unexpected download');return storage.downloadFile(args)}}
 const identity={async checkToken(token){return token==='fixture-token'?{uid:'member',errCode:0}:{errCode:'expired'}},async createToken({uid}){return {errCode:0,token:'issued-token',tokenExpired:1000,uid}}}
 const sandbox={exports:{},uniCloud:cloud,Buffer,__dirname:path.dirname(entry),require(name){if(name==='uni-config-center')return ()=>({config:()=>configured?{wechatAppId:'public-appid',wechatSecret:'server-fixture-secret',identity:{tokenSecret:'fixture-token-secret'},environment:'development',privateStorageVerified,mediaEncryptionKey:Buffer.alloc(32,7).toString('base64')}:null});if(name==='uni-id-common')return {createInstance:()=>identity};return nativeRequire(name)}}
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),sandbox,{filename:entry})
 return {main:(event)=>sandbox.exports.main(event,{CLIENTIP:'fixture-ip',APPID:'fixture-app'}),rows,counts:()=>({exchanges,uploads})}
}
test('gateway exchanges WeChat code on server and never returns session_key or secret',async()=>{const g=gateway();const r=await g.main({action:'wxLogin',payload:{code:'wx-code'}});assert.equal(r.code,'OK');assert.equal(r.data.token,'issued-token');assert.equal(g.counts().exchanges,1);assert.doesNotMatch(JSON.stringify(r),/never-return|server-fixture|openid/);})
test('gateway rejects invalid code and missing configuration without pretending login',async()=>{assert.equal((await gateway({validCode:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'LOGIN_FAILED');assert.equal((await gateway({configured:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'CONFIG_REQUIRED');})
test('gateway ignores submitted uid/admin and denies ordinary member operations',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});for(const action of ['drafts','saveDraft','previewDraft','publish'])assert.equal((await g.main({action,token:'fixture-token',uid:'administrator',admin:true,payload:{}})).code,'AUTH_REQUIRED');assert.equal((await g.main({action:'diary',token:'expired',uid:'member'})).code,'AUTH_REQUIRED');})
test('unverified private storage blocks all uploads before SDK is called',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});assert.equal((await g.main({action:'uploadMedia',token:'fixture-token',payload:{base64:'fixture'}})).code,'CONFIG_REQUIRED');assert.equal(g.counts().uploads,0);})

test('storage errors without a file ID preserve retry and never create a broken photo record', async () => {
  const fileID = 'cloud://fixture/fy-private/photo.bin'
  let failUpload = true
  let ciphertext = null
  const storage = {
    async uploadFile({ fileContent }) {
      if (failUpload) return { errCode: 'STORAGE_DENIED' }
      ciphertext = fileContent
      return { fileID }
    },
    async downloadFile(options) {
      assert.equal(options.fileID, fileID)
      return { fileContent: ciphertext }
    }
  }
  const g = gateway({ privateStorageVerified: true, storage })
  g.rows.set('uni-id-usersmember', { status: 0, token: ['fixture-token'], role: [] })
  g.rows.set('fy-runsfixture-run', { uid: 'member', snapshot: { nodes: [{ id: 'n1' }] } })
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='
  const call = (action, payload) => g.main({ action, token: 'fixture-token', payload })
  const payload = { runId: 'fixture-run', nodeId: 'n1', requestId: 'fixture-request', base64: png }
  assert.equal((await call('uploadMedia', payload)).code, 'MEDIA_UPLOAD_FAILED')
  assert.equal([...g.rows.keys()].some(key => key.startsWith('fy-media')), false)

  failUpload = false
  const uploaded = await call('uploadMedia', payload)
  assert.equal(uploaded.code, 'OK')
  assert.equal(uploaded.data.fileID, undefined)
  const read = await call('readMedia', { id: uploaded.data.id })
  assert.equal(read.data.src, 'data:image/png;base64,' + png)

  g.rows.set('fy-medialegacy', { uid: 'member', used: true })
  assert.equal((await call('readMedia', { id: 'legacy' })).code, 'PHOTO_UNAVAILABLE')
  g.rows.set('fy-medialegacy', { uid: 'someone-else', used: true })
  assert.equal((await call('readMedia', { id: 'legacy' })).code, 'NOT_FOUND')
})

test('admin credentials and sessions are separate from WeChat users', async () => {
  const g = gateway()
  const { hashPassword } = nativeRequire('./security')
  const password = 'fixture-admin-password'
  const account = { _id: 'operator', username: 'operator', passwordHash: hashPassword(password), role: ['admin'], status: 0 }
  g.rows.set('uni-id-usersoperator', account)
  const login = () => g.main({ action: 'adminLogin', payload: { username: 'operator', password } })
  assert.equal((await login()).code, 'LOGIN_FAILED')

  g.rows.set('fy-admin-usersoperator', account)
  const result = await login()
  assert.equal(result.code, 'OK')
  const token = result.data.token
  assert.equal((await g.main({ action: 'drafts', token })).code, 'OK')
  assert.equal((await g.main({ action: 'diary', token })).code, 'AUTH_REQUIRED')
  assert.equal((await g.main({ action: 'readMedia', token })).code, 'AUTH_REQUIRED')
  assert.equal((await g.main({ action: 'storyLibrary', token })).code, 'AUTH_REQUIRED')
  assert.equal((await g.main({ action: 'works', token })).code, 'AUTH_REQUIRED')
  assert.equal((await g.main({ action: 'adminLogout', token })).code, 'OK')
  assert.equal((await g.main({ action: 'drafts', token })).code, 'AUTH_REQUIRED')
})

test('changing the admin password verifies the current password and revokes all old sessions', async () => {
  const g = gateway()
  const { hashPassword, verifyPassword } = nativeRequire('./security')
  const oldPassword = 'fixture-initial-admin-password'
  const newPassword = 'Test-12345'
  const uid = 'operator'
  g.rows.set('fy-admin-users' + uid, { _id: uid, username: uid, passwordHash: hashPassword(oldPassword), role: ['admin'], status: 0 })

  const login = password => g.main({ action: 'adminLogin', payload: { username: uid, password } })
  const first = await login(oldPassword)
  const second = await login(oldPassword)
  assert.equal(first.code, 'OK')
  assert.equal(second.code, 'OK')

  const change = (token, currentPassword, replacement) => g.main({
    action: 'adminChangePassword', token, payload: { currentPassword, newPassword: replacement }
  })
  assert.equal((await change('fixture-token', oldPassword, newPassword)).code, 'AUTH_REQUIRED')
  assert.equal((await change(first.data.token, oldPassword, 'short')).code, 'INVALID_PASSWORD')
  assert.equal((await change(first.data.token, 'wrong-password', newPassword)).code, 'PASSWORD_INCORRECT')
  assert.equal((await change(first.data.token, oldPassword, newPassword)).code, 'OK')
  assert.equal(verifyPassword(newPassword, g.rows.get('fy-admin-users' + uid).passwordHash), true)

  for (const token of [first.data.token, second.data.token]) {
    assert.equal((await g.main({ action: 'drafts', token })).code, 'AUTH_REQUIRED')
  }
  assert.equal((await login(oldPassword)).code, 'LOGIN_FAILED')
  const renewed = await login(newPassword)
  assert.equal(renewed.code, 'OK')
  assert.equal((await g.main({ action: 'drafts', token: renewed.data.token })).code, 'OK')
})

test('renaming an administrator preserves their account ID and rejects an occupied name', async () => {
  const g = gateway()
  const { hashPassword } = nativeRequire('./security')
  const password = 'fixture-admin-password'
  const account = { username: 'operator', passwordHash: hashPassword(password), role: ['admin'], status: 0 }
  g.rows.set('fy-admin-usersoperator', account)
  g.rows.set('fy-admin-userscolleague', { ...account, username: 'colleague' })
  const login = username => g.main({ action: 'adminLogin', payload: { username, password } })
  const oldSession = (await login('operator')).data
  const rename = newUsername => g.main({ action: 'adminUpdateCredentials', token: oldSession.token, payload: { currentPassword: password, newUsername } })
  assert.equal((await rename('colleague')).code, 'USERNAME_TAKEN')
  assert.equal((await rename('new-operator')).code, 'OK')
  assert.equal((await g.main({ action: 'drafts', token: oldSession.token })).code, 'AUTH_REQUIRED')
  assert.equal((await login('operator')).code, 'LOGIN_FAILED')
  const result = await login('new-operator')
  assert.equal(result.code, 'OK')
  assert.equal(result.data.uid, oldSession.uid)
  assert.equal(result.data.username, 'new-operator')
})

test('PK egg actions are routed and admin cancellation needs an admin session', async () => {
  const g = gateway()
  g.rows.set('uni-id-usersmember', { status: 0, token: ['fixture-token'], role: [] })
  const call = (action, token, payload) => g.main({ action, token, payload })
  assert.equal((await call('chooseEgg', 'fixture-token', { matchId: 'unknown' })).code, 'INVALID_REQUEST')
  assert.equal((await call('pkEggs', 'fixture-token', { matchId: 'unknown' })).code, 'NOT_FOUND')
  assert.equal((await call('cancelPk', 'fixture-token', { matchId: 'unknown' })).code, 'AUTH_REQUIRED')
})

test('community gateway separates guest reads, author previews and reviewer privileges', async () => {
  const g = gateway()
  const { hashPassword } = nativeRequire('./security')
  const password = 'fixture-reviewer-password'
  g.rows.set('fy-admin-usersreviewer', { username: 'reviewer', passwordHash: hashPassword(password), role: ['reviewer'], status: 0 })
  g.rows.set('uni-id-usersmember', { status: 0, token: ['fixture-token'], role: ['admin'] })
  const result = await g.main({ action: 'adminLogin', payload: { username: 'reviewer', password } })
  assert.equal(result.code, 'OK')
  assert.equal(result.data.admin, false)
  const reviewerToken = result.data.token
  const call = (action, token, payload) => g.main({ action, token, payload })
  const pending = await call('communitySubmit', 'fixture-token', { title: 'Fixture', body: 'Pending', requestId: 'submit' })
  assert.equal(pending.code, 'OK')
  const preview = { ...pending.data, preview: true, uid: 'member', admin: true }
  assert.equal((await call('communityPost', '', preview)).code, 'NOT_FOUND')
  assert.equal((await call('communityPost', 'fixture-token', preview)).code, 'OK')
  assert.equal((await call('communityReviewDetail', 'fixture-token', preview)).code, 'AUTH_REQUIRED')
  assert.equal((await call('communityReviewDetail', reviewerToken, preview)).code, 'OK')
  assert.equal((await call('communitySavePolicy', reviewerToken, {})).code, 'FORBIDDEN')
  assert.equal((await call('drafts', reviewerToken, {})).code, 'FORBIDDEN')
  assert.equal((await call('readMedia', reviewerToken, {})).code, 'AUTH_REQUIRED')
  assert.equal((await call('communityReviewPost', reviewerToken, { ...pending.data, decision: 'approve' })).code, 'OK')
  assert.equal((await call('communityPost', '', { postId: pending.data.postId })).data.title, 'Fixture')
})

test('community distinguishes a missing staging collection from an object storage rejection', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='
  const call = (g, payload) => g.main({ action: 'communityStageImage', token: 'fixture-token', payload })
  const album = { requestId: 'request', slot: 'slot', imageSource: 'upload', base64: png }
  const diary = { requestId: 'request', slot: 'slot', imageSource: 'diary', diaryId: 'entry' }
  const account = { status: 0, token: ['fixture-token'], role: [] }
  const uninitialized = gateway({ privateStorageVerified: true, missingCollection: 'fy-community-uploads' })
  uninitialized.rows.set('uni-id-usersmember', account)
  assert.equal((await call(uninitialized, album)).code, 'UPLOAD_STAGING_UNAVAILABLE')
  assert.equal((await call(uninitialized, diary)).code, 'UPLOAD_STAGING_UNAVAILABLE')
  assert.equal(uninitialized.counts().uploads, 0)

  const blocked = gateway({ privateStorageVerified: true, storage: {
    async uploadFile({ cloudPath }) {
      assert.match(cloudPath, /^fy-private\/community\/[a-f0-9]+\.bin$/)
      throw new Error('Storage provider internal detail')
    }
  } })
  blocked.rows.set('uni-id-usersmember', account)
  assert.equal((await call(blocked, album)).code, 'MEDIA_UPLOAD_FAILED')
  assert.equal(blocked.counts().uploads, 1)
  assert.equal([...blocked.rows.keys()].some(key => key.startsWith('fy-community-uploads')), false)
})
