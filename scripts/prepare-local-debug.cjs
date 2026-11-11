const fs=require('node:fs')
for(const project of ['app','admin']) {
  fs.mkdirSync(project+'/.hbuilderx',{recursive:true})
  const file=project+'/.hbuilderx/launch.json'
  if(!fs.existsSync(file)) fs.writeFileSync(file,JSON.stringify({version:'0.0.1',configurations:[{type:'uniCloud',default:{launchtype:'local'},systemLog:false}]},null,2))
}
console.log('Prepared ignored local-cloud debug settings; system request/response logging disabled')
