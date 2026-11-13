const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHeritageGuess } = require('../uniCloud-alipay/cloudfunctions/fy-guess/heritage-guess')
const { createGuessImage } = require('../uniCloud-alipay/cloudfunctions/fy-guess/heritage-guess-image')
const { createPartnershipService } = require('../uniCloud-alipay/cloudfunctions/fy-api/partnership-service')
const { key } = require('../uniCloud-alipay/cloudfunctions/fy-api/service')

const a = { uid: 'sender' }, b = { uid: 'recipient' }, c = { uid: 'outsider' }
const code = 'ABCDEFGH'
const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(20), Buffer.from([255, 217])])

async function setup(generate = async () => ({ bytes: jpeg, mime: 'image/jpeg' }), allowSelfTrial = false) {
  const collections = new Map()
  const db = {
    async get(collection, id) {
      return structuredClone(collections.get(collection)?.get(id) ?? null)
    },
    async put(collection, id, row) {
      if (!collections.has(collection)) collections.set(collection, new Map())
      collections.get(collection).set(id, structuredClone({ ...row, _id: id }))
    },
    async list(collection, filter) {
      return Array.from(collections.get(collection)?.values() ?? []).filter(row =>
        Object.entries(filter).every(([field, expected]) => row[field] === expected)).map(row => structuredClone(row))
    },
    async page(collection, filter, { field, size }) {
      return (await db.list(collection, filter)).sort((left, right) => right[field] - left[field]).slice(0, size)
    }
  }
  let tail = Promise.resolve()
  const repo = { ...db, tx(operation) {
    const task = tail.then(async () => {
      const before = structuredClone(collections)
      try { return await operation(db) }
      catch (error) {
        collections.clear()
        for (const [name, rows] of before) collections.set(name, rows)
        throw error
      }
    })
    tail = task.catch(() => {})
    return task
  } }
  const media = {
    async store(image) { assert.equal(image.mime, 'image/jpeg'); return { fileID: 'private-image', mime: image.mime } },
    async read(image) { assert.equal(image.fileID, 'private-image'); return { src: 'data:image/jpeg;base64,test' } },
    async discard() {}
  }
  const service = createHeritageGuess({ repo, media, generate, now: () => 1000000, allowSelfTrial })
  await repo.put('fy-profiles', 'sender-card', { uid: a.uid, code: 'BCDEFGHJ', nickname: '澳门旅伴' })
  await repo.put('fy-profiles', 'receiver-card', { uid: b.uid, code, nickname: '湖南旅伴' })
  const friendship = key('friend', ...[a.uid, b.uid].sort())
  await repo.put('fy-friends', friendship, { status: 'accepted', from: a.uid, to: b.uid })
  return { service, repo, friendship }
}
function draft(requestId = 'guess-one', style = 'tile') { return { code, style, requestId } }

test('a generated riddle reaches only the accepted friend and keeps answers and media IDs private', async () => {
  const prompts = []
  const { service, repo, friendship } = await setup(async prompt => {
    prompts.push(prompt)
    return { bytes: jpeg, mime: 'image/jpeg' }
  })
  await repo.put('fy-friends', friendship, { status: 'pending', from: a.uid, to: b.uid })
  await assert.rejects(service.guessSend(a, draft()), /NOT_FRIENDS/)
  await repo.put('fy-friends', friendship, { status: 'accepted', from: a.uid, to: b.uid })
  const { id } = await service.guessSend(a, draft())
  assert.match(prompts[0], /azulejo/)
  assert.deepEqual(await service.guessSend(a, draft()), { id })
  assert.equal(prompts.length, 1)
  await assert.rejects(service.guessSend(a, draft('guess-one', 'embroidery')), /REQUEST_CONFLICT/)
  const view = (await service.guessInbox(b)).incoming[0]
  assert.equal(view.id, id)
  assert.equal(view.result, null)
  assert.equal(view.style, undefined)
  assert.equal(view.media, undefined)
  assert.equal((await service.guessInbox(c)).incoming.length, 0)
  assert.deepEqual(await service.guessImage(a, { id }), await service.guessImage(b, { id }))
  await assert.rejects(service.guessImage(c, { id }), /NOT_FOUND/)
  await assert.rejects(service.guessAnswer(a, { id, choice: 'tile' }), /NOT_FOUND/)
})

test('answers waive one pending PK task, then grant and consume one hint exactly once', async () => {
  const { service, repo } = await setup()
  const first = await service.guessSend(a, draft())
  await repo.put('fy-assignments', 'task', { uid: b.uid, status: 'pending', assignedAt: 1, rejectAvailableAt: 99999999 })
  const replies = await Promise.all([service.guessAnswer(b, { ...first, choice: 'tile' }), service.guessAnswer(b, { ...first, choice: 'tile' })])
  assert.deepEqual(replies[0], replies[1])
  assert.equal(replies[0].reward, 'waived')
  assert.match(replies[0].note, /azulejo/)
  assert.equal((await repo.get('fy-assignments', 'task')).status, 'waived')
  assert.equal(await createPartnershipService({ repo }).assignment(b), null)
  assert.equal((await service.guessInbox(a)).sent[0].result.reward, '')
  assert.equal((await service.guessInbox(b)).hints, 0)

  const second = await service.guessSend(a, draft('guess-two', 'embroidery'))
  await assert.rejects(service.guessHint(b, second), /NO_GUESS_HINT/)
  assert.equal((await service.guessAnswer(b, { ...second, choice: 'embroidery' })).reward, 'hint')
  const third = await service.guessSend(a, draft('guess-three'))
  const used = await service.guessHint(b, third)
  assert.notEqual(used.eliminated, 'tile')
  assert.deepEqual(await service.guessHint(b, third), used)
  assert.equal(used.hints, 0)
  await assert.rejects(service.guessAnswer(b, { ...third, choice: used.eliminated }), /INVALID_GUESS_OPTION/)
  const wrong = used.eliminated === 'print' ? 'embroidery' : 'print'
  assert.deepEqual(await service.guessAnswer(b, { ...third, choice: wrong }), { correct: false, reward: '', answer: '葡萄牙瓷砖', note: '' })
  assert.equal((await service.guessAnswer(b, { ...third, choice: 'tile' })).correct, false)
  assert.equal((await service.guessInbox(b)).hints, 0)
})

test('new riddles require both craft and motif while legacy options stay usable', async () => {
  const prompts = []
  const { service, repo } = await setup(async prompt => {
    prompts.push(prompt)
    return { bytes: jpeg, mime: 'image/jpeg' }
  })
  const legacy = await service.guessSend(a, draft('legacy-before-update', 'tile'))
  const flower = await service.guessSend(a, draft('new-flower', 'tile-floral'))
  const bird = await service.guessSend(a, draft('new-bird', 'embroidery-bird'))
  for (const { id } of [flower, bird]) {
    const row = await repo.get('fy-heritage-guesses', id)
    delete row.options
    await repo.put('fy-heritage-guesses', id, row)
  }
  const inbox = await service.guessInbox(b)
  assert.equal(inbox.supportsMotifs, true)
  const optionsOf = id => inbox.incoming.find(item => item.id === id).options.map(option => option.id)
  assert.deepEqual(optionsOf(legacy.id), ['embroidery', 'tile', 'print'])
  assert.deepEqual(optionsOf(flower.id), ['embroidery-floral', 'embroidery-bird', 'tile-floral', 'tile-bird'])
  assert.deepEqual(optionsOf(bird.id), optionsOf(flower.id))
  assert.match(prompts[1], /azulejo.*open flower/)
  assert.match(prompts[2], /Xiang embroidery.*bird in profile/)
  await assert.rejects(service.guessAnswer(b, { ...flower, choice: 'tile' }), /INVALID_GUESS_OPTION/)
  const sameCraft = await service.guessAnswer(b, { ...flower, choice: 'tile-bird' })
  assert.equal(sameCraft.correct, false)
  assert.equal(sameCraft.reward, '')
  assert.equal(sameCraft.answer, '葡萄牙瓷砖 · 花卉纹样')
  assert.equal((await service.guessAnswer(b, { ...legacy, choice: 'tile' })).reward, 'hint')
  const hint = await service.guessHint(b, bird)
  assert.ok(optionsOf(bird.id).includes(hint.eliminated))
  assert.notEqual(hint.eliminated, 'embroidery-bird')
  assert.equal(hint.hints, 0)
  const result = await service.guessAnswer(b, { ...bird, choice: 'embroidery-bird' })
  assert.equal(result.correct, true)
  assert.equal(result.reward, 'hint')
  assert.match(result.note, /劈丝/)
})

test('extended riddles keep eight choices in the same order and grade lookalikes as incorrect', async () => {
  const { service } = await setup(undefined, true)
  const request = { ...draft('extended-flower', 'tile-floral'), selfTrial: true }
  const guess = await service.guessSend(a, request)
  const options = async () => (await service.guessInbox(a)).incoming.find(item => item.id === guess.id).options
  const choices = await options()
  assert.equal(new Set(choices.map(option => option.id)).size, 8)
  assert.ok(choices.some(option => option.id === 'tile-floral'))
  assert.ok(choices.some(option => option.id === 'resist-floral'))
  assert.ok(choices.some(option => option.id === 'porcelain-floral'))
  assert.deepEqual(await service.guessSend(a, request), guess)
  assert.deepEqual(await options(), choices)
  assert.equal((await service.guessAnswer(a, { ...guess, choice: 'porcelain-floral' })).correct, false)
})

test('development self-trial is private and can never grant a real reward', async () => {
  const request = { requestId: 'solo-preview', style: 'embroidery-bird', selfTrial: true, code }
  const disabled = await setup()
  await assert.rejects(disabled.service.guessSend(a, request), /FORBIDDEN/)

  const { service, repo } = await setup(undefined, true)
  await repo.put('fy-assignments', 'solo-task', { uid: a.uid, status: 'pending' })
  const wallet = key('heritage-guess-wallet', a.uid)
  await repo.put('fy-guess-wallets', wallet, { hints: 2 })
  const sent = await service.guessSend(a, request)
  assert.deepEqual(await service.guessSend(a, request), sent)
  const own = await service.guessInbox(a)
  assert.equal(own.supportsSelfTrial, true)
  assert.equal(own.incoming[0].selfTrial, true)
  assert.equal(own.incoming[0].mine, false)
  assert.equal(own.sent.length, 0)
  assert.equal((await service.guessInbox(b)).incoming.length, 0)
  await assert.rejects(service.guessImage(b, sent), /NOT_FOUND/)
  assert.match((await service.guessImage(a, sent)).src, /base64/)
  await assert.rejects(service.guessHint(a, sent), /FORBIDDEN/)

  const result = await service.guessAnswer(a, { ...sent, choice: 'embroidery-bird' })
  assert.equal(result.reward, 'trial')
  assert.match(result.note, /劈丝/)
  assert.equal((await repo.get('fy-assignments', 'solo-task')).status, 'pending')
  assert.equal((await repo.get('fy-guess-wallets', wallet)).hints, 2)
  assert.equal((await repo.list('fy-friends', {})).length, 1)
})

test('generation failure and in-flight retry produce at most one visible riddle', async () => {
  let calls = 0
  let start
  const inFlight = new Promise(resolve => { start = resolve })
  let resume
  const image = new Promise(resolve => { resume = resolve })
  const { service } = await setup(async () => {
    if (++calls === 1) throw new Error('GUESS_IMAGE_FAILED')
    start()
    return image
  })
  await assert.rejects(service.guessSend(a, draft()), /GUESS_IMAGE_FAILED/)
  assert.deepEqual((await service.guessInbox(b)).incoming, [])
  const retry = service.guessSend(a, draft())
  await inFlight
  await assert.rejects(service.guessSend(a, draft()), /GUESS_GENERATING/)
  resume({ bytes: jpeg, mime: 'image/jpeg' })
  const sent = await retry
  assert.deepEqual(await service.guessSend(a, draft()), sent)
  assert.equal((await service.guessInbox(b)).incoming.length, 1)
  assert.equal(calls, 2)
})

test('SiliconFlow generates and downloads a marked image server-side', async () => {
  const calls = []
  const imageUrl = 'https://s3.siliconflow.cn/outputs/test.jpg?signature=test'
  const bytes = Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(1024 * 1024), jpeg.subarray(-2)])
  const cfg = { privateStorageVerified: true, mediaEncryptionKey: Buffer.alloc(32).toString('base64') }
  const http = { async request(url, args) {
    calls.push(url)
    if (args.method === 'GET') {
      assert.equal(url, imageUrl)
      assert.equal(args.headers, undefined)
      assert.equal(args.followRedirect, false)
      return { status: 200, data: bytes }
    }
    assert.equal(url, 'https://api.siliconflow.cn/v1/images/generations')
    assert.equal(args.headers.Authorization, 'Bearer test-key')
    assert.equal(args.headers['X-Enable-Watermark'], undefined)
    assert.equal(args.data.image_size, '1024x1024')
    assert.equal(args.data.model, 'Kwai-Kolors/Kolors')
    assert.match(args.data.prompt, /No people/)
    return { status: 200, data: { images: [{ url: imageUrl }] } }
  } }
  await assert.rejects(createGuessImage({ cfg, http, apiKey: '' })('tile'), /GUESS_CONFIG_REQUIRED/)
  assert.equal(calls.length, 0)
  const image = await createGuessImage({ cfg, http, apiKey: 'test-key' })('tile')
  assert.deepEqual(image, { bytes, mime: 'image/jpeg' })
  assert.equal(calls.length, 2)
})

test('SiliconFlow adapter rejects unrelated download hosts and invalid image data', async () => {
  let downloads = 0
  let imageUrl = 'https://s3.siliconflow.cn.example.com/test.jpg'
  const cfg = { privateStorageVerified: true, mediaEncryptionKey: Buffer.alloc(32).toString('base64') }
  const http = { async request(url, args) {
    if (args.method === 'GET') {
      downloads++
      return { status: 200, data: Buffer.from('not an image') }
    }
    return { status: 200, data: { images: [{ url: imageUrl }] } }
  } }
  const generate = createGuessImage({ cfg, http, apiKey: 'test-key' })
  await assert.rejects(generate('tile'), /GUESS_IMAGE_FAILED/)
  assert.equal(downloads, 0)
  imageUrl = 'https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/outputs/test.png'
  await assert.rejects(generate('tile'), /GUESS_IMAGE_FAILED/)
  assert.equal(downloads, 1)
})

test('standalone guess function uses the stored member identity and denies forged requests', async () => {
  const { readFileSync } = require('node:fs')
  const { createRequire } = require('node:module')
  const { dirname } = require('node:path')
  const { runInNewContext } = require('node:vm')
  const entry = require.resolve('../uniCloud-alipay/cloudfunctions/fy-guess/index')
  const load = createRequire(entry)
  const queried = []
  const database = {
    collection(name) {
      return {
        doc(id) {
          queried.push([name, id])
          return { get: async () => ({ data: name === 'uni-id-users'
            ? [{ _id: 'real-user', status: 0, token: ['valid-token'] }] : [] }) }
        },
        where(query) {
          queried.push([name, query])
          return { orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }
        }
      }
    },
    command: {}
  }
  const sandbox = {
    exports: {}, __dirname: dirname(entry), uniCloud: { database: () => database },
    require(name) {
      if (name === 'uni-config-center') return () => ({ config: () => ({ identity: { tokenSecret: 'test-secret' } }) })
      if (name === 'uni-id-common') return { createInstance: () => ({ checkToken: async token =>
        token === 'valid-token' ? { uid: 'real-user' } : { errCode: 'expired' } }) }
      return load(name)
    }
  }
  runInNewContext(readFileSync(entry, 'utf8'), sandbox)
  const invoke = sandbox.exports.main
  assert.equal((await invoke({ action: 'wxLogin' }, {})).code, 'NOT_FOUND')
  assert.equal((await invoke({ action: 'guessInbox', token: 'fy_admin_fake' }, {})).code, 'AUTH_REQUIRED')
  assert.equal((await invoke({ action: 'guessInbox', token: 'revoked' }, {})).code, 'AUTH_REQUIRED')
  assert.equal(queried.length, 0)
  assert.equal((await invoke({ action: 'guessInbox', token: 'valid-token', payload: { uid: 'forged-user' } }, {})).code, 'OK')
  assert.equal(queried[0][1], 'real-user')
  assert.ok(queried.some(([name, filter]) => name === 'fy-heritage-guesses' && filter.to === 'real-user'))
  assert.ok(queried.some(([name, filter]) => name === 'fy-heritage-guesses' && filter.from === 'real-user'))
})
