const shared = (() => {
  try { return require.resolve('fy-cloud-core/security') }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return require.resolve('../common/fy-cloud-core/security')
  }
})()
module.exports = require(shared)
