const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
test('lost source AppID fails preflight and public config repairs it; tourist output fails verification',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fy-appid-'))
 const script=path.resolve(__dirname,'../../scripts/check-weixin-config.cjs')
 fs.mkdirSync(path.join(root,'app/config'),{recursive:true});fs.mkdirSync(path.join(root,'app/unpackage/dist/dev/mp-weixin'),{recursive:true})
 const appid='wx54dea9a4a48bfed5'
 fs.writeFileSync(path.join(root,'app/config/weixin.json'),JSON.stringify({appid}))
 fs.writeFileSync(path.join(root,'app/manifest.json'),JSON.stringify({'mp-weixin':{appid:null}}))
 const compiled=path.join(root,'app/unpackage/dist/dev/mp-weixin/project.config.json');fs.writeFileSync(compiled,JSON.stringify({appid:'touristappid'}))
 const run=(...args)=>spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'}).status
 assert.notEqual(run(),0);assert.equal(run('--repair'),0);assert.notEqual(run(),0)
 fs.writeFileSync(compiled,JSON.stringify({appid}));assert.equal(run(),0)
 // Keep temp fixture for OS temp cleanup; never recursively delete a computed path.
})
