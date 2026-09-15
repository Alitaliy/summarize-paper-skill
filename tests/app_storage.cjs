// Run the real app, store and analysis controllers together; no browser or personal data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.attributes = {};
    this.className = ''; this.value = ''; this.hidden = false; this._text = '';
    this.classList = { add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false), toggle: (name, value) => {
      const names = new Set(this.className.split(' ').filter(Boolean)); value ? names.add(name) : names.delete(name); this.className = [...names].join(' ');
    } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelectorAll(tag) { return descendants(this).filter(child => child.tagName === tag); }
  fire(type, extra = {}) { return this.listeners[type]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); }
  close() {} showModal() {} scrollIntoView() {}
}
const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
const original = { id: 'paper-a', title: 'Original source paper', year: '2025', doi: '10.1234/source', starred: true,
  rows: [{ dimension: '研究目的', summary: 'Summary claim', basis_type: '原文明确' }, { dimension: '主要贡献', summary: 'Second claim' }],
  reference_groups: [{ direction: 'Methods', references: [{ title: 'Referenced method title', year: '2024', ref_id: '[1]' }] }] };
async function session(storage, indexedDB = new IDBFactory()) {
  const elements = Object.fromEntries([...fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const callbacks = {};
  const context = { indexedDB, crypto: require('node:crypto').webcrypto, URL, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { querySelector: selector => elements[selector.slice(1)], getElementById: id => elements[id], createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
      addEventListener: (type, fn) => { callbacks[type] = fn; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    location: { hash: '#/library' }, confirm: () => true,
    addEventListener: (type, fn) => { callbacks[type] = fn; }, removeEventListener() {} };
  context.window = context;
  vm.createContext(context);
  for (const file of ['data-model.js', 'library-store.js', 'citation-index.js', 'migration.js', 'analytics.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8'), context);
  await callbacks.DOMContentLoaded();
  const api = vm.runInContext('({normalizePaper, mergePapers, loadLibrary, filterRows, scanWatchedDirectory, getLibrary: () => library, getSettings: () => analysisSettings, getRepository: () => repository})', context);
  return { context, elements, api, callbacks };
}
if (require.main === module) (async () => {
  const storage = new Map([['summarize-paper-library-v2', JSON.stringify([original])]]);
  const { context, elements, api, callbacks } = await session(storage);
  const star = descendants(elements.paperGrid).find(element => element.className.includes('star-button'));
  assert.equal(star.textContent, '★');
  const oldPut = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function(...args) { writes++; return oldPut.apply(this, args); };
  await api.mergePapers([api.normalizePaper(original)], 'test');
  assert.equal(writes, 0, 'No-change imports do not write or rerender');
  await star.fire('click');
  assert.equal(star.textContent, '☆');
  assert.equal(writes, 2, 'Only one paper and the transaction revision are written');
  IDBObjectStore.prototype.put = function(...args) { if (this.name === 'meta') throw new Error('disk full'); return oldPut.apply(this, args); };
  await star.fire('click');
  assert.equal(star.textContent, '☆');
  assert.equal(api.getLibrary()[0].starred, false);
  assert.equal(elements.storageStatus.hidden, false);
  assert.ok(elements.storageStatus.textContent.includes('未保存'));
  IDBObjectStore.prototype.put = oldPut;
  await api.loadLibrary();
  assert.equal(api.getLibrary()[0].starred, false);
  const refId = api.getLibrary()[0].reference_groups[0].references[0].record_id;
  const enriched = { ...original, title: 'Corrected source title', starred: false,
    reference_groups: [{ direction: 'Methods', references: [{ ...original.reference_groups[0].references[0], doi: '10.1234/reference' }] }] };
  await api.mergePapers([api.normalizePaper(enriched)], 'test');
  assert.equal(api.getLibrary().length, 1, 'DOI matches a source after title correction');
  assert.equal(api.getLibrary()[0].id, 'paper-a');
  assert.equal(api.getLibrary()[0].reference_groups[0].references[0].record_id, refId);
  assert.equal(elements.storageStatus.hidden, true);

  context.searchCalls = 0;
  vm.runInContext('const oldReferenceSearch = referenceSearchText; referenceSearchText = paper => { searchCalls++; return oldReferenceSearch(paper); }; filters.query = "missing";', context);
  api.filterRows(api.getLibrary()[0].rows, api.getLibrary()[0]);
  api.filterRows(api.getLibrary()[0].rows, api.getLibrary()[0]);
  assert.equal(context.searchCalls, 1, 'Reference text is cached once per paper, not once per row/query');
  const oldBuild = context.CitationIndex.build; let builds = 0;
  context.CitationIndex.build = (...args) => { builds++; return oldBuild(...args); };
  context.location.hash = '#/citations'; callbacks.hashchange();
  context.CitationAnalytics.refresh(); context.location.hash = '#/library'; callbacks.hashchange();
  context.location.hash = '#/citations'; callbacks.hashchange();
  assert.equal(builds, 0, 'Navigation reuses the model already built after import');
  assert.ok(!descendants(elements.citationSelection).some(element => element.id === 'mergeCitation'), 'Collapsed merge controls do not allocate thousands of options');
  const ranking = elements.citationRanking.children[0], chart = elements.directionChart.children[0];
  await ranking.fire('click');
  assert.equal(elements.citationRanking.children[0], ranking, 'Selection preserves ranking nodes');
  assert.equal(elements.directionChart.children[0], chart, 'Selection preserves direction chart');

  // Directory scan: only the changed preferred source/companion group gets re-read.
  const files = new Map(), reads = { a: 0, b: 0, md: 0 };
  function file(name, text, key, stamp = 1) { return { name, size: text.length, lastModified: stamp, async text() { reads[key]++; return text; } }; }
  files.set('a/summary.json', file('summary.json', JSON.stringify(original), 'a'));
  files.set('b/summary.json', file('summary.json', JSON.stringify({ ...original, id: 'paper-b', title: 'Other source', doi: '10.1234/other-source' }), 'b'));
  files.set('a/paper_summary.md', file('paper_summary.md', '# Companion', 'md'));
  context.testFiles = files;
  vm.runInContext('watchedDirectoryHandle = { name: "test" }; walkSummaryOutputFiles = async function* () { for (const [path, file] of testFiles) yield {path, file}; };', context);
  await api.scanWatchedDirectory({ showToast: false });
  const firstReads = { ...reads };
  await api.scanWatchedDirectory({ showToast: false }); assert.deepEqual(reads, firstReads);
  files.set('a/paper_summary.md', file('paper_summary.md', '# Changed companion', 'md', 2));
  await api.scanWatchedDirectory({ showToast: false });
  assert.equal(reads.b, firstReads.b, 'Unchanged other paper is not reparsed');
  assert.equal(reads.a, firstReads.a + 1); assert.equal(reads.md, firstReads.md + 1);
  const bundle = context.PaperMigration.build(context.PaperData.backup(api.getLibrary(), api.getSettings()));
  assert.equal(context.PaperMigration.restore(bundle).papers.length, 2);
  await elements.clearLibraryButton.fire('click');
  await api.scanWatchedDirectory({ showToast: false });
  assert.equal(api.getLibrary().length, 0, 'Clearing the library does not immediately reimport unchanged watched files');
  api.getRepository().close();
  console.log('App integration: stars, rollback, no-op imports, stable metadata IDs, search/index caching, lazy rendering and incremental watch passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { session, descendants };
