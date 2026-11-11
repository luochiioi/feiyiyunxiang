function createRepository(database) {
  function access(db) {
    return {
      async get(c, id) {
        const { data } = await db.collection(c).doc(id).get()
        // The cloud transaction API returns one document or null.
        return Array.isArray(data) ? data[0] ?? null : data ?? null
      },
      async put(c,id,value) { const {_id,...safe}=value; await db.collection(c).doc(id).set(safe) },
      async list(c,q) { const {data}=await db.collection(c).where(q).limit(100).get(); return data }
    }
  }
  return {...access(database),async tx(fn) {
    // Retry database transaction conflicts only; every attempt rereads server state.
    for(let attempt=0;attempt<3;attempt++) {
      const tx=await database.startTransaction()
      try { const result=await fn(access(tx)); await tx.commit(); return result }
      catch(e) { await tx.rollback().catch(()=>{}); if(attempt===2||!(/conflict|WRITE_CONFLICT|TRANSACTION_CONFLICT/i.test(String(e.code)+' '+String(e.message)))) throw e }
    }
  }}
}
module.exports={createRepository}
