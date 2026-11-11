const tilePatterns = ['rose', 'sail', 'geometry']
const tilePalettes = ['indigo', 'cobalt', 'mist']

function requireValue(ok, code) {
  if (!ok) throw new Error(code)
}

function validateCulture(value, nodeIds) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CULTURE')
  const tile = value.tile
  requireValue(tile && typeof tile.title === 'string' && tile.title.trim() && tile.title.length <= 80, 'INVALID_TILE')
  const after = tile.after
  requireValue(Array.isArray(after) && after.length > 0 && new Set(after).size === after.length &&
    after.every(id => nodeIds.has(id)), 'INVALID_TILE_GATE')
  return { tile: { title: tile.title, after } }
}

function cultureSummary(culture) {
  return culture?.tile ? [{ id: 'tile', title: culture.tile.title }] : []
}

function tileWork(p, at) {
  requireValue(tilePatterns.includes(p.pattern) && tilePalettes.includes(p.palette), 'INVALID_TILE_SELECTION')
  return { pattern: p.pattern, palette: p.palette, savedAt: at }
}

module.exports = { requireValue, validateCulture, cultureSummary, tileWork }
