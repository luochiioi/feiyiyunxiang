const { fail } = require('./community-policy')

function validateCursor(cursor) {
  if (cursor && (typeof cursor !== 'string' || !/^[0-9]{13}-[a-f0-9]{64}$/.test(cursor))) fail('INVALID_CURSOR')
}

// Preexisting records may still say pending after their post points at a newer revision.
async function* pendingRevisions(repo, filter = {}, cursor = '') {
  validateCursor(cursor)
  let before = cursor || null
  while (true) {
    const candidates = await repo.page('fy-community-versions', { ...filter, status: 'pending' },
      { field: 'order', before, size: 50 })
    const posts = await Promise.all(candidates.map(v => repo.get('fy-community-posts', v.postId)))
    for (let i = 0; i < candidates.length; i++) {
      const version = candidates[i], post = posts[i]
      if (post?.latestRevision === version._id && post.uid === version.uid && !['removed', 'deleted'].includes(post.status)) {
        yield { version, post }
      }
    }
    if (candidates.length < 50) return
    before = candidates.at(-1).order
  }
}

async function pendingCount(repo, filter) {
  let count = 0
  for await (const _ of pendingRevisions(repo, filter)) count++
  return count
}

module.exports = { validateCursor, pendingRevisions, pendingCount }
