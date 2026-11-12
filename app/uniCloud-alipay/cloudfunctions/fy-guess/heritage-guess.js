const { randomInt, randomUUID } = require('node:crypto')
const { key } = require('./core').security

const styles = {
  embroidery: {
    name: '湘绣',
    material: 'Hand-stitched Hunan Xiang embroidery with fine split silk threads and shaded stitches on a clearly woven fabric backing.',
    prompt: 'A realistic close-up photo of original Hunan-style Xiang embroidery: hand-stitched silk threads on fabric, with visibly fine split threads and graded colors forming a botanical motif. Soft natural light, unmistakable fabric texture.',
    note: '湘绣可通过劈丝把绣线分细，并用掺针等技法表现浓淡和色阶过渡。留意画面里线条的走向和深浅。'
  },
  tile: {
    name: '葡萄牙瓷砖',
    material: 'Portuguese azulejo glazed ceramic tiles, painted in deep blue on white glaze. Show visible tile seams and reflected light.',
    prompt: 'A realistic close-up photo of an original arrangement of Portuguese azulejo glazed ceramic tiles: cobalt-blue botanical shapes on white glaze, clear tile seams, and soft reflected light.',
    note: '葡萄牙釉面装饰砖常称 azulejo。钴可呈蓝色，多块砖上的连续纹样可以组成一整面画。'
  }
}
const motifs = {
  floral: { name: '花卉纹样', prompt: 'One clearly recognizable open flower, with petals and leaves. No birds, animals or figurative border motifs.' },
  bird: { name: '鸟纹样', prompt: 'One clearly recognizable bird in profile, with a visible beak, wing and tail. No flowers or other figurative motifs.' }
}
const variants = Object.fromEntries(Object.entries(styles).flatMap(([craftId, style]) =>
  Object.entries(motifs).map(([motifId, motif]) => [craftId + '-' + motifId, {
    name: style.name + ' · ' + motif.name,
    prompt: 'A realistic close-up photo of original decorative craftwork. ' + style.material + ' ' + motif.prompt +
      ' Place the whole motif in the centre with a little margin. Use dark blue on a pale background and soft natural light.',
    note: style.note
  }])
))
const legacyOptions = [...Object.entries(styles).map(([id, style]) => ({ id, label: style.name })),
  { id: 'print', label: '木版印花' }]
const motifOptions = Object.entries(variants).map(([id, style]) => ({ id, label: style.name }))
const allStyles = { ...styles, ...variants }
const leaseMs = 110000
const dayMs = 86400000
const fail = code => { throw new Error(code) }
const requestOf = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const styleOf = value => typeof value === 'string' && Object.hasOwn(allStyles, value)
const walletId = uid => key('heritage-guess-wallet', uid)
const optionsFor = style => Object.hasOwn(variants, style) ? motifOptions : legacyOptions

function guessView(row, uid) {
  const mine = row.from === uid
  return {
    id: row._id, createdAt: row.createdAt, mine, otherName: mine ? row.toName : row.fromName,
    options: optionsFor(row.style), eliminated: mine ? null : row.eliminated ?? null,
    result: row.result == null ? null : mine ? { ...row.result, reward: '' } : row.result
  }
}

function createHeritageGuess({ repo, media, generate, now = Date.now }) {
  async function readyGuess(db, uid, id, recipientOnly = false) {
    if (!requestOf(id)) fail('NOT_FOUND')
    const row = await db.get('fy-heritage-guesses', id)
    if (row?.status !== 'ready' || (row.to !== uid && (recipientOnly || row.from !== uid))) fail('NOT_FOUND')
    return row
  }

  async function releaseGeneration(id, attempt) {
    await repo.tx(async db => {
      const row = await db.get('fy-heritage-guesses', id)
      if (row?.status === 'generating' && row.attempt === attempt) {
        await db.put('fy-heritage-guesses', id, { ...row, status: 'failed' })
      }
    })
  }

  return {
    async guessInbox(u) {
      const filter = { status: 'ready' }
      const page = { field: 'createdAt', size: 20 }
      const [inbox, sent, wallet] = await Promise.all([
        repo.page('fy-heritage-guesses', { ...filter, to: u.uid }, page),
        repo.page('fy-heritage-guesses', { ...filter, from: u.uid }, page),
        repo.get('fy-guess-wallets', walletId(u.uid))
      ])
      return { incoming: inbox.map(row => guessView(row, u.uid)), sent: sent.map(row => guessView(row, u.uid)),
        hints: wallet?.hints ?? 0, supportsMotifs: true }
    },

    async guessSend(u, p) {
      if (!styleOf(p.style) || !requestOf(p.requestId) || typeof p.code !== 'string' || !/^[A-Z2-9]{8}$/.test(p.code)) fail('INVALID_REQUEST')
      const id = key('heritage-guess', u.uid, p.requestId)
      const attempt = randomUUID()
      const result = await repo.tx(async db => {
        const existing = await db.get('fy-heritage-guesses', id)
        if (existing) {
          if (existing.toCode !== p.code || existing.style !== p.style) fail('REQUEST_CONFLICT')
          if (existing.status === 'ready') return 'sent'
          if (existing.status === 'generating' && existing.leaseUntil > now()) fail('GUESS_GENERATING')
        }

        const target = (await db.list('fy-profiles', { code: p.code }))[0]
        if (!target || target.uid === u.uid) fail('NOT_FRIENDS')
        const friend = await db.get('fy-friends', key('friend', ...[u.uid, target.uid].sort()))
        if (friend?.status !== 'accepted') fail('NOT_FRIENDS')
        const sender = (await db.list('fy-profiles', { uid: u.uid }))[0]
        if (!sender) fail('NOT_FRIENDS')
        const day = Math.floor(now() / dayMs)
        const quotaId = key('heritage-guess-quota', u.uid, day)
        const quota = await db.get('fy-limits', quotaId)
        if ((quota?.count ?? 0) >= 5) fail('RATE_LIMITED')
        await db.put('fy-limits', quotaId, { count: (quota?.count ?? 0) + 1, expiresAt: (day + 1) * dayMs })
        await db.put('fy-heritage-guesses', id, {
          from: u.uid, to: target.uid, toCode: p.code, fromName: sender.nickname, toName: target.nickname,
          style: p.style, status: 'generating', attempt, leaseUntil: now() + leaseMs, createdAt: now()
        })
        return 'generate'
      })
      if (result === 'sent') return { id }

      let stored
      try {
        stored = await media.store(await generate(allStyles[p.style].prompt), u.uid)
        await repo.tx(async db => {
          const current = await db.get('fy-heritage-guesses', id)
          if (current?.status !== 'generating' || current.attempt !== attempt) fail('GUESS_GENERATING')
          await db.put('fy-heritage-guesses', id, { ...current, status: 'ready', media: stored })
        })
      } catch (error) {
        const current = await repo.get('fy-heritage-guesses', id).catch(() => undefined)
        if (current?.status === 'ready' && current.attempt === attempt) return { id }
        if (stored && current !== undefined) await media.discard(stored)
        await releaseGeneration(id, attempt).catch(() => {})
        throw error
      }
      return { id }
    },

    async guessImage(u, p) {
      const row = await readyGuess(repo, u.uid, p.id)
      return media.read(row.media)
    },

    async guessHint(u, p) {
      return repo.tx(async db => {
        const row = await readyGuess(db, u.uid, p.id, true)
        if (row.result) fail('GUESS_ANSWERED')
        const id = walletId(u.uid)
        const wallet = await db.get('fy-guess-wallets', id)
        if (row.eliminated) return { eliminated: row.eliminated, hints: wallet?.hints ?? 0 }
        if (!(wallet?.hints > 0)) fail('NO_GUESS_HINT')
        const wrong = optionsFor(row.style).filter(option => option.id !== row.style)
        const eliminated = wrong[randomInt(wrong.length)].id
        const hints = wallet.hints - 1
        await db.put('fy-guess-wallets', id, { hints })
        await db.put('fy-heritage-guesses', p.id, { ...row, eliminated })
        return { eliminated, hints }
      })
    },

    async guessAnswer(u, p) {
      return repo.tx(async db => {
        const row = await readyGuess(db, u.uid, p.id, true)
        if (row.result) return row.result
        if (!optionsFor(row.style).some(option => option.id === p.choice) || row.eliminated === p.choice) fail('INVALID_GUESS_OPTION')
        const correct = p.choice === row.style
        let reward = ''
        if (correct) {
          const id = walletId(u.uid)
          const wallet = await db.get('fy-guess-wallets', id)
          const assignments = await db.list('fy-assignments', { uid: u.uid })
          const open = assignments.filter(item => item.status === 'pending' || item.status === 'doing')
            .sort((a, b) => a.assignedAt - b.assignedAt)[0]
          if (open) {
            await db.put('fy-assignments', open._id, { ...open, status: 'waived', waivedAt: now(), guessId: p.id })
            reward = 'waived'
          } else {
            await db.put('fy-guess-wallets', id, { hints: (wallet?.hints ?? 0) + 1 })
            reward = 'hint'
          }
        }
        const style = allStyles[row.style]
        const result = { correct, reward, answer: style.name, note: correct ? style.note : '' }
        await db.put('fy-heritage-guesses', p.id, { ...row, result, answeredAt: now() })
        return result
      })
    }
  }
}

module.exports = { createHeritageGuess }
