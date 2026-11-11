const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRepository } = require('../uniCloud-alipay/cloudfunctions/fy-api/repository')

test('repository reads document and missing values in ordinary and transactional reads', async () => {
  const existing = { _id: 'known', count: 2 }
  const collection = transactional => ({
    doc: id => ({
      get: async () => ({
        data: transactional ? (id === 'known' ? existing : null) : (id === 'known' ? [existing] : [])
      })
    })
  })
  const repo = createRepository({
    collection: () => collection(false),
    startTransaction: async () => ({ collection: () => collection(true), commit: async () => {} })
  })

  assert.deepEqual(await repo.get('fy-limits', 'known'), existing)
  assert.equal(await repo.get('fy-limits', 'missing'), null)
  await repo.tx(async tx => {
    assert.deepEqual(await tx.get('fy-limits', 'known'), existing)
    assert.equal(await tx.get('fy-limits', 'missing'), null)
  })
})
