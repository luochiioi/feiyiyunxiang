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
    function testAvatar(background, accent, width = 96) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = 96
      const context = canvas.getContext('2d')
      context.fillStyle = background
      context.fillRect(0, 0, width, 96)
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
    const nativeInputClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return nativeInputClick.call(this)
      const landscape = testAvatar('#745176', '#fbd5a4', 144)
      const fixtureFile = Uint8Array.from(atob(landscape.split(',')[1]), char => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([fixtureFile], 'test-avatar.png', { type: 'image/png' }))
      this.files = transfer.files
      queueMicrotask(() => this.dispatchEvent(new Event('change', { bubbles: true })))
    }
    const candidate = { ...rejected, revisionId: 'admin-case', nickname: '申请审核昵称', status: 'pending', hasAvatar: true, reason: '', createdAt: Date.now() }
    window.__profileFixture = { name, read: false, pending: null, failAvatar: true, lost: true, writes: [], uploads: [], avatarContents: [],
      adminDecision: '', failQueue: false, failSelected: true, adminWrites: 0 }
    window.__mockCloud = async ({ data }) => {
      const { action, token, payload = {} } = data, fixture = window.__profileFixture
      const ok = value => ({ result: { code: 'OK', data: value } })
      const fail = result => ({ result: { code: result, data: null } })
      switch (action) {
        case 'catalog': return ok([])
        case 'adminLogin': return ok({ uid: 'local-reviewer', username: '模拟审核员', token: 'local-admin', expiresAt: Date.now() + 3600000, admin: true })
        case 'communityOverview': return ok({ pendingPosts: 0, pendingComments: 0, openReports: 0, publishedPosts: 0 })
        case 'communityReviewList': return ok({ items: [], next: '' })
        case 'drafts': return ok([])
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
        case 'profileStageAvatar':
          if (typeof payload.base64 !== 'string' || !payload.base64.startsWith('iVBOR')) return fail('INVALID_IMAGE')
          const header = Uint8Array.from(atob(payload.base64.slice(0, 32)), char => char.charCodeAt(0))
          const dimensions = new DataView(header.buffer)
          if (dimensions.getUint32(16) !== 256 || dimensions.getUint32(20) !== 256) return fail('INVALID_IMAGE')
          fixture.uploads.push(payload.requestId)
          fixture.avatarContents.push(payload.base64)
          if (fixture.uploads.length === 1) return fail('SERVICE_UNAVAILABLE')
          return ok({ uploadId: 'fixture-avatar' })
        case 'profileSubmit':
          if (payload.avatarUploadId !== 'fixture-avatar') return fail('INVALID_REQUEST')
          fixture.writes.push(payload.requestId)
          fixture.pending = { ...payload, revisionId: 'pending-revision', hasAvatar: true, status: 'pending', reason: '' }
          if (fixture.lost) { fixture.lost = false; throw Error('RESPONSE_LOST') }
          return ok({ revisionId: 'pending-revision', status: 'pending' })
        case 'profileRevision':
          if (token !== 'local-profile') return fail('NOT_FOUND')
          if (payload.avatar && payload.revisionId === 'pending-revision') return ok({ src: proposedPng })
          return payload.revisionId === 'older' ? ok(rejected) : fail('NOT_FOUND')
        case 'notificationsSummary': return ok({ unread: fixture.read ? 0 : 1 })
        case 'notificationsList': return ok({ items: [{ ...item, read: fixture.read }], next: '' })
        case 'notificationDetail': return ok({ ...item, read: fixture.read, reason: rejected.reason, target: null, profileTarget: { revisionId: 'older' } })
        case 'notificationRead': fixture.read = true; return ok({})
        case 'communityReviewNotices': return ok({ unread: 1 })
        case 'communityFeed': return ok({ items: payload.tab === 'mine' ? [{ ...post, title: '我的测试帖子', owner: true }] : [post], next: '' })
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
  await visible('选择头像').click()
  await visible('左右移动').waitFor()
  await screenshot('avatar-crop')
  await visible('使用此裁剪').click()
  await visible('裁剪头像').waitFor({ state: 'hidden' })
  await visible('提交审核').click()
  await visible('头像上传未收到确认，草稿已保留。可重试，或使用默认澳喵后提交。').waitFor()
  await visible('提交审核').click()
  await visible('提交审核未收到确认，草稿已保留。可重试同一次提交。').waitFor()
  await visible('提交审核').click()
  await visible('资料已提交审核。').waitFor()
  await visible('新资料仅自己可见，审核通过后会公开。').waitFor()
  const name = await page.evaluate(() => window.__profileFixture.name)
  await visible(name).waitFor()
  const { writes, uploads, avatarContents } = await page.evaluate(() => window.__profileFixture)
  if (uploads.length !== 2 || uploads[0] !== uploads[1]) throw Error('Avatar retry changed its staging request')
  if (avatarContents[0] !== avatarContents[1]) throw Error('Avatar retry changed the crop')
  if (writes.length !== 2 || writes[0] !== writes[1]) throw Error('Uncertain write was not replayed')
  await screenshot('pending')
  await back()
  await visible('申请测试昵称').waitFor()
  await visible('待审核 · 仅自己可见').waitFor()
  await page.locator('.pending-avatar img[src^="data:image/"]').waitFor()
  await screenshot('owner-preview')
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
  if (await visible('社区').count()) throw Error('My duplicates community entry')
  await visible('我的帖子').click()
  await visible('我的测试帖子').waitFor()
  if (await visible('今日好友步数榜').count() || await visible('好友排行').count()) throw Error('Personal feed leaks community controls')
  await back()
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
  await go('/packages/community/community/community')
  await visible('测试帖子').click()
  await visible('测试评论').waitFor()
  if (await visible('申请测试昵称').count()) throw Error('Pending nickname appeared on public content')
  await approvedAvatar(page.locator('.post-card')).waitFor()
  await page.getByText(name, { exact: true }).last().waitFor()
  await back()
  await visible('好友排行').click()
  await page.getByText('1. ' + name + '（我）', { exact: true }).waitFor()
  await visible('查看好友步数榜').waitFor()
  if (await visible('今日好友步数榜').count()) throw Error('Community duplicates the steps screen')
  await approvedAvatar(page).waitFor()
  await page.goto(adminOrigin + '/')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('textbox').nth(0).fill('local-reviewer')
  await page.getByRole('textbox').nth(1).fill('fixture-password')
  await visible('登录工作台').click()
  await visible('账号设置').click()
  await visible('修改管理员登录信息').waitFor()
  await visible('路线与博物馆').click()
  await visible('新建开发测试路线').waitFor()
  if (await visible('修改管理员登录信息').count()) throw Error('Account settings remain mixed with routes')
  await visible('社区审核与治理').click()
  await visible('举报').click()
  await page.locator('.tabs').getByText('已处理', { exact: true }).waitFor()
  if (await page.locator('.tabs').getByText('待审帖子', { exact: true }).count()) throw Error('Unrelated review tabs are visible')
  await visible('资料待审').click()
  await page.locator('.queue-item').filter({ hasText: '申请审核昵称' }).click()
  await visible('当前公开资料').waitFor()
  await visible('重试申请头像').click()
  await visible('重试申请头像').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelectorAll('.comparison img[src^="data:image/"]').length === 2)
  await screenshot('admin-review')
  await page.setViewportSize({ width: 768, height: 900 })
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Admin review overflows at tablet width')
  await page.setViewportSize({ width: 1440, height: 1000 })
  if (await page.locator('textarea').count()) throw Error('Rejection reason shows before the reviewer chooses to reject')
  await visible('驳回…').click()
  await visible('取消').click()
  if (await page.locator('textarea').count()) throw Error('Cancelled rejection kept the reason field')
  await visible('驳回…').click()
  await page.locator('textarea').fill('请修改简介')
  await visible('确认驳回').click()
  await visible('资料已驳回。 队列刷新失败，可单独刷新。').waitFor()
  await visible('刷新队列').click()
  await visible('当前没有待审资料。').waitFor()
  if (await page.evaluate(() => window.__profileFixture.adminWrites) !== 1) throw Error('Queue refresh repeated a review')
  await visible('退出登录').waitFor()
  if (uncaught.length > 0) throw Error(uncaught.join('; '))
  return 'Verified 256px crop, exact avatar retry, owner-only preview, steps navigation, mobile layouts, and grouped Admin review'
}
