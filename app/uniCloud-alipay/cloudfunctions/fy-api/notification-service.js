const { key } = require('./service')
const { fail, identifier } = require('./community-policy')
const { validateCursor } = require('./community-review-queue')
const collection = 'fy-notifications'
const titles = {
 'community.post.approved': '帖子审核通过', 'community.post.rejected': '帖子审核未通过', 'community.post.removed': '帖子已下架',
 'community.comment.approved': '评论审核通过', 'community.comment.rejected': '评论审核未通过', 'community.comment.removed': '评论已下架'
}
const notificationId = e => key('notification', e.recipientUid, e.kind, e.postId, e.revisionId, e.commentId)
const member = u => { if (!u?.uid || u.admin || u.reviewer) fail('AUTH_REQUIRED') }
async function writeNotification(db, event) {
 const { recipientUid, kind, postId, revisionId = '', commentId = '', reason = '', createdAt } = event
 if (!Object.hasOwn(titles,kind) || !identifier(recipientUid) || !identifier(postId) || (revisionId && !identifier(revisionId)) || (commentId && !identifier(commentId)) || typeof reason !== 'string' || reason.length > 300 || !Number.isSafeInteger(createdAt) || createdAt <= 0) fail('INVALID_NOTIFICATION')
 const value = {recipientUid,kind,postId,revisionId,commentId,reason,createdAt}
 const id = notificationId(value)
 if (!await db.get(collection,id)) await db.put(collection,id,{...value,order:String(createdAt).padStart(13,'0')+'-'+id,readAt:0})
 return id
}
async function markNotificationRead(db, uid, id, at) {
 if (!identifier(id)) fail('NOT_FOUND')
 const row = await db.get(collection,id)
 if (!row || row.recipientUid !== uid) fail('NOT_FOUND')
 if (!row.readAt) await db.put(collection,id,{...row,readAt:at})
 if (row.kind === 'community.post.rejected') {
  const version = await db.get('fy-community-versions',row.revisionId)
  if (version?.uid === uid && version.postId === row.postId && version.status === 'rejected' && version.reviewSeen !== true) await db.put('fy-community-versions',version._id,{...version,reviewSeen:true})
 }
}
const view = row => ({id:row._id,kind:row.kind,title:titles[row.kind],preview:row.reason.slice(0,60),createdAt:row.createdAt,read:row.readAt>0})
function createNotificationService({repo,now=Date.now}) {
 async function own(u,id) {
  member(u);if(!identifier(id)) fail('NOT_FOUND')
  const row=await repo.get(collection,id)
  if(!row || row.recipientUid!==u.uid) fail('NOT_FOUND')
  return row
 }
 async function target(row) {
  const post=await repo.get('fy-community-posts',row.postId)
  if(!post || ['removed','deleted'].includes(post.status)) return null
  const version=row.revisionId ? await repo.get('fy-community-versions',row.revisionId) : null
  if(row.commentId) {
   const comment=await repo.get('fy-community-comments',row.commentId)
   const publicVersion=post.publicRevision ? await repo.get('fy-community-versions',post.publicRevision) : null
   if(comment?.uid!==row.recipientUid || comment.postId!==row.postId || comment.status!=='public' || post.status!=='public' || publicVersion?.status!=='approved') return null
   return {postId:row.postId,revisionId:post.publicRevision,commentId:row.commentId,preview:false}
  }
  if(post.uid!==row.recipientUid || version?.uid!==row.recipientUid || version.postId!==post._id) return null
  return {postId:row.postId,revisionId:row.revisionId,commentId:'',preview:true}
 }
 return {
  async notificationsList(u,p={}) { member(u);validateCursor(p.cursor);const rows=await repo.page(collection,{recipientUid:u.uid},{field:'order',before:p.cursor||null,size:21});return {items:rows.slice(0,20).map(view),next:rows.length>20?rows[19].order:''} },
  async notificationsSummary(u) { member(u);return {unread:await repo.count(collection,{recipientUid:u.uid,readAt:0})} },
  async notificationDetail(u,p) { const row=await own(u,p.id);return {...view(row),reason:row.reason,target:await target(row)} },
  async notificationRead(u,p) { member(u);return repo.tx(async db=>{await markNotificationRead(db,u.uid,p.id,now());return {}}) }
 }
}
module.exports={createNotificationService,writeNotification,markNotificationRead,notificationId}
