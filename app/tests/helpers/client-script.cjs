const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {stripTypeScriptTypes}=require('node:module')
function clientScript(file,globals={}) {
 let source=fs.readFileSync(path.join(__dirname,'../..',file),'utf8');if(file.endsWith('.uvue'))source=source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
 source=source.replace(/^import .+$/gm,'').replace(/export /g,'')
 const watches=[];const context=vm.createContext({ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch:(fn,cb)=>watches.push(cb),nextTick:async()=>{},onShow(){},onLoad(){},process:{env:{NODE_ENV:'test'}},...globals})
 vm.runInContext(stripTypeScriptTypes(source),context)
 return {run:code=>vm.runInContext(code,context),change:()=>watches.forEach(cb=>cb())}
}
module.exports={clientScript}
