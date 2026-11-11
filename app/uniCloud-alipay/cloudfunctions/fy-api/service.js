const { createHash } = require('node:crypto')
const { validateCulture, cultureSummary, completedActivities } = require('./culture')
const { createCultureService } = require('./culture-service')
const fail = code => { throw new Error(code) }
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const text = (v, max=120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v)
const coord = (lat,lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180
const adminOnly = u => { if (!u?.admin) fail('FORBIDDEN') }
function distance(a,b) {
  const rad = v => v*Math.PI/180
  const dlat=rad(b.latitude-a.latitude), dlng=rad(b.longitude-a.longitude)
  return 6371000*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlng/2)**2))
}
function validateDraft(p) {
  if (!id(p.id)||!text(p.name)||!text(p.description,2000)||!text(p.region)||!Number.isInteger(p.revision)||p.revision<0||typeof p.testOnly!=='boolean') fail('INVALID_CONTENT')
  if (!p.museum||!text(p.museum.name)||!text(p.museum.description,2000)) fail('INVALID_MUSEUM')
  if (!p.viewport||!coord(p.viewport.latitude,p.viewport.longitude)||!Number.isFinite(p.viewport.scale)||p.viewport.scale<5||p.viewport.scale>20) fail('INVALID_VIEWPORT')
  if (!Array.isArray(p.nodes)||p.nodes.length<1||p.nodes.length>30) fail('INVALID_NODES')
  const ids=new Set()
  const nodes=p.nodes.map(n=>{
    if (!id(n.id)||ids.has(n.id)||!text(n.title)||!text(n.description,2000)||!coord(n.latitude,n.longitude)||!Number.isFinite(n.radius)||n.radius<10||n.radius>500) fail('INVALID_NODE')
    ids.add(n.id)
    return {id:n.id,title:n.title,description:n.description,latitude:n.latitude,longitude:n.longitude,radius:n.radius}
  })
  const value = {id:p.id,name:p.name,description:p.description,region:p.region,testOnly:p.testOnly,museum:{name:p.museum.name,description:p.museum.description},viewport:{latitude:p.viewport.latitude,longitude:p.viewport.longitude,scale:p.viewport.scale},nodes}
  if (p.culture != null) value.culture = validateCulture(p.culture, ids)
  return value
}
function routeView(v, version) {
  return {id:v.id,name:v.name,region:v.region,description:v.description,museum:v.museum,testOnly:v.testOnly,viewport:v.viewport,nodes:v.nodes,version,activities:cultureSummary(v.culture)}
}
function createService({repo,now=Date.now,allowTestContent=true}) {
  async function owned(db,u,runId) {
    if (!u?.uid || !id(runId)) fail('NOT_FOUND')
    const run=await db.get('fy-runs',runId)
    if (!run||run.uid!==u.uid) fail('NOT_FOUND')
    return run
  }
  async function binding(db,u,p) {
    if (!id(p.requestId)||!id(p.nodeId)) fail('INVALID_REQUEST')
    const run=await owned(db,u,p.runId)
    const node=run.snapshot.nodes.find(n=>n.id===p.nodeId)
    if (!node) fail('NOT_FOUND')
    return {run,node}
  }
  async function runProgress(u, runId, run) {
    const checks = await repo.list('fy-checkins', { runId, uid: u.uid })
    const completed = checks.map(check => check.nodeId)
    const snapshot = routeView(run.snapshot, run.version)
    const activities = completedActivities(run)
    return { runId, routeId: run.routeId, version: run.version, snapshot, completed, activities,
      done: completed.length + activities.length, total: snapshot.nodes.length + snapshot.activities.length }
  }
  return {
    ...createCultureService({ repo, owned, key, now }),
    async drafts(u) { adminOnly(u); return repo.list('fy-drafts',{}) },
    async saveDraft(u,p) {
      adminOnly(u); const value=validateDraft(p)
      return repo.tx(async db=>{
        const old=await db.get('fy-drafts',p.id)
        if ((old?.revision??0)!==p.revision) fail('CONFLICT')
        await db.put('fy-drafts',p.id,{...value,revision:p.revision+1,updatedAt:now(),updatedBy:u.uid})
        return {revision:p.revision+1}
      })
    },
    async publish(u,p) {
      adminOnly(u)
      if (!id(p.id)||!Number.isInteger(p.revision)) fail('INVALID_REQUEST')
      return repo.tx(async db=>{
        const draft=await db.get('fy-drafts',p.id)
        if (!draft||draft.revision!==p.revision) fail('CONFLICT')
        validateDraft(draft)
        if (draft.testOnly&&!allowTestContent) fail('TEST_CONTENT_DISABLED')
        if (!draft.testOnly && draft.contentVerified!==true) fail('CONTENT_REVIEW_REQUIRED')
        const version=key(p.id,p.revision)
        await db.put('fy-versions',version,{...draft,publishedAt:now(),publishedBy:u.uid})
        await db.put('fy-routes',p.id,{version,enabled:true,testOnly:draft.testOnly})
        await db.put('fy-audit',key(p.id,p.revision),{action:'publish',routeId:p.id,version,uid:u.uid,at:now()})
        return {version}
      })
    },
    async catalog() {
      const routes=await repo.list('fy-routes',{enabled:true}), result=[]
      for (const r of routes) {
        if (r.testOnly&&!allowTestContent) continue
        const v=await repo.get('fy-versions',r.version)
        if(v) result.push(routeView(v, r.version))
      }
      return result
    },
    async start(u,p) {
      if (!u?.uid||!id(p.routeId)||!id(p.requestId)) fail('INVALID_REQUEST')
      const runId=key(u.uid,'start',p.requestId)
      return repo.tx(async db=>{
        const old=await db.get('fy-runs',runId)
        if (old) { if(old.routeId!==p.routeId) fail('REQUEST_CONFLICT'); return {id:runId} }
        const route=await db.get('fy-routes',p.routeId)
        if (!route?.enabled||(route.testOnly&&!allowTestContent)) fail('NOT_FOUND')
        const snapshot=await db.get('fy-versions',route.version)
        if (!snapshot) fail('NOT_FOUND')
        await db.put('fy-runs',runId,{uid:u.uid,routeId:p.routeId,version:route.version,snapshot,purpose:'solo',createdAt:now(),revision:0})
        return {id:runId}
      })
    },
    async mediaBinding(u,p) { return binding(repo,u,p) },
    // Only called with server-generated metadata after authenticated byte upload.
    async registerMedia(u,p) {
      if (!text(p.fileID, 2048)) fail('MEDIA_UPLOAD_FAILED')
      await binding(repo,u,p)
      await repo.put('fy-media',p.id,{uid:u.uid,runId:p.runId,nodeId:p.nodeId,requestId:p.requestId,fileID:p.fileID,mime:p.mime,createdAt:now(),used:false})
      return {id:p.id}
    },
    async readMedia(u,p) {
      if(!id(p.id)) fail('NOT_FOUND')
      const m=await repo.get('fy-media',p.id)
      if (!m||m.uid!==u?.uid) fail('NOT_FOUND')
      if (!text(m.fileID, 2048)) fail('PHOTO_UNAVAILABLE')
      return m
    },
    async checkin(u,p) {
      return repo.tx(async db=>{
        const {run,node}=await binding(db,u,p)
        const cid=key(p.runId,p.nodeId)
        const requestKey=key(u.uid,'checkin',p.requestId)
        const request=await db.get('fy-requests',requestKey)
        if(request&&(request.runId!==p.runId||request.nodeId!==p.nodeId)) fail('REQUEST_CONFLICT')
        const old=await db.get('fy-checkins',cid)
        if (old) return {id:cid,alreadyCompleted:true}
        if (!coord(p.latitude,p.longitude)) fail('INVALID_LOCATION')
        if (distance(node,p)>node.radius) fail('OUTSIDE_RANGE')
        if(typeof p.note!=='undefined'&&(typeof p.note!=='string'||p.note.length>1000)) fail('INVALID_NOTE')
        const media= id(p.mediaId) ? await db.get('fy-media',p.mediaId) : null
        if (!media||media.uid!==u.uid||media.runId!==p.runId||media.nodeId!==p.nodeId||media.requestId!==p.requestId||media.used) fail('MEDIA_MISMATCH')
        if (!text(media.fileID, 2048)) fail('PHOTO_UNAVAILABLE')
        const record={uid:u.uid,runId:p.runId,routeId:run.routeId,version:run.version,nodeId:p.nodeId,title:node.title,mediaId:p.mediaId,note:p.note??'',requestId:p.requestId,createdAt:now()}
        await db.put('fy-checkins',cid,record)
        await db.put('fy-requests',requestKey,{runId:p.runId,nodeId:p.nodeId,checkinId:cid})
        await db.put('fy-diary',cid,record)
        await db.put('fy-media',p.mediaId,{...media,used:true})
        // A shared run write forces conflict on concurrent same-run updates.
        await db.put('fy-runs',p.runId,{...run,revision:run.revision+1})
        return {id:cid,alreadyCompleted:false}
      })
    },
    async progress(u,p) {
      return runProgress(u, p.runId, await owned(repo, u, p.runId))
    },
    async routeProgress(u, p) {
      if (!u?.uid) fail('AUTH_REQUIRED')
      if (!id(p.routeId)) fail('INVALID_ROUTE')
      const runs = await repo.list('fy-runs', { uid: u.uid, routeId: p.routeId })
      const run = runs.sort((a, b) => b.createdAt - a.createdAt)[0]
      return run == null ? null : runProgress(u, run._id, run)
    },
    async nodeRecord(u, p) {
      if (!u?.uid) fail('AUTH_REQUIRED')
      if (!id(p.routeId) || !id(p.nodeId)) fail('INVALID_NODE')
      const records = await repo.list('fy-diary', { uid: u.uid, routeId: p.routeId, nodeId: p.nodeId })
      const record = records.sort((a, b) => b.createdAt - a.createdAt)[0]
      if (!record) return null
      const { title, createdAt, note, mediaId } = record
      return { title, createdAt, note, mediaId }
    },
    async diary(u) { if (!u?.uid) fail('AUTH_REQUIRED'); return (await repo.list('fy-diary',{uid:u.uid})).sort((a,b)=>b.createdAt-a.createdAt) }
  }
}
module.exports={createService,key,distance}
