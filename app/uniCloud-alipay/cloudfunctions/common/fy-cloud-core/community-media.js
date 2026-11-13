const { randomBytes } = require('node:crypto')
const { encrypt, decrypt, decodeImage } = require('./security')
const fail = code => { throw new Error(code) }

function cleanPng(bytes) {
  const output = [bytes.subarray(0, 8)]
  const safe = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'])
  let data = false
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (end > bytes.length || (offset === 8 && (type !== 'IHDR' || length !== 13))) fail('INVALID_IMAGE')
    if (safe.has(type)) output.push(bytes.subarray(offset, end))
    if (type === 'IDAT') data = true
    if (type === 'IEND') {
      if (!data || length || end !== bytes.length) fail('INVALID_IMAGE')
      return Buffer.concat(output)
    }
    offset = end
  }
  fail('INVALID_IMAGE')
}

function cleanJpeg(bytes) {
  const output = [bytes.subarray(0, 2)]
  let scan = false
  let sawScan = false
  let offset = 2
  while (offset < bytes.length) {
    if (scan) {
      const start = offset
      while (offset < bytes.length) {
        const marker = bytes.indexOf(255, offset)
        if (marker < 0) fail('INVALID_IMAGE')
        let code = marker + 1
        while (bytes[code] === 255) code++
        if (bytes[code] !== 0 && !(bytes[code] >= 208 && bytes[code] <= 215)) {
          offset = marker
          break
        }
        offset = code + 1
      }
      output.push(bytes.subarray(start, offset))
      scan = false
    }
    const start = offset
    if (bytes[offset++] !== 255) fail('INVALID_IMAGE')
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217 && sawScan && offset === bytes.length) {
      output.push(bytes.subarray(start, offset))
      return Buffer.concat(output)
    }
    if (marker < 192 || marker === 216 || marker === 217 || offset + 2 > bytes.length) fail('INVALID_IMAGE')
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) fail('INVALID_IMAGE')
    offset += length
    // APPn and COM carry EXIF, XMP, GPS and other embedded metadata.
    if (!(marker >= 224 && marker <= 239) && marker !== 254) output.push(bytes.subarray(start, offset))
    scan = marker === 218
    if (scan) sawScan = true
  }
  fail('INVALID_IMAGE')
}

function sanitize(base64) {
  const { bytes, mime } = decodeImage(base64)
  return { mime, bytes: mime === 'image/png' ? cleanPng(bytes) : cleanJpeg(bytes) }
}

function createCommunityMedia({ cloud, cfg, service, limited, namespace = 'community' }) {
  function encryptionKey() {
    const key = Buffer.from(cfg.mediaEncryptionKey ?? '', 'base64')
    if (cfg.privateStorageVerified !== true || key.length !== 32) fail('CONFIG_REQUIRED')
    return key
  }

  async function bytesOf(media) {
    const key = encryptionKey()
    try {
      const { fileContent } = await cloud.downloadFile({ fileID: media.fileID })
      if (!Buffer.isBuffer(fileContent) || fileContent.length < 28) fail('PHOTO_UNAVAILABLE')
      return decrypt(fileContent, key)
    } catch (_) { fail('PHOTO_UNAVAILABLE') }
  }

  return {
    async fromUpload(base64) { return sanitize(base64) },
    async fromDiary(user, diary) {
      const source = await service.readMedia(user, { id: diary.mediaId })
      if (!source.used || source.runId !== diary.runId || source.nodeId !== diary.nodeId) fail('NOT_FOUND')
      return sanitize((await bytesOf(source)).toString('base64'))
    },
    async store(image, uid) {
      const key = encryptionKey()
      await limited(namespace + '-upload:' + uid, 15)
      const path = 'fy-private/' + namespace + '/' + randomBytes(24).toString('hex') + '.bin'
      const fileContent = encrypt(image.bytes, key)
      let upload
      try { upload = await cloud.uploadFile({ cloudPath: path, fileContent }) }
      catch (_) { fail('MEDIA_UPLOAD_FAILED') }
      const fileID = upload?.fileID
      if (typeof fileID !== 'string' || !fileID.trim()) fail('MEDIA_UPLOAD_FAILED')
      return { fileID, mime: image.mime }
    },
    async discard(media) {
      try { await cloud.deleteFile({ fileList: [media.fileID] }) } catch (_) { /* Reconcile encrypted orphans later. */ }
    },
    async read(media) {
      return { src: 'data:' + media.mime + ';base64,' + (await bytesOf(media)).toString('base64') }
    }
  }
}
module.exports = { createCommunityMedia, sanitize }
