// Tests the deployed parser functions with independently decoded XLSX cell matrices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = process.argv[2];
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.attributes = {};
    this.listeners = {};
    this.classList = {
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        enabled ? names.add(name) : names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() {
    let stopped = false;
    this.listeners.click({ stopPropagation() { stopped = true; } });
    return stopped;
  }
}
const sandbox = {
  document: { addEventListener() {}, createElement: tagName => new FakeElement(tagName) },
  window: { XLSX: { utils: { sheet_to_json: sheet => sheet } } },
  localStorage: { setItem() {}, getItem() { return null; } },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8'), sandbox);
const api = vm.runInContext(`({normalizeJsonPayload, parseMarkdown, parseWorkbookReferenceGroups,
  parseWorkbookReferenceMetadata, normalizeReferenceMetadata, rowFromHeaders, applyPaperMetadataUpdate,
  referenceStatusText, selectPreferredSummaryFiles, mergePaperMetadata, normalizePaper,
  createStarButton, togglePaperStar, mergePapers})`, sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const input = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
const expected = api.normalizeJsonPayload(input)[0];
const markdown = api.parseMarkdown(fs.readFileSync(path.join(dir, 'paper_summary.md'), 'utf8'));
const workbook = JSON.parse(fs.readFileSync(path.join(dir, 'workbook.json'), 'utf8'));
assert.deepEqual(plain(markdown.rows), plain(expected.rows), 'Markdown summary evidence/confidence/review must survive');
assert.deepEqual(plain(markdown.reference_groups), plain(expected.reference_groups), 'Markdown citation fields must survive');
assert.deepEqual(plain(api.normalizeReferenceMetadata(markdown)), plain(api.normalizeReferenceMetadata(expected)));
const sheet = workbook.Sheets['论文总结'];
assert.deepEqual(plain(sheet.slice(2).map(row => api.rowFromHeaders(sheet[1], row))), plain(expected.rows));
assert.deepEqual(plain(api.parseWorkbookReferenceGroups(workbook)), plain(expected.reference_groups), 'XLSX citation fields must survive');
assert.deepEqual(plain(api.normalizeReferenceMetadata(api.parseWorkbookReferenceMetadata(workbook))), plain(api.normalizeReferenceMetadata(expected)));
assert.ok(api.referenceStatusText(expected).includes(String(input.reference_groups.flatMap(g => g.references).length)));

// Older formats remain importable and never gain an invented completeness claim.
const legacy = { ...input };
delete legacy.reference_status;
delete legacy.reference_note;
delete legacy.reference_count_expected;
assert.equal(api.normalizeJsonPayload(legacy)[0].reference_status, '');
const oldWorkbook = plain(workbook);
oldWorkbook.Sheets['引用文献脉络'].splice(1, 1);
assert.deepEqual(plain(api.parseWorkbookReferenceGroups(oldWorkbook)), plain(expected.reference_groups));
assert.deepEqual(plain(api.parseWorkbookReferenceMetadata(oldWorkbook)), {});

// Re-importing a citation-only change must update an existing paper with identical summary rows.
const existing = api.normalizeJsonPayload(legacy)[0];
existing.reference_groups = [];
api.applyPaperMetadataUpdate(existing, expected);
assert.deepEqual(plain(existing.reference_groups), plain(expected.reference_groups));
assert.equal(existing.reference_status, input.reference_status);
const unavailable = api.normalizeJsonPayload({ ...input, reference_status: 'unavailable', reference_groups: [], reference_count_expected: null, reference_note: 'No bibliography supplied.' })[0];
api.applyPaperMetadataUpdate(existing, unavailable);
assert.equal(existing.reference_groups.length, 0, 'Explicit empty reference data must clear stale citations');
assert.equal(api.mergePaperMetadata(unavailable, expected).reference_groups.length, 0);

// Folder watching picks the complete JSON bundle, while each format is independently readable.
const selected = api.selectPreferredSummaryFiles(['paper_summary.md', 'paper_summary.xlsx', 'summary.json'].map(name => ({path:`paper/test/${name}`, file:{lastModified:1}})));
assert.equal(selected.length, 1);
assert.ok(selected[0].path.endsWith('/summary.json'));

// Card stars are accessible, reversible, and persisted as part of the normalized paper record.
const starredPaper = api.normalizePaper({ ...input, starred: true });
assert.equal(starredPaper.starred, true);
const unstarredPaper = api.normalizePaper({ ...input, paper_title: `${input.paper_title} 2` });
assert.equal(unstarredPaper.starred, false);
sandbox.testSaveCalls = 0;
sandbox.testToast = '';
vm.runInContext('saveLibrary = () => { testSaveCalls += 1; }; toast = message => { testToast = message; };', sandbox);
const starButton = api.createStarButton(unstarredPaper);
assert.equal(starButton.textContent, '☆');
assert.equal(starButton.attributes['aria-pressed'], 'false');
assert.equal(starButton.click(), true, 'Star clicks must not open the paper card');
assert.equal(unstarredPaper.starred, true);
assert.equal(starButton.textContent, '★');
assert.ok(starButton.className.includes('is-starred'));
assert.equal(starButton.attributes['aria-pressed'], 'true');
assert.equal(starButton.click(), true);
assert.equal(unstarredPaper.starred, false);
assert.equal(sandbox.testSaveCalls, 2);
assert.equal(api.togglePaperStar(unstarredPaper), true);

const importedStar = api.normalizePaper({ ...input, starred: true });
const existingCopy = api.normalizePaper({ ...input });
assert.equal(api.applyPaperMetadataUpdate(existingCopy, importedStar), true);
assert.equal(existingCopy.starred, true, 'An imported star must survive a same-fingerprint refresh');
const replacement = api.normalizePaper({
  ...input,
  starred: false,
  rows: input.rows.map((row, index) => index ? row : { ...row, summary: `${row.summary} updated` }),
});
sandbox.testExisting = importedStar;
vm.runInContext('library = [testExisting]; render = () => {};', sandbox);
api.mergePapers([replacement], 'test', { quietWhenNoChange: true });
assert.equal(vm.runInContext('library[0].starred', sandbox), true, 'A local star must survive a same-title re-import');
const css = fs.readFileSync(path.join(__dirname, '../docs/styles.css'), 'utf8');
const starStyles = css.match(/\.star-button\s*\{([^}]*)\}/)?.[1] || '';
assert.match(starStyles, /border:\s*0;/, 'The star must not have a surrounding border');
assert.match(starStyles, /background:\s*transparent;/, 'The star must not have a surrounding fill');
console.log('Web readers preserve claims, citation groups, coverage, and update behavior.');
