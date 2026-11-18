const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { stripTypeScriptTypes } = require('node:module')

function header(props, pages, navigation) {
  const source = readFileSync(join(__dirname, '../components/AppPageHeader.uvue'), 'utf8')
  const script = source.split('<script setup lang="uts">')[1].split('</script>')[0]
  return new Function('defineProps', 'getCurrentPages', 'uni',
    stripTypeScriptTypes(script) + '\nreturn { goBack }')(() => props, () => pages, navigation)
}

test('header receives delayed mini-program props and can return from My page', () => {
  const props = { title: '', showBack: false }, calls = []
  const component = header(props, [{ route: 'pages/index/index' }, { route: 'packages/profile/account/account' }], {
    navigateBack: options => calls.push(['back', options.delta]),
    reLaunch: options => calls.push(['home', options.url])
  })
  props.title = '我的'; props.showBack = true
  component.goBack()
  assert.deepEqual(calls, [['back', 1]])
  props.showBack = false
  component.goBack()
  assert.equal(calls.length, 1)
})

test('directly opening My page returns to the home page when there is no previous page', () => {
  const calls = []
  const component = header({ title: '我的', showBack: true }, [{ route: 'packages/profile/account/account' }], {
    navigateBack: () => { throw Error('No previous page') },
    reLaunch: options => calls.push(options.url)
  })
  component.goBack()
  assert.deepEqual(calls, ['/pages/index/index'])
})
