const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const paper = { id: 'paper-a', title: 'Test paper', starred: true, rows: [{ summary: 'Evidence', dimension: 'Purpose' }], reference_groups: [{ direction: 'Methods', references: [{ title: 'Referenced scientific paper', year: '2024' }] }] };
function session(storage = new Map(), indexedDB = new IDBFactory()) {
  const context = { indexedDB, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  vm.createContext(context);
  for (const file of ['data-model.js', 'library-store.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8'), context);
  return context;
}
(async () => {
  const old = JSON.stringify([paper]), storage = new Map([['summarize-paper-library-v2', old], ['summarize-paper-citation-settings-v1', JSON.stringify({ version: 1, directions: { Methods: '方法' }, merges: [] })]]);
  const context = session(storage), store = await context.LibraryStore.open();
  let state = await store.read();
  assert.equal(store.backend, 'indexeddb');
  assert.equal(state.papers[0].starred, true);
  assert.ok(state.papers[0].reference_groups[0].references[0].record_id);
  assert.equal(storage.get('summarize-paper-library-v2'), old, 'Old data is retained verbatim');
  const puts = [], originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, ...args) { puts.push([this.name, value.id]); return originalPut.call(this, value, ...args); };
  await store.commit({ puts: [{ ...state.papers[0], starred: false }], expectedRevision: state.revision });
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(puts.filter(([name]) => name === 'papers'), [['papers', 'paper-a']], 'A star writes exactly one paper record');
  const reopened = await session(storage, context.indexedDB).LibraryStore.open();
  state = await reopened.read();
  assert.equal(state.papers[0].starred, false, 'Fresh session reads committed star');
  await assert.rejects(store.commit({ deletes: ['paper-a'], expectedRevision: 0 }), /其他标签页/);
  assert.equal((await store.read()).papers.length, 1, 'Stale-tab write cannot erase newer data');
  const before = JSON.stringify(await store.read());
  IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name === 'meta') throw new Error('Injected disk failure');
    return originalPut.call(this, value, ...args);
  };
  await assert.rejects(store.commit({ puts: [{ ...state.papers[0], starred: true }], settings: { test: true }, expectedRevision: state.revision }), /disk failure/);
  IDBObjectStore.prototype.put = originalPut;
  assert.equal(JSON.stringify(await store.read()), before, 'Aborted transaction rolls back papers, settings and revision together');
  const writes = await Promise.allSettled([store.commit({ puts: [{ ...state.papers[0], starred: true }], expectedRevision: state.revision }),
    reopened.commit({ deletes: ['paper-a'], expectedRevision: state.revision })]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1, 'Only one competing revision can commit');
  store.close(); reopened.close();

  const broken = new Map([['summarize-paper-library-v2', '{broken']]);
  await assert.rejects(session(broken).LibraryStore.open());
  assert.equal(broken.get('summarize-paper-library-v2'), '{broken');
  broken.set('summarize-paper-library-v2', old);
  const repaired = await session(broken).LibraryStore.open(); repaired.close();

  const fallbackContext = session(new Map([['summarize-paper-library-v2', old]]), null);
  const fallback = await fallbackContext.LibraryStore.open();
  state = await fallback.read();
  fallbackContext.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(fallback.commit({ deletes: ['paper-a'], expectedRevision: state.revision }), /Quota/);
  assert.equal((await fallback.read()).papers.length, 1, 'Fallback quota failure leaves last complete snapshot intact');
  fallback.close();
  console.log('Storage: legacy upgrade, row writes, reload, revision races, atomic rollback, corruption and quota failures passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
