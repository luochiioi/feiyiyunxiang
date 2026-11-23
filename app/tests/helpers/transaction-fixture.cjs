const { createRepository } = require('../../uniCloud-alipay/cloudfunctions/fy-api/repository')
function transactionFixture() {
 const rows=new Map();let failNotification=false,loseResponse=false,conflicts=0
 function database(snapshot,writes=null) {
  return {command:{lt:v=>({lt:v}),gt:v=>({gt:v}),in:v=>({in:v})},collection(name){return {
   doc(id){const path=name+'/'+id;return {async get(){const value=writes?.get(path)??snapshot.get(path);return {data:value?{...structuredClone(value),_id:id}:null}},async set(value){if(name==='fy-notifications'&&failNotification){failNotification=false;throw Error('NOTIFICATION_FAILED')};(writes??snapshot).set(path,structuredClone(value))}}},
   where(filter){let field='_id',direction='asc',size=100;const query={orderBy(f,d){field=f;direction=d;return query},limit(n){size=n;return query},async get(){const data=[...new Map([...snapshot,...(writes??[])])].filter(([k])=>k.startsWith(name+'/')).map(([k,v])=>({...structuredClone(v),_id:k.slice(name.length+1)})).filter(row=>Object.entries(filter).every(([k,v])=>v&&typeof v==='object'?(v.in?v.in.includes(row[k]):v.lt?row[k]<v.lt:row[k]>v.gt):row[k]===v));data.sort((a,b)=>String(a[field]).localeCompare(String(b[field]))*(direction==='desc'?-1:1));return {data:data.slice(0,size)}},async count(){return {total:(await query.limit(Infinity).get()).data.length}}};return query}
  }}}
 }
 const db={...database(rows),async startTransaction(){const snapshot=new Map(rows),writes=new Map();return {...database(snapshot,writes),async commit(){for(const path of writes.keys())if(snapshot.get(path)!==rows.get(path)){conflicts++;throw Error('WRITE_CONFLICT')};for(const [k,v]of writes)rows.set(k,v);if(loseResponse){loseResponse=false;throw Error('RESPONSE_LOST')}},async rollback(){}}}}
 return {repo:createRepository(db),rows,failNextNotification:()=>failNotification=true,loseNextResponse:()=>loseResponse=true,conflicts:()=>conflicts}
}
module.exports={transactionFixture}
