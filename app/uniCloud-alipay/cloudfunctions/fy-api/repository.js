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
  function queryFilter(query) {
    return Object.fromEntries(Object.entries(query).map(([name, value]) =>
      [name, Array.isArray(value) ? database.command.in(value) : value]))
  }
  return {...access(database),async page(c, query, {field, before, after, size}) {
    const command = database.command
    const filter = queryFilter(query)
    if (before) filter[field] = command.lt(before)
    if (after) filter[field] = command.gt(after)
    const { data } = await database.collection(c).where(filter)
      .orderBy(field, field === '_id' ? 'asc' : 'desc').limit(size).get()
    return data
  },async count(c, query) {
    const { total } = await database.collection(c).where(queryFilter(query)).count()
    return total
  },async tx(fn) {
    // Retry database transaction conflicts only; every attempt rereads server state.
    for(let attempt=0;attempt<3;attempt++) {
      const tx=await database.startTransaction()
      try { const result=await fn(access(tx)); await tx.commit(); return result }
      catch(e) { await tx.rollback().catch(()=>{}); if(attempt===2||!(/conflict|WRITE_CONFLICT|TRANSACTION_CONFLICT/i.test(String(e.code)+' '+String(e.message)))) throw e }
    }
  }}
}
module.exports={createRepository}
