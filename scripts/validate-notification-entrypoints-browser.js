// Serve the current desktop app Web build on 127.0.0.1:8421. All cloud calls are fixtures.
async (page) => {
 await page.route('**/assets/*.js', async route => {
  const response = await route.fetch()
  const body = (await response.text()).replace(/\b\w+\.callFunction\(\{name:/g, 'window.__mockCloud({name:')
  await route.fulfill({ response, body })
 })
 await page.addInitScript(() => {
  window.__unread = 1
  window.__calls = []
  window.__mockCloud = async ({ data }) => {
   window.__calls.push(data.action)
   const value = data.action === 'catalog' ? [] : data.action === 'notificationsSummary' ? { unread: window.__unread } : {}
   return { result: { code: 'OK', data: value } }
  }
 })
 await page.setViewportSize({ width: 390, height: 844 })
 await page.clock.install()
 const apiResponse = page.waitForResponse(/\/assets\/api\.[^/]+\.js$/)
 await page.goto('http://127.0.0.1:8421/#/pages/index/index')
 await page.getByText('非遗云享', { exact: true }).waitFor()
 const badge = page.locator('.home-message-dot')
 if (await badge.count()) throw Error('Guest sees an unread badge')
 await page.evaluate(async url => {
  const api = await import(url)
  window.__memberSession = api.s
  api.s.value = { uid: 'local-B', token: 'local-only', expiresAt: Date.now() + 3600000 }
 }, (await apiResponse).url())
 await badge.waitFor({ state: 'visible' })
 await page.screenshot({ path: '.superpowers/home-unread-browser.png', fullPage: true })
 await page.evaluate(() => { window.__unread = 0 })
 await page.clock.fastForward(30000)
 await badge.waitFor({ state: 'hidden' })
 await page.evaluate(() => { window.__memberSession.value = null })
 if (await badge.count()) throw Error('Signed-out account retains unread badge')
 console.log('Home guest/member badge, 30-second refresh and sign-out isolation verified with local fixtures')
}
