// Run after every local WeChat compilation. AppID is public; never print SDK keys.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const appid = JSON.parse(fs.readFileSync('app/config/weixin.json')).appid
assert.match(appid, /^wx[0-9a-f]{16}$/)
let source = fs.readFileSync('app/manifest.json', 'utf8')
const pattern = /("mp-weixin"[\s\S]*?"appid"\s*:\s*)(?:"[^"]*"|null)/
assert.ok(pattern.test(source), 'Missing mp-weixin AppID field')
if (process.argv.includes('--repair')) {
  source = source.replace(pattern, '$1' + JSON.stringify(appid))
  fs.writeFileSync('app/manifest.json', source)
  console.log('Restored source AppID from public app/config/weixin.json')
  process.exit(0)
}
assert.equal(source.match(pattern)[0].match(/(?:"[^"]*"|null)$/)[0], JSON.stringify(appid), 'Source AppID drifted; run with --repair')
for (const mode of process.argv.includes('--release') ? ['build'] : ['dev']) {
  const file = `app/unpackage/dist/${mode}/mp-weixin/project.config.json`
  assert.equal(JSON.parse(fs.readFileSync(file)).appid, appid, 'Recompile with the source WeChat AppID')
}
console.log('Source and compiled WeChat AppID agree')
