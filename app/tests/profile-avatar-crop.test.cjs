const test = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')

test('avatar crop crops a square, keeps it in bounds, and lets the user reframe wide and tall photos', () => {
  const script = clientScript('features/profile/avatar-crop.uts')
  const crop = (width, height, zoom, x, y) =>
    JSON.parse(script.run(`JSON.stringify(avatarCrop(${width}, ${height}, ${zoom}, ${x}, ${y}))`))
  assert.deepEqual(crop(1200, 800, 1, 50, 50), { x: 200, y: 0, side: 800 })
  assert.deepEqual(crop(1200, 800, 2, 100, 0), { x: 800, y: 0, side: 400 })
  assert.deepEqual(crop(800, 1200, 1, 0, 100), { x: 0, y: 400, side: 800 })
  assert.deepEqual(crop(1200, 800, 2, -5, 106), { x: 0, y: 400, side: 400 })
  assert.throws(() => crop(1200, 0, 1, 50, 50), /INVALID_IMAGE/)
})
