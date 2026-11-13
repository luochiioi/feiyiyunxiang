const { createHeritageGuess } = require('./heritage-guess')
const { createGuessImage } = require('./heritage-guess-image')
const { security, repository, media } = require('./core')

const actions = new Set(['guessInbox', 'guessSend', 'guessImage', 'guessHint', 'guessAnswer'])
const errors = new Set(['FORBIDDEN', 'AUTH_REQUIRED', 'NOT_FOUND', 'NOT_FRIENDS', 'REQUEST_CONFLICT',
  'GUESS_GENERATING', 'GUESS_CONFIG_REQUIRED', 'GUESS_IMAGE_FAILED', 'GUESS_ANSWERED',
  'NO_GUESS_HINT', 'RATE_LIMITED', 'MEDIA_UPLOAD_FAILED', 'PHOTO_UNAVAILABLE'])

exports.main = async (event, context) => {
  try {
    if (!actions.has(event?.action)) throw new Error('NOT_FOUND')
    if (typeof event.token !== 'string' || event.token.startsWith('fy_admin_')) throw new Error('AUTH_REQUIRED')
    const cfg = require('uni-config-center')({ pluginId: 'fy', root: __dirname, cache: false }).config()
    if (!cfg.identity?.tokenSecret) throw new Error('GUESS_CONFIG_REQUIRED')
    const identity = require('uni-id-common').createInstance({ context, config: cfg.identity })
    const repo = repository.createRepository(uniCloud.database())
    const { uid } = await security.authenticate(identity, event.token, id => repo.get('uni-id-users', id))

    const privateMedia = media.createCommunityMedia({ cloud: uniCloud, cfg, namespace: 'heritage-guess',
      limited: async () => {} }) // guessSend already reserves a per-account generation quota before any upload.
    const generate = createGuessImage({ http: uniCloud.httpclient, cfg })
    const data = await createHeritageGuess({ repo, media: privateMedia, generate,
      allowSelfTrial: cfg.imageGuess?.allowSelfTrial === true })[event.action]({ uid }, event.payload ?? {})
    return { code: 'OK', data }
  } catch (error) {
    const code = errors.has(error.message) || /^INVALID_[A-Z_]+$/.test(error.message)
      ? error.message : 'SERVICE_UNAVAILABLE'
    return { code, data: null }
  }
}