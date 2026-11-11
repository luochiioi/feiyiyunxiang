const crypto=require('node:crypto')
function encrypt(bytes,key) { const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv); const payload=Buffer.concat([c.update(bytes),c.final()]);return Buffer.concat([iv,c.getAuthTag(),payload]) }
function decrypt(bytes,key) {const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()])}
function decodeImage(base64) {
  if(typeof base64!=='string'||base64.length>1400000||!base64.length||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('INVALID_IMAGE')
  const bytes=Buffer.from(base64,'base64')
  if(bytes.length>1024*1024||bytes.length<16) throw new Error('INVALID_IMAGE')
  let mime
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255]))&&bytes.subarray(-2).equals(Buffer.from([255,217]))) mime='image/jpeg'
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(-8,-4).toString()==='IEND') mime='image/png'
  if(!mime) throw new Error('INVALID_IMAGE')
  return {bytes,mime}
}
function hashPassword(password) {const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(password,salt,64).toString('hex')}
function verifyPassword(password,hash) {if(typeof password!=='string'||password.length>256||typeof hash!=='string')return false;const [salt,digest]=hash.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(digest))return false;return crypto.timingSafeEqual(crypto.scryptSync(password,salt,64),Buffer.from(digest,'hex'))}
async function authenticate(identity,token,getUser) {
  if(typeof token!=='string'||token.length>8192) throw new Error('AUTH_REQUIRED')
  let result
  try { result=await identity.checkToken(token,{autoRefresh:false}) }catch {throw new Error('AUTH_REQUIRED')}
  if(result.errCode||!result.uid) throw new Error('AUTH_REQUIRED')
  const user=await getUser(result.uid)
  if(!user||user.status!==0||!user.token?.includes(token))throw new Error('AUTH_REQUIRED')
  return {uid:result.uid,admin:Array.isArray(user.role)&&user.role.includes('admin')}
}
module.exports={encrypt,decrypt,decodeImage,hashPassword,verifyPassword,authenticate}
