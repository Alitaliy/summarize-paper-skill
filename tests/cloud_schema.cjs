// Execute the prepared PostgreSQL schema locally. auth.* is a test-only Supabase stand-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const data = require('../docs/data-model.js');
const migration = require('../docs/migration.js');
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${owner}'), ('${other}');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/001_supabase.sql'), 'utf8'));
    const paper = id => data.preparePaper({ id, title: `Source title ${id}`, year: '2025', rows: [{ summary: 'Claim' }], reference_groups: [
      { direction: 'Methods', references: [{ title: 'Shared reference method', doi: '10.1234/shared', year: '2024', citation: 'Alternative bibliography spelling' }, { title: 'Shared reference method', doi: '10.1234/shared', year: '2024' }] },
      { direction: 'Evaluation', references: [{ title: 'Shared reference method', doi: '10.1234/shared', year: '2024' }] },
    ] });
    const bundle = migration.build(data.backup([paper('a'), paper('b')], {}));
    const insert = async (table, row, user) => {
      const record = { owner_id: user, ...row }, keys = Object.keys(record);
      await db.query(`insert into public.paper_library_${table} (${keys.map(k => '"' + k + '"').join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        keys.map(key => typeof record[key] === 'object' ? JSON.stringify(record[key]) : record[key]));
    };
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    for (const [table, rows] of Object.entries(bundle.tables)) for (const row of rows) await insert(table, row, owner);
    const rank = await db.query('select * from public.paper_library_ranking()');
    assert.equal(Number(rank.rows[0].cited_by), 2, 'Six occurrences still count as two source papers');
    assert.equal(Number((await db.query("select * from public.paper_library_ranking('Evaluation')")).rows[0].cited_by), 2);
    assert.equal((await db.query("select * from public.paper_library_ranking('', 'Alternative bibliography')")).rows.length, 1);
    assert.equal((await db.query("select * from public.paper_library_ranking('', '', 20, 1)")).rows.length, 0);
    const directions = (await db.query('select * from public.paper_library_directions()')).rows;
    assert.equal(directions.length, 2);
    assert.ok(directions.every(row => Number(row.works) === 1 && Number(row.sources) === 2 && Number(row.edges) === 2));
    await assert.rejects(insert('papers', { id: 'forged', position: 0, data: { id: 'forged' } }, other), /row-level security/i);
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    assert.equal((await db.query('select * from public.paper_library_ranking()')).rows.length, 0, 'Second account cannot read first account rankings');
    assert.equal((await db.query('select * from public.paper_library_directions()')).rows.length, 0);
    for (const table of [...Object.keys(bundle.tables), 'state']) assert.equal((await db.query(`select * from public.paper_library_${table}`)).rows.length, 0);
    assert.equal((await db.query('delete from public.paper_library_papers returning id')).rows.length, 0, 'Second account cannot delete first account data');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.paper_library_papers'), /permission denied/i);
    await assert.rejects(db.query('select * from public.paper_library_ranking()'), /permission denied/i);
    console.log('Prepared cloud schema: PostgreSQL execution, relational import, unique-source rankings, pagination and account isolation passed.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
