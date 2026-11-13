let shared
try { shared = require.resolve('fy-cloud-core') }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
  shared = require.resolve('../common/fy-cloud-core')
}
module.exports = require(shared)
