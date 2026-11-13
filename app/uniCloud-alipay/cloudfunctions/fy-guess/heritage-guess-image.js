const { decodeImageBytes } = require('./core').security

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function createGuessImage({ http, cfg, apiKey = process.env.SILICONFLOW_API_KEY }) {
  return async function generate(prompt) {
    const token = (apiKey || cfg.imageGuess?.apiKey || '').trim()
    if (!token || cfg.privateStorageVerified !== true || Buffer.from(cfg.mediaEncryptionKey ?? '', 'base64').length !== 32) {
      throw new Error('GUESS_CONFIG_REQUIRED')
    }

    try {
      const response = await http.request('https://api.siliconflow.cn/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        contentType: 'json',
        dataType: 'json',
        followRedirect: false,
        timeout: 70000,
        data: {
          model: cfg.imageGuess?.model || 'Kwai-Kolors/Kolors',
          prompt: prompt + ' No people, logos, readable text, or captions. This is an invented object for a cultural guessing game.',
          image_size: '1024x1024'
        }
      })
      if (response.status !== 200) throw new Error('IMAGE_REQUEST_FAILED')
      const url = new URL(response.data?.images?.[0]?.url)
      const trustedHost = url.hostname.endsWith('.siliconflow.cn') ||
        /^sf-(?:maas|cloud)[a-z0-9-]*\.oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)
      if (!trustedHost || url.protocol !== 'https:' || url.port || url.username || url.password) {
        throw new Error('IMAGE_URL_INVALID')
      }

      const download = await http.request(url.href, { method: 'GET', followRedirect: false, timeout: 10000 })
      if (download.status !== 200) throw new Error('IMAGE_DOWNLOAD_FAILED')
      return decodeImageBytes(download.data, MAX_IMAGE_BYTES)
    } catch (_) {
      throw new Error('GUESS_IMAGE_FAILED')
    }
  }
}

module.exports = { createGuessImage }
