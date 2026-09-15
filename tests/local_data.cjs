const assert = require('node:assert/strict');
const data = require('../docs/data-model.js');
const index = require('../docs/citation-index.js');
const migration = require('../docs/migration.js');
const ref = (title, extra = {}) => ({ title, year: '2024', ref_id: '[1]', relation: 'Foundation', classification_basis: 'Section 2', ...extra });
const paper = (id, references) => data.preparePaper({ id, title: `Source paper ${id}`, year: '2025', starred: true, rows: [{ summary: 'Evidence', dimension: 'Purpose' }], reference_groups: [{ direction: 'Methods', summary: 'Original group context', references }] });
let papers = [paper('a', [ref('Original method reference'), ref('Alternate edition reference', { ref_id: '[2]' })]), paper('b', [ref('Original method reference')])];
let model = index.build(papers);
let settings = { ...index.normalizeSettings(), identities: model.identities, merges: [[model.works[0].id, model.works[1].id]] };
assert.equal(index.build(papers, settings).works.length, 1);
const updated = data.clone(papers[0]);
delete updated.reference_groups[0].references[0].record_id;
updated.reference_groups[0].references[0].doi = '10.1234/new-doi';
papers[0] = data.preparePaper(updated, papers[0]);
model = index.build(papers, settings);
assert.equal(model.works.length, 1, 'Manual merge remains effective after DOI enrichment');
assert.equal(model.works[0].count, 2, 'Repeated source contributes one after enrichment');
assert.equal(model.unresolvedMerges.length, 0);
assert.equal(model.works[0].id, index.build(papers.slice().reverse(), settings).works[0].id);
settings = { ...settings, identities: model.identities, directions: { Methods: '方法' } };
const snapshot = data.backup(papers, settings, 7), bundle = migration.build(snapshot);
assert.deepEqual(migration.restore(bundle).papers, snapshot.papers, 'All summary, star, bibliography, group and evidence fields survive relational round-trip');
assert.deepEqual(migration.restore(bundle).analysis_settings, bundle.analysis_settings);
assert.equal(bundle.counts.edges, 2);
assert.equal(bundle.tables.citation_records.length, 3);
assert.equal(bundle.tables.works.length, 1);
assert.ok(bundle.tables.citation_records.every(row => row.direction === '方法'));
assert.equal(index.build(migration.restore(bundle).papers, { ...settings, merges: [] }).works.length, 2, 'Undo remains possible after migration');
const bad = data.clone(bundle); bad.tables.citation_records[0].work_id = 'missing';
assert.throws(() => migration.validate(bad), /无效关联/);
const future = { ...snapshot, schema_version: 999 };
assert.throws(() => data.validateBackup(future), /不支持/);
assert.throws(() => data.validateBackup({ ...snapshot, papers: [papers[0], papers[0]] }), /重复/);
const unknown = { ...settings, merges: [['work:missing:a', 'work:missing:b']] };
assert.equal(index.build(papers, unknown).unresolvedMerges.length, 1, 'Unresolved historical corrections are reported and retained');

// Two newly conflicting identifiers must not be rejoined via the stable registry.
const duplicates = [paper('x', [ref('Initially ambiguous same title')]), paper('y', [ref('Initially ambiguous same title')])];
const oldModel = index.build(duplicates);
duplicates[0].reference_groups[0].references[0].doi = '10.1234/conflict-a';
duplicates[1].reference_groups[0].references[0].doi = '10.1234/conflict-b';
assert.equal(index.build(duplicates, { identities: oldModel.identities }).works.length, 2);

// A backup from another device has different occurrence IDs but the same bibliography.
const importedPapers = data.clone(papers);
for (const paper of importedPapers) for (const reference of data.refs(paper)) delete reference.record_id;
const otherDevice = importedPapers.map(paper => data.preparePaper(paper));
const otherModel = index.build(otherDevice);
const combined = { identities: { ...settings.identities, ...otherModel.identities },
  merges: [[otherModel.works[0].id, otherModel.works[1].id]] };
assert.equal(index.build(papers, combined).works.length, 1, 'Imported manual rules resolve to the local stable records');
console.log('Local data: stable IDs, DOI enrichment, conflicts, merge/undo, migration round-trip and integrity validation passed.');
