const { test } = require('node:test')
const assert = require('node:assert/strict')
const { clientScript } = require('./helpers/client-script.cjs')

test('archive groups recent entries by local day and keeps legacy entries in all records', () => {
  const script = clientScript('features/profile/checkin-archive.uts')
  script.run(`const entries = [
    { _id: 'legacy', createdAt: new Date(2026, 10, 20, 18).getTime() },
    { _id: 'second', kind: 'outdoor', createdAt: new Date(2026, 10, 24, 9).getTime() },
    { _id: 'first', kind: 'indoor', createdAt: new Date(2026, 10, 24, 15).getTime() }
  ]`)
  const groups = kind => JSON.parse(script.run(`JSON.stringify(groupDiary(entries, '${kind}').map(day => day.entries.map(entry => entry._id)))`))
  assert.deepEqual(groups(''), [['first', 'second'], ['legacy']])
  assert.deepEqual(groups('outdoor'), [['second']])
  assert.deepEqual(groups('indoor'), [['first']])
  assert.equal(script.run('diaryKind()'), '打卡')
})
