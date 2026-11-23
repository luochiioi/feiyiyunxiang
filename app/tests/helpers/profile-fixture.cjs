const { transactionFixture } = require('./transaction-fixture.cjs')
const { createProfileService } = require('../../uniCloud-alipay/cloudfunctions/fy-api/profile-service')

async function fixture() {
  const db = transactionFixture()
  let at = 1700000000000
  let stores = 0
  for (const [uid, code] of [['alice', 'ALICE234'], ['bob', 'BOBBB234']]) {
    db.rows.set('uni-id-users/' + uid, { status: 0 })
    db.rows.set('fy-profiles/legacy-' + uid, { uid, code, nickname: '旧昵称' })
  }
  const media = {
    async fromUpload(value) {
      if (value === 'bad') throw Error('INVALID_IMAGE')
      return { bytes: Buffer.from(value), mime: 'image/png' }
    },
    async store() { return { fileID: 'private-' + ++stores, mime: 'image/png' } },
    async discard() {},
    async read() { return { src: 'data:image/png;base64,YQ==' } }
  }
  const service = createProfileService({ repo: db.repo, now: () => at, media })
  return { ...db, service, media, advance: n => { at += n }, stores: () => stores }
}

const alice = { uid: 'alice' }, bob = { uid: 'bob' }
const input = { requestId: 'request-1', baseRevision: 0, nickname: '新昵称' }

module.exports = { fixture, alice, bob, input }
