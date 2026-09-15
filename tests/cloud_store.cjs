const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const { database, paper, owner, other } = require('./cloud_sync.cjs');
const data = require('../docs/data-model.js');
const cloud = require('../docs/cloud-data.js');
async function run() {
  const db = await database();
  let offline=false, loseReply=false, commits=0, sessionOwner=owner;
  const calls=[];
  const client = {
    auth:{async getSession(){return {data:{session:{user:{id:sessionOwner},access_token:'test-token'}}};}},
    rpc(name,args) {
      return { setHeader(name,value){assert.equal(name,'Authorization');assert.equal(value,'Bearer test-token');return this;},async abortSignal() {
        calls.push({name,args});
        if(offline) return {error:{message:'Network unavailable'}};
        try {
          const result=await db.query(`select public.${name}(${Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(',')}) as result`,Object.values(args));
          if(name==='paper_library_commit') {commits++;if(loseReply){loseReply=false;return {error:{message:'Lost response'}};}}
          return {data:result.rows[0].result};
        } catch(e){return {error:{message:e.message,code:e.code}};}
      } };
    }
  };
  const indexedDB=new IDBFactory(), storage=new Map([['summarize-paper-library-v2',JSON.stringify([paper('private-local')])]]);
  const context={ indexedDB,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    crypto:require('node:crypto').webcrypto,AbortController,setTimeout:()=>0,clearTimeout(){},addEventListener(){},removeEventListener(){} };
  vm.createContext(context);
  for(const file of ['data-model.js','citation-index.js','migration.js','library-store.js','cloud-data.js','cloud-store.js'])
    vm.runInContext(fs.readFileSync(`${__dirname}/../docs/${file}`,'utf8'),context);
  const open=async(userId=owner)=>context.CloudStore.open({client,userId,project:'test',normalizePaper:p=>p});
  let a=await open(), b;
  try {
    assert.equal((await a.read()).papers.length,0,'Account cache never adopts local legacy papers');
    await a.initialize();
    let s=await a.read();
    await a.commit({puts:[paper('a'),paper('b')],expectedRevision:s.revision});
    loseReply=true;
    await assert.rejects(a.sync(),/Lost response/);
    assert.equal((await a.read()).sync.queue.length,1);
    s=await a.read();
    await a.commit({puts:[{...s.papers[0],starred:true}],expectedRevision:s.revision});
    const queued=await a.read();
    assert.equal(queued.sync.queue[1].payload.kind,'stars');
    assert.ok(JSON.stringify(queued.sync.queue[1]).length<180,'Star does not duplicate paper/reference content');
    a.close(); a=await open();
    await a.sync();
    assert.equal((await a.read()).sync.remoteRevision,2,'Retry acknowledges revision one then uploads the later star');
    assert.equal((await a.read()).sync.queue.length,0);
    assert.equal(commits,3,'Server accepted one retry without incrementing revision twice');
    b=await open(other); assert.equal((await b.read()).papers.length,0);b.close();
    offline=true;
    s=await a.read();
    await a.commit({deletes:['b'],expectedRevision:s.revision});
    await assert.rejects(a.sync(),/Network/);
    a.close();a=await open();
    assert.equal((await a.read()).papers.length,1,'Offline deletion survives reopening');
    offline=false;await a.sync();
    assert.equal((await a.status()).papers,1);
    // A different device advances the cloud while this device has a queued star.
    s=await a.read();
    await a.commit({puts:[{...s.papers[0],starred:false}],expectedRevision:s.revision});
    const remoteBase=data.backup(s.papers,s.analysis_settings), remoteNext=data.backup([...s.papers,paper('remote')],s.analysis_settings);
    await client.rpc('paper_library_commit',{expected_revision:s.sync.remoteRevision,operation_id:context.crypto.randomUUID(),payload:cloud.delta(remoteBase,remoteNext)}).abortSignal();
    await assert.rejects(a.sync(),/cloud_revision_conflict/);
    assert.equal((await a.read()).sync.queue.length,1,'Conflict keeps local edits');
    assert.equal((await a.read()).papers[0].starred,false);
    await a.resolve('cloud'); await a.sync();
    assert.equal((await a.read()).papers.length,2);
    assert.equal((await a.read()).papers.find(p=>p.id==='a').starred,true);
    // Atomic outbox/cache rollback when local storage fails.
    s=await a.read();const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(args[1]==='sync')throw new Error('Disk full');return originalPut.apply(this,args);};
    try {await assert.rejects(a.commit({deletes:['a'],expectedRevision:s.revision}),/Disk full/);}finally{IDBObjectStore.prototype.put=originalPut;}
    assert.equal((await a.read()).papers.length,2);assert.equal((await a.read()).sync.queue.length,0);
    // Fresh device: bounded manifest/detail reads, then unchanged sync fetches status only.
    const freshContext={...context,indexedDB:new IDBFactory()};vm.createContext(freshContext);
    for(const file of ['data-model.js','citation-index.js','migration.js','library-store.js','cloud-data.js','cloud-store.js'])vm.runInContext(fs.readFileSync(`${__dirname}/../docs/${file}`,'utf8'),freshContext);
    b=await freshContext.CloudStore.open({client,userId:owner,project:'test'});await b.initialize();
    assert.equal((await b.read()).papers.length,2);
    let fullReads=0;const originalGetAll=IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll=function(...args){if(this.name==='papers')fullReads++;return originalGetAll.apply(this,args);};
    try {
      calls.length=0;await b.sync();assert.deepEqual(calls.map(c=>c.name),['paper_library_status']);
      assert.ok((await b.analysis({page_size:20})).items.length>0);
      assert.equal(fullReads,0,'Idle sync and SQL ranking checks do not clone the full library');
    } finally {IDBObjectStore.prototype.getAll=originalGetAll;}
    calls.length=0;sessionOwner=other;
    await assert.rejects(a.sync(),/登录账号/);assert.equal(calls.length,0,'Account switching cannot send another cache under the new login');
    console.log('Cloud store: isolated caches, lost-response retry, edits after retry, refresh/offline recovery, conflicts, atomic outbox and incremental reads passed.');
  } finally {a.close();b?.close();await db.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
