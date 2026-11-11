// Offline preparation for the fy-admin-users collection.
// $env:FY_ADMIN_PASSWORD must be set securely outside shell history.
const fs=require('node:fs')
const {hashPassword}=require('../app/uniCloud-alipay/cloudfunctions/fy-api/security')
const username=process.argv[2], output=process.argv[3]
const password=process.env.FY_ADMIN_PASSWORD
if(!/^[A-Za-z0-9_-]{3,40}$/.test(username??'')||!output||!password?.trim()||password.length<10||password.length>128)throw new Error('Provide username, ignored local output path and FY_ADMIN_PASSWORD (10-128 characters)')
if(!output.replaceAll('\\','/').startsWith('.superpowers/'))throw new Error('Output must be inside ignored .superpowers/')
fs.writeFileSync(output,JSON.stringify({username,passwordHash:hashPassword(password),role:['admin'],status:0,register_date:Date.now()},null,2),{flag:'wx'})
console.log('Prepared local administrator import. No cloud changes.')
