const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const entry=path.resolve(__dirname,'../uniCloud-alipay/cloudfunctions/fy-api/index.js')
const nativeRequire=createRequire(entry)
function gateway({configured=true,validCode=true,privateStorageVerified=false}={}) {
 const rows=new Map()
 const db={collection(c){return {doc(id){return {async get(){return {data:rows.has(c+id)?[{...rows.get(c+id),_id:id}]:[]}},async set(v){rows.set(c+id,v)}}},where(q){return {limit(){return {async get(){return {data:[...rows].filter(([k,v])=>k.startsWith(c)&&Object.entries(q).every(([a,b])=>v[a]===b)).map(([,v])=>v)}}}}}}}},async startTransaction(){return {...db,async commit(){},async rollback(){}}}}
 let exchanges=0,uploads=0
 const cloud={database:()=>db,httpclient:{async request(url,opts){exchanges++;assert.equal(url,'https://api.weixin.qq.com/sns/jscode2session');assert.equal(opts.data.js_code,'wx-code');assert.equal(opts.data.secret,'server-fixture-secret');return {data:validCode?{openid:'fixture-openid',session_key:'never-return-this'}:{errcode:40029}}}},async uploadFile(){uploads++;throw new Error('unexpected upload')}}
 const identity={async checkToken(token){return token==='fixture-token'?{uid:'member',errCode:0}:{errCode:'expired'}},async createToken({uid}){return {errCode:0,token:'issued-token',tokenExpired:1000,uid}}}
 const sandbox={exports:{},uniCloud:cloud,Buffer,require(name){if(name==='uni-config-center')return ()=>({config:()=>configured?{wechatAppId:'public-appid',wechatSecret:'server-fixture-secret',environment:'development',privateStorageVerified}:null});if(name==='uni-id-common')return {createInstance:()=>identity};return nativeRequire(name)}}
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),sandbox,{filename:entry})
 return {main:(event)=>sandbox.exports.main(event,{CLIENTIP:'fixture-ip',APPID:'fixture-app'}),rows,counts:()=>({exchanges,uploads})}
}
test('gateway exchanges WeChat code on server and never returns session_key or secret',async()=>{const g=gateway();const r=await g.main({action:'wxLogin',payload:{code:'wx-code'}});assert.equal(r.code,'OK');assert.equal(r.data.token,'issued-token');assert.equal(g.counts().exchanges,1);assert.doesNotMatch(JSON.stringify(r),/never-return|server-fixture|openid/);})
test('gateway rejects invalid code and missing configuration without pretending login',async()=>{assert.equal((await gateway({validCode:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'LOGIN_FAILED');assert.equal((await gateway({configured:false}).main({action:'wxLogin',payload:{code:'wx-code'}})).code,'CONFIG_REQUIRED');})
test('gateway ignores submitted uid/admin and denies ordinary member operations',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});for(const action of ['drafts','saveDraft','publish'])assert.equal((await g.main({action,token:'fixture-token',uid:'administrator',admin:true,payload:{}})).code,'FORBIDDEN');assert.equal((await g.main({action:'diary',token:'expired',uid:'member'})).code,'AUTH_REQUIRED');})
test('unverified private storage blocks all uploads before SDK is called',async()=>{const g=gateway();g.rows.set('uni-id-usersmember',{status:0,token:['fixture-token'],role:[]});assert.equal((await g.main({action:'uploadMedia',token:'fixture-token',payload:{base64:'fixture'}})).code,'CONFIG_REQUIRED');assert.equal(g.counts().uploads,0);})
