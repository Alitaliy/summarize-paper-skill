// Deterministic work counters, not browser FPS. Synthetic papers only.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { session, descendants } = require('./app_storage.cjs');
const { IDBObjectStore } = require('fake-indexeddb');
const fixture = Array.from({ length: 16 }, (_, p) => ({
  id: `source-${p}`, title: `Synthetic source paper ${p}`, year: '2025',
  rows: [{ dimension: '研究目的', summary: 'Synthetic summary' }],
  reference_groups: [{ direction: 'Methods', references: Array.from({ length: 60 }, (_, r) => ({
    title: r < 8 ? `Shared reference ${r}` : `Reference ${p}-${r}`,
    doi: `10.1234/${r < 8 ? `shared-${r}` : `${p}-${r}`}`, year: '2024', ref_id: `[${r + 1}]`,
    authors: 'Synthetic Author', venue: 'Synthetic Journal', relation: 'Supports the method',
    classification_basis: 'Related work section', citation: 'Synthetic bibliographic citation'
  })) }]
}));

(async () => {
  const { context, elements, api, callbacks } = await session(new Map([
    ['summarize-paper-library-v2', JSON.stringify(fixture)]
  ]));
  let allocations = 0, fullReads = 0;
  for (const name of ['createElement', 'createElementNS']) {
    const original = context.document[name];
    context.document[name] = (...args) => { allocations++; return original(...args); };
  }
  const originalRead = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function(...args) {
    if (this.name === 'papers') fullReads++;
    return originalRead.apply(this, args);
  };
  try {
    vm.runInContext('openDetail("source-0")', context);
    const hiddenReferenceNodes = descendants(elements.detailReferences).length;
    elements.referencesTab.fire('click');
    assert.equal(descendants(elements.detailReferences).filter(el => el.className === 'reference-item').length, 60);
    const referenceNode = elements.detailReferences.children[0];
    elements.summaryTab.fire('click'); elements.referencesTab.fire('click');
    assert.equal(elements.detailReferences.children[0], referenceNode, 'Tab switches retain reference content');
    vm.runInContext('closeDetail()', context);
    allocations = 0;
    vm.runInContext('openDetail("source-0")', context);
    const reopenNodes = allocations;
    vm.runInContext('closeDetail()', context);

    const pending = new Map(); let nextTimer = 0;
    context.setTimeout = (fn, delay) => { const id = ++nextTimer; pending.set(id, { fn, delay }); return id; };
    context.clearTimeout = id => pending.delete(id);
    const model = vm.runInContext('citationModel', context);
    let remoteCalls = 0;
    context.remoteQuery = async options => {
      remoteCalls++;
      const ranked = context.CitationIndex.select(model, { direction: options.selected_direction, query: '' });
      return { items: ranked.slice(options.page_offset, options.page_offset + options.page_size).map(w => ({ work_id: w.id, cited_by: w.count, global_cited_by: w.globalCount })) };
    };
    vm.runInContext('remoteAnalysis = remoteQuery', context);
    context.location.hash = '#/citations'; callbacks.hashchange();
    const selection = elements.citationSelection.children[0];
    const rank = elements.citationRanking.children[0];
    const details = descendants(elements.citationSelection).find(el => el.className === 'citation-context');
    details.open = true; details.fire('toggle');
    allocations = 0;
    await rank.fire('click');
    const sameSelectionNodes = allocations;
    allocations = 0;
    const remoteTimer = [...pending.values()].find(timer => timer.delay === 250);
    await remoteTimer.fn();
    const remoteConfirmationNodes = allocations;
    const preservedContext = descendants(elements.citationSelection).includes(details) && details.open;
    fullReads = 0;
    await api.loadLibrary();
    const unchangedReloadReads = fullReads;
    console.log(JSON.stringify({ papers: 16, references: 960, hiddenReferenceNodes, reopenNodes, sameSelectionNodes, remoteConfirmationNodes, unchangedReloadReads, preservedContext }));
    if (!process.argv.includes('--report')) {
      assert.equal(hiddenReferenceNodes, 0, 'Unopened reference tab creates no reference DOM');
      assert.equal(reopenNodes, 0, 'Reopening unchanged paper reuses the reading panel');
      assert.equal(sameSelectionNodes, 0, 'Repeated selection creates no graph/source DOM');
      assert.equal(remoteConfirmationNodes, 0, 'Matching cloud counts only update the confirmation note');
      assert.equal(unchangedReloadReads, 0, 'Unchanged revisions never read all papers');
      assert.equal(preservedContext, true, 'Cloud confirmation preserves expanded citation context');
      assert.equal(elements.citationSelection.children[0], selection);
      assert.equal(elements.citationRanking.children[0], rank);
      assert.equal(remoteCalls, 1);

      elements.citationLimit.value = '50'; elements.citationLimit.fire('change');
      assert.equal(elements.citationRanking.children.length, 50);
      assert.equal(elements.citationSelection.children[0], selection, 'Changing the ranking limit retains the same source panel');
      const scheduled = [...pending.values()].find(timer => timer.delay === 250);
      context.location.hash = '#/library'; callbacks.hashchange();
      await scheduled.fn();
      assert.equal(remoteCalls, 1, 'Leaving analysis cancels scheduled SQL work');

      // Reuse must never make corrections/imports invisible.
      const changed = JSON.parse(JSON.stringify(api.getLibrary().find(p => p.id === 'source-0')));
      changed.rows[0].summary = 'Corrected summary';
      changed.reference_groups[0].references[0].relation = 'Corrected citation relationship';
      await api.mergePapers([api.normalizePaper(changed)], 'test');
      vm.runInContext('openDetail("source-0")', context);
      assert.ok(elements.detailRows.textContent.includes('Corrected summary'));
      elements.referencesTab.fire('click');
      assert.ok(elements.detailReferences.textContent.includes('Corrected citation relationship'));
      assert.notEqual(elements.detailReferences.children[0], referenceNode);
      context.location.hash = '#/citations'; callbacks.hashchange();
      assert.ok(elements.citationSelection.textContent.includes('Corrected citation relationship'));
      assert.notEqual(elements.citationSelection.children[0], selection);

      const repository = api.getRepository(), meta = await repository.readMeta();
      await repository.commit({ puts: [{ ...api.getLibrary()[0], overview: 'Changed by another tab' }], expectedRevision: meta.revision });
      assert.equal(await api.loadLibrary(), true, 'External content changes bypass the revision shortcut');
      assert.ok(api.getLibrary().some(p => p.overview === 'Changed by another tab'));
    }
  } finally { IDBObjectStore.prototype.getAll = originalRead; api.getRepository().close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
