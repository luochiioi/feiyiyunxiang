const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const entry=path.resolve(__dirname,'../uniCloud-alipay/cloudfunctions/fy-api/index.js')
const nativeRequire=createRequire(entry)
function gateway({configured=true,validCode=true,privateStorageVerified=false}={}) {
 const rows=new Map()
 const db={collection(c){return {doc(id){return {async get(){return {data:rows.has(c+id)?[{...rows.get(c+id),_id:id}]:[]}},async set(v){rows.set(c+id,v)}}},where(q){return {limit(){return {async get(){return {data:[...rows].filter(([k,v])=>k.startsWith(c)&&Object.entries(q).every(([a,b])=>v[a]===b)).map(([k,v])=>({...v,_id:k.slice(c.length)}))}}}}}}}},async startTransaction(){return {...db,async commit(){},async rollback(){}}}}
 let exchanges=0,uploads=0
 const cloud={database:()=>db,httpclient:{async request(url,opts){exchanges++;assert.equal(url,'https://api.weixin.qq.com/sns/jscode2session');assert.equal(opts.data.js_code,'wx-code');assert.equal(opts.data.secret,'server-fixture-secret');return {data:validCode?{openid:'fixture-openid',session_key:'never-return-this'}:{errcode:40029}}}},async uploadFile(){uploads++;throw new Error('unexpected upload')}}
 const identity={async checkToken(token){return token==='fixture-token'?{uid:'member',errCode:0}:{errCode:'expired'}},async createToken({uid}){return {errCode:0,token:'issued-token',tokenExpired:1000,uid}}}
 const sandbox={exports:{},uniCloud:cloud,Buffer,__dirname:path.dirname(entry),require(name){if(name==='uni-config-center')return ()=>({config:()=>configured?{wechatAppId:'public-appid',wechatSecret:'server-fixture-secret',identity:{tokenSecret:'fixture-token-secret'},environment:'development',privateStorageVerified}:null});if(name==='uni-id-common')return {createInstance:()=>identity};return nativeRequire(name)}}
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),sandbox,{filename:entry})
 return {main:(event)=>sandbox.exports.main(event,{CLIENTIP:'fixture-ip',APPID:'fixture-app'}),rows,counts:()=>({exchanges,uploads})}
}
test('gateway exchanges WeChat code on server and never returns session_key or secret',async()=>{const g=gateway();const r=await g.main({action:'wxLogin',payload:{code:'wx-code'}});assert.equal(r.code,'OK');assert.equal(r.data.token,'issued-token');assert.equal(g.counts().exchanges,1);assert.doesNotMatch(JSON.stringify(r),/never-return|server-fixture|openid/);})
test('gateway rejects invalid code and missing configuration without pretending login',async()=>{assert.equal((await gateway({validCode:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'LOGIN_FAILED');assert.equal((await gateway({configured:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'CONFIG_REQUIRED');})
test('gateway ignores submitted uid/admin and denies ordinary member operations',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});for(const action of ['drafts','saveDraft','publish'])assert.equal((await g.main({action,token:'fixture-token',uid:'administrator',admin:true,payload:{}})).code,'AUTH_REQUIRED');assert.equal((await g.main({action:'diary',token:'expired',uid:'member'})).code,'AUTH_REQUIRED');})
test('unverified private storage blocks all uploads before SDK is called',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});assert.equal((await g.main({action:'uploadMedia',token:'fixture-token',payload:{base64:'fixture'}})).code,'CONFIG_REQUIRED');assert.equal(g.counts().uploads,0);})

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
