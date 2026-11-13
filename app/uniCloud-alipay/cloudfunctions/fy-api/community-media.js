const shared = (() => {
  try { return require.resolve('fy-cloud-core/community-media') }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return require.resolve('../common/fy-cloud-core/community-media')
  }
})()
module.exports = require(shared)
