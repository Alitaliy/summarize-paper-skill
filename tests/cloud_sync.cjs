// PostgreSQL RPC integration, using synthetic content only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const data = require('../docs/data-model.js');
const cloud = require('../docs/cloud-data.js');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
async function database() {
  const db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}'),('${other}');`);
  for (const file of ['001_supabase.sql','002_cloud_sync.sql']) await db.exec(fs.readFileSync(`${__dirname}/../migrations/${file}`, 'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
  return db;
}
const paper = id => data.preparePaper({ id, title: `Source ${id}`, year:'2025', starred:false, rows:[{summary:'Claim'}],
  reference_groups:[{ direction:'Methods',references:[{title:'Shared paper',doi:'10.1234/shared'}, {title:'Shared paper',doi:'10.1234/shared'}] }] });
async function run() {
  const db = await database();
  const rpc = async (name, args = []) => (await db.query(`select public.paper_library_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
  const commit = (revision, payload, id = randomUUID()) => rpc('commit',[revision,id,payload]);
  try {
    const empty = data.backup([],{}), full = data.backup([paper('a'),paper('b')],{});
    const id=randomUUID(), payload=cloud.delta(empty,full);
    assert.equal(await commit(0,payload,id),1);
    assert.equal(await commit(0,payload,id),1, 'Retry after a lost response is idempotent');
    await assert.rejects(commit(0,{...payload,counts:{}},id),/operation_payload_mismatch/);
    assert.deepEqual((await rpc('read_papers',[1,['a','b']])),full.papers,'Cloud read preserves raw groups/references');
    const analysis=await rpc('analysis',[1,'','',20,0]);
    assert.equal(analysis.items[0].cited_by,2,'Four records count as two different source papers');
    assert.equal(analysis.directions[0].edges,2);
    const star={kind:'stars',stars:[{id:'a',starred:true}]};
    assert.equal(await commit(1,star),2);
    assert.equal((await rpc('read_papers',[2,['a']]))[0].starred,true);
    await assert.rejects(commit(1,{kind:'stars',stars:[{id:'b',starred:true}]}),/cloud_revision_conflict/);
    await assert.rejects(rpc('pull',[1,0,'']),/cloud_revision_conflict/);
    full.papers[0].starred=true;
    const shorter=data.backup([full.papers[1]],{});
    const bad=cloud.delta(full,shorter); bad.counts.references=999;
    await assert.rejects(commit(2,bad),/count_mismatch/);
    assert.equal((await rpc('status')).papers,2,'A failed projection rolls back all tables');
    assert.equal(await commit(2,cloud.delta(full,shorter)),3);
    assert.ok((await rpc('pull',[3,2,''])).changes.some(c=>c.paper_id==='a'&&c.deleted),'Deletions have durable tombstones');
    const revised=data.clone(shorter); revised.analysis_settings={directions:{Methods:'Models'}};
    assert.equal(await commit(3,cloud.delta(shorter,revised)),4);
    assert.equal((await rpc('analysis',[4,'Models','',20,0])).items[0].cited_by,1);
    // Foreign owner values in incoming rows never override the authenticated owner.
    const mergedBase=data.backup([...revised.papers,paper('c')],revised.analysis_settings);
    const forged=cloud.delta(revised,mergedBase);
    forged.tables.papers.puts.forEach(row=>row.owner_id=other);
    assert.equal(await commit(4,forged),5);
    const merged=data.clone(mergedBase); merged.papers.forEach(p=>p.doi='10.1234/same-source');
    assert.equal(await commit(5,cloud.delta(mergedBase,merged)),6);
    assert.equal((await rpc('analysis',[6,'','',20,0])).items[0].cited_by,1,'Moving source memberships preserves references and deduplicates source papers');
    assert.equal((await rpc('status')).references,4);
    assert.equal(await commit(6,cloud.delta(merged,mergedBase)),7);
    assert.equal((await rpc('analysis',[7,'','',20,0])).items[0].cited_by,2,'Undo source reconciliation restores distinct counts');
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await rpc('status')).papers,0);
    assert.deepEqual(await rpc('read_papers',[0,['a','b','c']]),[]);
    await assert.rejects(commit(0,star),/paper_missing/);
    await db.exec('reset role; set role anon;');
    for(const [name,args] of [['status',[]],['pull',[0,0,'']],['read_papers',[0,[]]],['commit',[0,randomUUID(),star]],['analysis',[0,'','',20,0]]])
      await assert.rejects(rpc(name,args),/permission denied/);
    console.log('Cloud sync SQL: atomic deltas, stars, retries, conflicts, tombstones, raw round-trip, rankings and account isolation passed.');
  } finally { await db.close(); }
}
module.exports={database,paper,owner,other};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
