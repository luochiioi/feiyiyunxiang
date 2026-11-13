const shared = (() => {
  try { return require.resolve('fy-cloud-core/repository') }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return require.resolve('../common/fy-cloud-core/repository')
  }
})()
module.exports = require(shared)
