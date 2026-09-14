const assert = require('node:assert/strict');
const index = require('../docs/citation-index.js');
const ref = (title, extra = {}) => ({ title, authors: 'A. Researcher', year: '2024', ...extra });
const paper = (id, groups, extra = {}) => ({ id, title: `Source paper ${id}`, year: '2025', reference_status: 'complete',
  reference_groups: groups.map(([direction, references]) => ({ direction, references })), ...extra });
const base = [
  paper('a', [['Methods', [ref('Shared scientific method', { doi: 'https://doi.org/10.1234/ABC.', ref_id: '[1]' }), ref('Shared scientific method', { doi: '10.1234/abc', ref_id: '[2]' })]], ['Evaluation', [ref('Shared scientific method', { doi: '10.1234/abc', ref_id: '[1]' })]]]),
  paper('b', [['方法', [ref('SHARED SCIENTIFIC METHOD', { ref_id: '[4]' })]]], { reference_status: 'partial', reference_note: 'missing pages' }),
  paper('c', [['Methods', [ref('Different benchmark paper', { doi: '10.1234/other', ref_id: '[1]' })]]]),
  paper('d', [], { reference_status: 'unavailable' }),
];
let model = index.build(base);
assert.equal(model.works.length, 2);
assert.equal(model.works[0].count, 2, 'Repeated occurrences and multiple categories within one source count only once');
assert.equal(model.edgeCount, 3, 'Unique directed source/work pairs');
assert.equal(model.referenceCount, 5);
assert.equal(model.sources.length, 4);
assert.equal(model.sources.filter(s => s.hasReferences).length, 3);
assert.equal(model.sources.find(s => s.paperId === 'b').status, 'partial');
assert.equal(model.works[0].sources.values().next().value.contexts.length, 3, 'Retain all source labels and contexts');
const weakId = model.works[0].id;
assert.equal(index.build([...base].reverse()).works.find(w => w.title.toLowerCase().startsWith('shared')).id, weakId, 'Identity does not depend on import order');

model = index.build([...base, { ...base[0], id: 'duplicate-source', title: 'SOURCE PAPER A' }]);
assert.equal(model.sources.length, 4, 'Repeated source paper is deduplicated');
assert.equal(model.works[0].count, 2);

const mapped = index.build(base, { directions: { Methods: '方法', Evaluation: '评估' } });
const scoped = index.select(mapped, { direction: '方法' });
assert.equal(scoped[0].count, 2);
assert.equal(index.select(mapped, { direction: '评估' })[0].count, 1);
assert.equal(index.select(mapped, { direction: '评估' })[0].globalCount, 2);
assert.equal(mapped.directions.find(d => d.name === '方法').edges, 3);
assert.equal(mapped.directions.find(d => d.name === '方法').works.size, 2);
assert.equal(index.select(mapped, { query: '10.1234/ABC' }).length, 1);
assert.equal(index.select(mapped, { query: 'no matching record' }).length, 0);

const conflicts = [
  paper('x', [['Methods', [ref('Ambiguous identical paper', { doi: '10.1234/x' })]]]),
  paper('y', [['Methods', [ref('Ambiguous identical paper', { doi: '10.1234/y' })]]]),
  paper('z', [['Methods', [ref('Ambiguous identical paper')]]]),
];
const conflictModel = index.build(conflicts);
assert.equal(conflictModel.works.length, 3, 'Title-only entry must not bridge two conflicting DOIs');
assert.ok(conflictModel.works.every(w => w.count === 1 && w.review));
assert.equal(index.build([
  paper('p', [['D', [ref('Same title but different authors', { authors: 'Author One' })]]]),
  paper('q', [['D', [ref('Same title but different authors', { authors: 'Author Two' })]]]),
]).works.length, 2, 'Contradictory author metadata cannot silently merge works without identifiers');

const unknown = index.build([paper('a', [['Unknown', [{ ref_id: '[1]', citation: '[unreadable]' }]]]), paper('b', [['Unknown', [{ ref_id: '[1]', citation: '[unreadable]' }]]])]);
assert.equal(unknown.works.length, 2, 'Source-local citation labels are not global identities');
assert.equal(index.build([]).works.length, 0);
assert.equal(index.build([paper('empty', [])]).sources.length, 1);

const arxiv = index.build([
  paper('a', [['Methods', [ref('Preprint reference with metadata', { url: 'https://arxiv.org/abs/2401.12345v1' })]]]),
  paper('b', [['Methods', [ref('Preprint reference with metadata', { doi: '10.48550/arXiv.2401.12345' })]]]),
]);
assert.equal(arxiv.works.length, 1);
assert.equal(arxiv.works[0].count, 2);
assert.equal(index.doiKey('https://doi.org/10.1234/A(B).'), '10.1234/a(b)');

// Identical website homepages alone are not evidence that two references are the same work.
assert.equal(index.build([paper('a', [['D', [ref('First different resource', { url: 'https://example.org' }), ref('Second different resource', { url: 'https://example.org' })]]])]).works.length, 2);

const mergeInput = [paper('a', [['D', [ref('First version of a method', { doi: '10.1234/v1' }), ref('Second version of a method', { doi: '10.1234/v2' })]]]),
  paper('b', [['D', [ref('Second version of a method', { doi: '10.1234/v2' })]]])];
const before = index.build(mergeInput);
const merges = [[before.works[0].id, before.works[1].id]];
const after = index.build(mergeInput, { merges });
assert.equal(after.works.length, 1);
assert.equal(after.works[0].count, 2, 'Manual merge recomputes unique sources, not a sum of counts');
assert.equal(after.works[0].manual, true);
assert.equal(index.build(mergeInput, { merges: [] }).works.length, 2, 'Undo restores original grouping');
const snapshot = JSON.stringify(base);
index.build(base, { directions: { Methods: 'Changed' }, merges });
assert.equal(JSON.stringify(base), snapshot, 'Analysis and corrections cannot mutate the imported library');
const restored = JSON.parse(JSON.stringify(index.normalizeSettings({ directions: { Methods: '方法' }, merges })));
assert.deepEqual(restored.merges, merges);
assert.equal(index.build(mergeInput, restored).works[0].count, 2);
console.log('Citation index: unique sources, conflict isolation, coverage, directions, merge/undo, and persistence passed.');
