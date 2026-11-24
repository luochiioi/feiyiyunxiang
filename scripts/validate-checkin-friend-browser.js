// Run with Playwright CLI run-code --filename scripts/validate-checkin-friend-browser.js.
// Serve the App Web build at 127.0.0.1:8431. All API responses are local fixtures.
async page => {
  const origin = 'http://127.0.0.1:8431'
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.fallback() : route.abort())
  await page.route('**/assets/*.js', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace(/\b\w+\.callFunction\(\{name:/g, 'window.__mockCloud({name:') })
  })
  await page.addInitScript(() => {
    const date = Date.now(), src = '/packages/routes/static/silk-cover.jpg'
    const entry = { _id: 'photo', title: '观察外销瓷', museumName: '澳门博物馆', kind: 'indoor', createdAt: date, note: '观察纹样', mediaId: 'private-image' }
    const noPhoto = { _id: 'plain', title: '馆外签到', kind: 'outdoor', createdAt: date - 3600000, note: '', mediaId: '' }
    const rows = [entry, noPhoto, ...Array.from({ length: 22 }, (_, i) => ({
      ...entry, _id: 'older-' + i, title: '旧打卡 ' + i, createdAt: date - (i + 2) * 86400000, mediaId: ''
    }))]
    const post = { id: 'public-post', revisionId: 'approved', title: '示例帖子', body: '这里是公开正文', author: '朋友',
      status: 'approved', hasImage: true, imageCount: 1, owner: false, publicView: true, latestRevision: '', commentCount: 0, likeCount: 0 }
    const postPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII='
    const notification = { id: 'shared-1', kind: 'community.post.shared', title: '好友分享了帖子', preview: '分享旅伴', createdAt: date }
    window.__fixture = { sent: false, read: false, hidden: false, mediaReads: 0, imageReads: 0, feedTabs: [], sends: 0,
      liked: false, saved: false, comment: '', shareAttempts: 0 }
    window.__mockCloud = async ({ data: { action, payload = {}, token } }) => {
      const state = window.__fixture
      const ok = data => ({ result: { code: 'OK', data } })
      const notFound = () => ({ result: { code: 'NOT_FOUND', data: null } })
      switch (action) {
        case 'explorationArchive': return ok(rows)
        case 'explorationArchiveDetail': { const item = rows.find(row => row._id === payload.id); return item ? ok(item) : notFound() }
        case 'readMedia': state.mediaReads++; return ok({ src })
        case 'communityFeed': state.feedTabs.push(payload.tab); return ok({ items: [post], next: '' })
        case 'communityImage':
          if (payload.postId !== post.id || payload.revisionId !== post.revisionId || payload.preview !== false || payload.index !== 0) return notFound()
          state.imageReads++
          return ok({ src: postPhoto })
        case 'communityPost': return state.hidden ? notFound() : ok({
          ...post, owner: token === 'sender', latestRevision: token === 'sender' ? post.revisionId : '',
          liked: state.liked, saved: state.saved, likeCount: Number(state.liked)
        })
        case 'communityReaction':
          if (payload.kind === 'like') state.liked = payload.active
          if (payload.kind === 'favorite') state.saved = payload.active
          return ok({})
        case 'communityComment':
          state.comment = payload.body
          return ok({ status: 'pending' })
        case 'communityComments': return ok({ items: [], mine: [], next: '' })
        case 'friends': return ok([{ code: 'FRIEND23', nickname: '已添加好友' }, { code: 'PEND2345', nickname: '待同意好友', kind: 'incoming' }])
        case 'communityShareToFriend':
          if (token !== 'sender' || payload.code !== 'FRIEND23' || payload.postId !== post.id) return notFound()
          if (state.shareAttempts++ === 0) return notFound()
          state.sends++
          if (state.sent) return ok({ alreadyShared: true })
          state.sent = true
          return ok({ alreadyShared: false })
        case 'notificationsSummary': return ok({ unread: Number(state.sent && token === 'receiver' && !state.read) })
        case 'notificationsList': return ok({ items: state.sent && token === 'receiver' ? [{ ...notification, read: state.read }] : [], next: '' })
        case 'notificationDetail':
          return state.sent && token === 'receiver' ? ok({ ...notification, read: state.read, reason: '',
            sharedTitle: state.hidden ? '' : post.title,
            target: state.hidden ? null : { postId: post.id, revisionId: post.revisionId, commentId: '', preview: false } }) : notFound()
        case 'notificationRead': state.read = true; return ok({})
        case 'catalog': return ok([])
        default: return ok({})
      }
    }
  })
  page.setDefaultTimeout(10000)
  await page.setViewportSize({ width: 390, height: 844 })
  const go = route => page.goto(origin + '/#' + route)
  const text = label => page.getByText(label, { exact: true }).last()
  const back = () => page.locator('.app-page-header-return:visible').click()
  const user = uid => page.evaluate(async id => {
    const url = performance.getEntriesByType('resource').find(entry => /\/api\.[^/]+\.js/.test(entry.name)).name
    const api = await import(url)
    api.s.value = { uid: id, token: id, expiresAt: Date.now() + 3600000 }
  }, uid)
  await go('/packages/profile/my-checkins/my-checkins')
  await text('微信登录并查看').waitFor()
  await user('sender')
  await text('观察外销瓷').waitFor()
  if (await page.evaluate(() => window.__fixture.mediaReads)) throw Error('Archive fetched a private photo before opening a detail')
  await text('馆外').click()
  await page.locator('.entry').filter({ hasText: '馆外签到' }).click()
  await text('打卡详情').waitFor()
  await text('馆外签到').waitFor()
  if (await text('用这张图发帖').count() || await page.locator('.photo').count()) throw Error('No-photo record displayed a photo action')
  await back()
  await text('馆外签到').waitFor()
  if (await text('观察外销瓷').count()) throw Error('Archive filter did not survive back navigation')
  await text('全部').click()
  await page.locator('.entry').filter({ hasText: '观察外销瓷' }).click()
  await text('用这张图发帖').waitFor()
  if (await page.evaluate(() => window.__fixture.mediaReads) !== 1) throw Error('Private photo was not loaded once on detail')
  await back()
  await text('旧打卡 21').scrollIntoViewIfNeeded?.()
  await page.locator('.entry').filter({ hasText: '旧打卡 21' }).click()
  await text('打卡详情').waitFor()
  await back()
  const listPosition = await text('旧打卡 21').evaluate(element => {
    const box = element.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= innerHeight
  })
  if (!listPosition) throw Error('Archive lost its previous scroll position')
  const postPath = '/packages/community/community-post/community-post?postId=public-post'
  await go('/packages/community/community/community')
  const waitForPhoto = () => page.waitForFunction(() => [...document.querySelectorAll('.gallery img')]
    .some(photo => photo.clientWidth > 0 && photo.naturalWidth > 0))
  await waitForPhoto()
  await text('好友').click()
  await page.waitForFunction(() => window.__fixture.feedTabs.includes('friends'))
  await waitForPhoto()
  await page.locator('.post-card:visible').filter({ hasText: '示例帖子' }).click()
  await page.waitForURL('**' + postPath)
  await waitForPhoto()
  if ((await page.evaluate(() => window.__fixture.imageReads)) !== 1) throw Error('Switching feeds or opening post details fetched the same photograph again')
  await page.locator('.author-actions').getByText('已通过', { exact: true }).waitFor()
  await page.locator('.author-actions').getByLabel('撤下帖子').waitFor()
  if (await text('编辑最新版本').count() || await page.locator('.comment-input').count()) throw Error('Post detail still exposes edit or an oversized idle composer')
  for (const label of ['点赞', '收藏', '查看评论']) {
    const image = page.getByLabel(label, { exact: true }).locator('img')
    await image.waitFor()
    await page.waitForFunction(label => document.querySelector('uni-button[aria-label="' + label + '"] img')?.naturalWidth > 0, label)
  }
  await page.getByLabel('点赞', { exact: true }).click()
  await page.getByLabel('取消点赞', { exact: true }).waitFor()
  await page.getByLabel('收藏', { exact: true }).click()
  await page.getByLabel('取消收藏', { exact: true }).waitFor()
  await text('写评论…').click()
  await page.locator('.comment-input textarea').fill('评论验收')
  await text('收起').click()
  await text('继续写评论…').click()
  if (await page.locator('.comment-input textarea').inputValue() !== '评论验收') throw Error('Closing the comment composer discarded the draft')
  await text('发送').click()
  await text('评论已提交审核。').waitFor()
  if ((await page.evaluate(() => window.__fixture.comment)) !== '评论验收') throw Error('Comment payload was lost')
  await page.getByLabel('分享与更多操作').click()
  await text('分享给好友').click()
  await text('已添加好友').waitFor()
  if (await text('待同意好友').count()) throw Error('Pending friends appeared in the picker')
  await page.locator('.choice').filter({ hasText: '已添加好友' }).click()
  await text('发送给好友').click()
  await text('分享服务未能确认发送，请刷新帖子后重试。').waitFor()
  await text('发送给好友').click()
  await text('已发送给好友').waitFor()
  await user('receiver')
  await go('/packages/profile/messages/messages')
  await text('好友分享了帖子').click()
  await text('查看帖子').click()
  await text('这里是公开正文').waitFor()
  const { read, sends } = await page.evaluate(() => window.__fixture)
  if (!read || sends !== 1) throw Error('Friend message read or send count did not match')
  await page.evaluate(() => { window.__fixture.hidden = true })
  await go('/packages/profile/message-detail/message-detail?id=shared-1')
  await text('这条帖子当前不可查看。').waitFor()
  if (await text('查看帖子').count()) throw Error('An unavailable post still had a link')
  return 'Verified archive, shared post photos across feeds and detail, post actions, and friend share'
}
