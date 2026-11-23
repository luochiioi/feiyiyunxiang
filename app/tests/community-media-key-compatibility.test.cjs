const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCommunityMedia } = require('../uniCloud-alipay/cloudfunctions/fy-api/community-media')
const { encrypt, decrypt } = require('../uniCloud-alipay/cloudfunctions/fy-api/security')
const current = Buffer.alloc(32, 1), legacy = Buffer.alloc(32, 2), unrelated = Buffer.alloc(32, 3)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aiekAAAAASUVORK5CYII=', 'base64')
function fixture(extra = {}) {
  const files = new Map([['old', encrypt(png, legacy)], ['current', encrypt(png, current)], ['unknown', encrypt(png, unrelated)]])
  const cfg = { privateStorageVerified: true, mediaEncryptionKey: current.toString('base64'), ...extra }
  const cloud = {
    async downloadFile({ fileID }) { return { fileContent: files.get(fileID) } },
    async uploadFile({ cloudPath, fileContent }) { files.set(cloudPath, fileContent); return { fileID: cloudPath } }
  }
  return { files, cloud, media: createCommunityMedia({ cloud, cfg, limited: async () => {} }) }
}
test('configured legacy key restores old images while current images still read', async () => {
  const { media } = fixture({ mediaLegacyDecryptionKeys: [legacy.toString('base64')] })
  for (const fileID of ['old', 'current']) {
    assert.deepEqual(await media.read({ fileID, mime: 'image/png' }), { src: 'data:image/png;base64,' + png.toString('base64') })
  }
})
test('legacy keys are read-only and new uploads keep the current encryption key', async () => {
  const { media, files } = fixture({ mediaLegacyDecryptionKeys: [legacy.toString('base64')] })
  const result = await media.store({ bytes: png, mime: 'image/png' }, 'owner')
  assert.deepEqual(decrypt(files.get(result.fileID), current), png)
  assert.throws(() => decrypt(files.get(result.fileID), legacy))
})
test('missing or unrelated decryption keys do not expose unreadable image data', async () => {
  await assert.rejects(fixture().media.read({ fileID: 'old', mime: 'image/png' }), /PHOTO_UNAVAILABLE/)
  const { media } = fixture({ mediaLegacyDecryptionKeys: [legacy.toString('base64')] })
  await assert.rejects(media.read({ fileID: 'unknown', mime: 'image/png' }), /PHOTO_UNAVAILABLE/)
})
test('a transient storage download retries once; permanent storage failure stays bounded', async () => {
  const f = fixture(); let calls = 0
  f.cloud.downloadFile = async () => {
    if (++calls === 1) throw new Error('TEMPORARY_STORAGE_FAILURE')
    return { fileContent: f.files.get('current') }
  }
  assert.match((await f.media.read({ fileID: 'current', mime: 'image/png' })).src, /^data:image\/png;base64,/)
  assert.equal(calls, 2)
  calls = 0
  f.cloud.downloadFile = async () => { calls++; throw new Error('STORAGE_UNAVAILABLE') }
  await assert.rejects(f.media.read({ fileID: 'current', mime: 'image/png' }), /PHOTO_UNAVAILABLE/)
  assert.equal(calls, 2)
})
test('storage error responses retry but ciphertext authentication failure does not download again', async () => {
  const f = fixture({ mediaLegacyDecryptionKeys: [legacy.toString('base64')] }); let calls = 0
  f.cloud.downloadFile = async () => ++calls === 1 ? { statusCode: 503 } : { fileContent: f.files.get('old') }
  assert.match((await f.media.read({ fileID: 'old', mime: 'image/png' })).src, /^data:image\/png;base64,/)
  assert.equal(calls, 2)
  calls = 0
  f.cloud.downloadFile = async () => { calls++; return { fileContent: f.files.get('unknown') } }
  await assert.rejects(f.media.read({ fileID: 'unknown', mime: 'image/png' }), /PHOTO_UNAVAILABLE/)
  assert.equal(calls, 1)
})
