(async () => {
// Exercise the real UI controllers with a minimal DOM and durable storage across fresh sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
assert.match(html, /id="citationLimit"><option value="0">全部文献<\/option>/, 'All cited works are the default ranking view');
class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.className = ''; this.value = ''; this.hidden = false; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  fire(type, extra = {}) { return this.listeners[type]?.({ target: this, preventDefault() {}, ...extra }); }
  querySelectorAll(tagName) { return descendants(this).filter(el => el.tagName === tagName); }
}
function descendants(el) { return el.children.flatMap(child => [child, ...descendants(child)]); }
const byClass = (el, name) => descendants(el).filter(child => child.className.split(' ').includes(name));
const fixture = [
  { id: 'source-a', title: 'First source paper title', year: '2025', reference_status: 'complete', reference_groups: [
    { direction: 'Methods', references: [{ title: 'Shared method with identifier', doi: '10.1234/a', year: '2024', ref_id: '[1]', relation: 'Method foundation', classification_basis: 'Section 2' }] },
    { direction: 'Methods', references: [{ title: 'Other related reference title', doi: '10.1234/b', year: '2023', ref_id: '[2]' }] },
  ] },
  { id: 'source-b', title: 'Second source paper title', year: '2025', reference_status: 'partial', reference_groups: [
    { direction: '方法', references: [{ title: 'Shared method with identifier', doi: '10.1234/a', year: '2024', ref_id: '[9]' }] },
  ] },
];
const store = new Map();
let libraryRevision = 1, saveFails = false;
const library = JSON.parse(JSON.stringify(fixture));
const before = JSON.stringify(library);
function session() {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element('div')]));
  const callbacks = {}, opened = [], messages = [];
  const sandbox = {
    document: { title: '', getElementById: id => elements[id], createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    location: { hash: '#/citations' }, addEventListener: (type, handler) => { callbacks[type] = handler; },
    confirm: () => true, URL,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['citation-index.js', 'analytics.js']) vm.runInContext(fs.readFileSync(path.join(root, 'docs', file), 'utf8'), sandbox);
  sandbox.CitationAnalytics.init({ getLibrary: () => library, getRevision: () => libraryRevision, getSettings: () => JSON.parse(store.get('settings') || '{}'), saveSettings: async value => { if (saveFails) throw new Error('quota'); store.set('settings', JSON.stringify(value)); }, openPaper: id => opened.push(id), notify: message => messages.push(message) });
  return { sandbox, elements, callbacks, opened, messages };
}

function openMerge() { const details = byClass(elements.citationSelection, 'analysis-settings')[0]; details.open = true; details.fire('toggle'); }
let { sandbox, elements, callbacks, opened } = session();
assert.equal(elements.libraryView.hidden, true, 'Direct subpage links must open analytics');
assert.equal(elements.citationsNav.attributes['aria-current'], 'page');
assert.equal(elements.citationRanking.children.length, 2);
assert.equal(byClass(elements.citationSelection, 'selected-metric')[0].textContent, '2篇不同的来源论文');
assert.equal(byClass(elements.citationSelection, 'citation-source').length, 2);
byClass(elements.citationSelection, 'source-open')[0].fire('click');
assert.equal(opened[0], 'source-a', 'Source links open existing paper details');
const graphSource = descendants(elements.citationSelection).find(el => el.attributes.class === 'graph-source');
graphSource.fire('keydown', { key: 'Enter' });
assert.equal(opened[1], 'source-a', 'Graph nodes support keyboard navigation');

elements.citationQuery.value = 'nonexistent'; elements.citationQuery.fire('input');
assert.ok(elements.citationRanking.textContent.includes('没有匹配结果'));
elements.citationReset.fire('click');
assert.equal(elements.citationLimit.value, '0', 'Reset restores the complete ranking');
elements.citationDirection.value = '方法'; elements.citationDirection.fire('change');
assert.equal(elements.citationRanking.children.length, 1);
assert.ok(byClass(elements.citationSelection, 'selected-metric')[0].textContent.includes('1篇来源论文'));
assert.equal(byClass(elements.citationSelection, 'citation-source').length, 1);

// Save a direction alias, then reconstruct an entirely fresh controller from local storage.
const mapping = elements.directionMappings.querySelectorAll('input').find(el => el.dataset.direction === 'Methods');
mapping.value = '方法'; await elements.directionForm.fire('submit');
assert.ok(store.get('settings').includes('Methods'));
({ sandbox, elements, callbacks } = session());
assert.equal(elements.directionChart.children.length, 1, 'Saved direction mapping survives a page reload');
assert.equal(elements.directionMappings.querySelectorAll('input').find(el => el.dataset.direction === 'Methods').value, '方法');

// Merge references shared by the same source: 2 + 1 remains 2, not 3.
openMerge();
const mergeSelect = descendants(elements.citationSelection).find(el => el.id === 'mergeCitation');
mergeSelect.value = mergeSelect.children.find(el => el.value).value;
await descendants(elements.citationSelection).find(el => el.tagName === 'button' && el.textContent === '确认合并').fire('click');
assert.equal(elements.citationRanking.children.length, 1);
assert.equal(byClass(elements.citationSelection, 'selected-metric')[0].textContent, '2篇不同的来源论文');
({ sandbox, elements, callbacks } = session());
assert.equal(elements.citationRanking.children.length, 1, 'Manual merge survives a fresh session');
const exported = JSON.parse(JSON.stringify(sandbox.CitationAnalytics.getSettings()));
openMerge();
await descendants(elements.citationSelection).find(el => el.tagName === 'button' && el.textContent === '撤销最近一次合并').fire('click');
assert.equal(elements.citationRanking.children.length, 2);
await sandbox.CitationAnalytics.importSettings(exported);
assert.equal(elements.citationRanking.children.length, 1, 'Exported settings can be imported again');
assert.equal(JSON.stringify(library), before, 'UI operations must not alter original paper or reference records');

// Navigation, data removal/import refresh, and empty data must stay coherent.
sandbox.location.hash = '#/library'; callbacks.hashchange();
assert.equal(elements.libraryView.hidden, false);
assert.equal(elements.citationsView.hidden, true);
library.splice(0); libraryRevision++;
sandbox.location.hash = '#/citations'; callbacks.hashchange();
assert.ok(elements.citationRanking.textContent.includes('还没有可分析的引用'));
library.push(...JSON.parse(JSON.stringify(fixture))); libraryRevision++;
sandbox.CitationAnalytics.refresh();
assert.equal(elements.citationRanking.children.length, 1);

// Storage failures must not present unsaved mappings as saved changes.
saveFails = true;
const failed = elements.directionMappings.querySelectorAll('input')[0];
failed.value = 'unsaved'; await elements.directionForm.fire('submit');
assert.ok(!JSON.stringify(sandbox.CitationAnalytics.getSettings()).includes('unsaved'));
console.log('Analytics UI: routing, ranking, filtering, graph links, source details, mapping/merge persistence, undo, import, and storage failures passed.');

})().catch(error => { console.error(error); process.exitCode = 1; });
