// Playwright CLI run-code --filename scripts/validate-profile-browser.js
// Serve the app and Admin Web builds on 127.0.0.1:8431 and :8432. Every API reply is a local fixture.
async (page) => {
  const origin = 'http://127.0.0.1:8431'
  const adminOrigin = 'http://127.0.0.1:8432'
  const uncaught = []
  page.on('pageerror', error => uncaught.push(error.message))
  await page.route('**/*', route => [origin, adminOrigin].some(local => route.request().url().startsWith(local)) ? route.fallback() : route.abort())
  await page.route('**/assets/*.js', async route => {
    const response = await route.fetch()
    const body = (await response.text()).replace(/\b\w+\.callFunction\(\{name:/g, 'window.__mockCloud({name:')
    await route.fulfill({ response, body })
  })
  await page.addInitScript(() => {
    const code = 'ABCD2345', avatarVersion = 'a'.repeat(64)
    const name = '澳門湖南傳統工藝探索隊湘繡傳承二〇二六'
    const approved = { code, nickname: name, avatarVersion, displayCity: '澳門', bio: '探索非遗文化', interests: ['瓷器', '摄影'], revision: 1 }
    const rejected = { revisionId: 'older', nickname: '退回的昵称', displayCity: '', interests: [], bio: '', reason: '请修改简介', status: 'rejected', hasAvatar: false }
    const item = { id: 'review-message', kind: 'profile.rejected', title: '资料审核未通过', preview: rejected.reason, createdAt: Date.now() }
    const post = { id: 'post', revisionId: 'post-version', latestRevision: 'post-version', title: '测试帖子', body: '帖子详情正文', author: name, authorCode: code,
      authorAvatarVersion: avatarVersion, owner: false, publicView: true, status: 'approved', hasImage: false, imageCount: 0, commentCount: 1, likeCount: 0 }
    const rank = { ...approved, mine: true, rank: 1, count: 3, steps: 7234 }
    function testAvatar(background, accent) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 96
      const context = canvas.getContext('2d')
      context.fillStyle = background
      context.fillRect(0, 0, 96, 96)
      context.fillStyle = accent
      context.beginPath()
      context.moveTo(2, 96)
      context.lineTo(44, 28)
      context.lineTo(96, 96)
      context.fill()
      context.beginPath()
      context.arc(71, 25, 9, 0, 2 * Math.PI)
      context.fill()
      return canvas.toDataURL('image/png')
    }
    const png = testAvatar('#60937f', '#fff0ce'), proposedPng = testAvatar('#745176', '#fbd5a4')
    const candidate = { ...rejected, revisionId: 'admin-case', nickname: '申请审核昵称', status: 'pending', hasAvatar: true, reason: '', createdAt: Date.now() }
    window.__profileFixture = { name, read: false, pending: null, failAvatar: true, lost: true, writes: [],
      adminDecision: '', failQueue: false, failSelected: true, adminWrites: 0 }
    window.__mockCloud = async ({ data }) => {
      const { action, token, payload = {} } = data, fixture = window.__profileFixture
      const ok = value => ({ result: { code: 'OK', data: value } })
      const fail = result => ({ result: { code: result, data: null } })
      switch (action) {
        case 'catalog': return ok([])
        case 'adminLogin': return ok({ uid: 'local-reviewer', username: '模拟审核员', token: 'local-admin', expiresAt: Date.now() + 3600000, admin: false })
        case 'communityOverview': return ok({ pendingPosts: 0, pendingComments: 0, openReports: 0, publishedPosts: 0 })
        case 'communityReviewList': return ok({ items: [], next: '' })
        case 'profileReviewList':
          if (fixture.failQueue) { fixture.failQueue = false; throw Error('QUEUE_READ_FAILED') }
          return ok({ items: fixture.adminDecision ? [] : [candidate], next: '' })
        case 'profileReviewDetail': return ok({ current: approved, selected: candidate, accountActive: true })
        case 'profileReviewAvatar':
          if (!payload.current && fixture.failSelected) { fixture.failSelected = false; return fail('PHOTO_UNAVAILABLE') }
          return ok({ src: payload.current ? png : proposedPng })
        case 'profileReview':
          fixture.adminWrites++
          fixture.adminDecision = payload.decision
          fixture.failQueue = true
          return ok({ status: 'rejected' })
        case 'getMyProfile': return ok({ ...approved, pending: fixture.pending, latest: rejected })
        case 'aomiaoStatus': return ok({ claimed: true })
        case 'profileAvatar':
          if (fixture.failAvatar) { fixture.failAvatar = false; return fail('PHOTO_UNAVAILABLE') }
          return ok({ src: png })
        case 'profileSubmit':
          fixture.writes.push(payload.requestId)
          fixture.pending = { ...payload, revisionId: 'pending-revision', hasAvatar: false, status: 'pending', reason: '' }
          if (fixture.lost) { fixture.lost = false; throw Error('RESPONSE_LOST') }
          return ok({ revisionId: 'pending-revision', status: 'pending' })
        case 'profileRevision': return payload.revisionId === 'older' && token === 'local-profile' ? ok(rejected) : fail('NOT_FOUND')
        case 'notificationsSummary': return ok({ unread: fixture.read ? 0 : 1 })
        case 'notificationsList': return ok({ items: [{ ...item, read: fixture.read }], next: '' })
        case 'notificationDetail': return ok({ ...item, read: fixture.read, reason: rejected.reason, target: null, profileTarget: { revisionId: 'older' } })
        case 'notificationRead': fixture.read = true; return ok({})
        case 'communityReviewNotices': return ok({ unread: 1 })
        case 'communityFeed': return ok({ items: [post], next: '' })
        case 'communityPost': return ok(post)
        case 'communityComments': return ok({ items: [{ id: 'comment', parentId: '', author: name, authorCode: code, authorAvatarVersion: avatarVersion, body: '测试评论', status: 'public' }], next: '', mine: [] })
        case 'communityRanking': return ok([rank])
        case 'stepStatus': return ok({ steps: 7234, milestones: [], date: '2026-11-23', dailyCap: 100000, nextMilestone: 10000 })
        case 'stepRanking': return ok({ rows: [rank], date: '2026-11-23' })
        case 'stepHistory': return ok({ days: [] })
        case 'ensureProfile': return ok(approved)
        case 'friends': return ok([{ ...approved, kind: 'incoming', id: 'friend-request' }, { ...approved }])
        case 'assignment': return ok(null)
        case 'explorationArchive': return ok([])
        case 'logout': return ok({})
        default: return ok({})
      }
    }
  })
  page.setDefaultTimeout(10000)
  const go = route => page.goto(origin + '/#' + route)
  const visible = label => page.getByText(label, { exact: true }).last()
  const screenshot = name => page.screenshot({ path: 'docs/validation/evidence/profile-and-my-page/' + name + '.png', fullPage: true })
  const approvedAvatar = scope => scope.locator('.profile-avatar img[src^="data:image/"]').first()
  const back = () => page.locator('.app-page-header-return:visible').click()
  const account = '/packages/profile/account/account'
  await page.setViewportSize({ width: 390, height: 844 })
  await go(account)
  await visible('微信登录').waitFor()
  if (await visible('编辑资料').count()) throw Error('Guest can edit profile')
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find(value => /\/api\.[^/]+\.js/.test(value.name))
    const api = await import(entry.name)
    api.s.value = { uid: 'local-A', token: 'local-profile', expiresAt: Date.now() + 3600000 }
  })
  await go('/packages/profile/messages/messages')
  await go(account)
  await visible('邀请码 ABCD2345').waitFor()
  await page.getByLabel('重试头像').click()
  await approvedAvatar(page).waitFor()
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect()
      const name = box('.nickname'), code = box('.invite-code'), copy = box('.code-row uni-button')
      return { valid: name.right <= innerWidth && code.right < copy.left && copy.right <= innerWidth, scroll: document.documentElement.scrollWidth }
    })
    if (!layout.valid || layout.scroll > width) throw Error('Nickname or code overflows at width ' + width)
    await screenshot('account-' + width)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await visible('编辑资料').click()
  await visible('提交新资料').waitFor()
  await page.locator('input').first().fill('申请测试昵称')
  await visible('使用默认澳喵').click()
  await visible('提交审核').click()
  await visible('未收到服务确认，请检查网络后重试。').waitFor()
  await visible('提交审核').click()
  await visible('资料已提交审核。').waitFor()
  await visible('审核期间继续展示当前公开资料。').waitFor()
  const name = await page.evaluate(() => window.__profileFixture.name)
  await visible(name).waitFor()
  const writes = await page.evaluate(() => window.__profileFixture.writes)
  if (writes.length !== 2 || writes[0] !== writes[1]) throw Error('Uncertain write was not replayed')
  await screenshot('pending')
  await back()
  await page.locator('.review-dot[aria-label="有未读消息"]').waitFor()
  await visible('消息').click()
  await visible('资料审核未通过').click()
  await visible('查看资料审核结果').click()
  await visible('以此修改').waitFor()
  if (await visible('提交审核').count()) throw Error('Historical revision was editable before confirmation')
  await screenshot('rejected')
  await visible('以此修改').click()
  await visible('提交审核').waitFor()
  if (await page.locator('input').first().inputValue() !== '退回的昵称') throw Error('Historical revision was not copied')
  await back()
  await visible('查看资料审核结果').waitFor()
  await back()
  await visible('资料审核未通过').waitFor()
  await back()
  await visible('步数中心').waitFor()
  if (await page.locator('.review-dot[aria-label="有未读消息"]').count()) throw Error('Read badge did not clear')
  await visible('探索档案').click()
  await page.waitForURL('**/packages/profile/my-checkins/my-checkins')
  await back()
  await visible('步数中心').click()
  await visible('今日好友步数榜').waitFor()
  await page.getByText(name, { exact: false }).first().waitFor()
  await approvedAvatar(page).waitFor()
  await back()
  await visible('旅伴').click()
  await page.getByText(name + ' 请求加为好友', { exact: true }).waitFor()
  await visible(name).waitFor()
  await approvedAvatar(page).waitFor()
  await back()
  await visible('社区').click()
  await visible('测试帖子').click()
  await visible('测试评论').waitFor()
  await approvedAvatar(page.locator('.post-card')).waitFor()
  await page.getByText(name, { exact: true }).last().waitFor()
  await back()
  await visible('好友排行').click()
  await page.getByText('1. ' + name + '（我）', { exact: true }).waitFor()
  await approvedAvatar(page).waitFor()
  await page.goto(adminOrigin + '/')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('textbox').nth(0).fill('local-reviewer')
  await page.getByRole('textbox').nth(1).fill('fixture-password')
  await visible('登录工作台').click()
  await visible('社区审核与治理').click()
  await visible('资料待审').click()
  await visible('查看资料').click()
  await visible('当前公开资料').waitFor()
  await visible('重试申请头像').click()
  await visible('重试申请头像').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelectorAll('.comparison img[src^="data:image/"]').length === 2)
  await screenshot('admin-review')
  await page.locator('textarea').fill('请修改简介')
  await visible('驳回资料').click()
  await visible('资料已驳回。 队列刷新失败，可单独刷新。').waitFor()
  await visible('刷新队列').click()
  await visible('当前没有待审资料。').waitFor()
  if (await page.evaluate(() => window.__profileFixture.adminWrites) !== 1) throw Error('Queue refresh repeated a review')
  await visible('退出登录').waitFor()
  if (uncaught.length > 0) throw Error(uncaught.join('; '))
  return 'Verified 375/390/430 layout, avatar retry, pending and rejected history, notifications, current attribution, and Admin review and read retry'
}
