const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {IDBObjectStore}=require('fake-indexeddb');
const {session,descendants}=require('./app_storage.cjs');
const {database,owner}=require('./cloud_sync.cjs');
async function run(){
  const db=await database();
  const client={auth:{async getSession(){return {data:{session:{user:{id:owner},access_token:'test-token'}}};}},rpc(name,args){return {
    setHeader(){return this;},async abortSignal(){try{return {data:(await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(',')}) as r`,Object.values(args))).rows[0].r};}catch(e){return {error:e};}}};}};
  const app=await session(new Map());const {context,elements,api}=app;
  for(const file of ['cloud-data.js','cloud-store.js'])vm.runInContext(fs.readFileSync(`${__dirname}/../docs/${file}`,'utf8'),context);
  context.AbortController=AbortController;
  const local=api.getRepository();let store;
  const settle=()=>vm.runInContext('mutationQueue',context);
  try{
    const original=api.normalizePaper({title:'An imported source',starred:true,rows:[{dimension:'研究目的',summary:'Test summary'}],
      reference_groups:[{direction:'Methods',references:[{title:'One referenced paper',doi:'10.1234/ref'}]}]});
    await api.mergePapers([original],'test');
    const before=await local.read();
    store=await context.CloudStore.open({client,userId:owner,project:'test',normalizePaper:api.normalizePaper});
    await store.initialize();context.nextRepository=store;
    await vm.runInContext('switchRepository(nextRepository)',context);
    assert.equal(api.getLibrary().length,0);
    await api.mergePapers(before.papers,'migration',{settings:before.analysis_settings});
    await store.sync();await settle();
    assert.equal(api.getLibrary().length,1);assert.equal(api.getLibrary()[0].starred,true);
    const star=descendants(elements.paperGrid).find(e=>e.className.includes('star-button'));
    let builds=0;const build=context.CitationIndex.build;context.CitationIndex.build=(...args)=>{builds++;return build(...args);};
    await star.fire('click');assert.equal(star.textContent,'☆');
    let fullReads=0;const getAll=IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll=function(...args){if(this.name==='papers')fullReads++;return getAll.apply(this,args);};
    try {
      await store.sync();await settle();
      assert.equal(fullReads,0,'Acknowledgement and app subscription do not read/normalize the full library');
    }finally{IDBObjectStore.prototype.getAll=getAll;}
    assert.equal(builds,0,'Star and sync acknowledgement do not rebuild citation index');
    const rows=(await db.query('select public.paper_library_read_papers($1,$2) as r',[(await store.read()).sync.remoteRevision,[original.id]])).rows[0].r;
    assert.equal(rows[0].starred,false);assert.equal(rows[0].reference_groups[0].references.length,1);
    assert.equal((await local.read()).papers[0].starred,true,'Original local library is retained');
    context.nextRepository=local;await vm.runInContext('switchRepository(nextRepository)',context);
    assert.equal(api.getLibrary()[0].starred,true);
    console.log('Cloud app: original library retained, account switch, migration, remote star persistence and zero star index rebuilds passed.');
  }finally{store?.close();local.close();await db.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
