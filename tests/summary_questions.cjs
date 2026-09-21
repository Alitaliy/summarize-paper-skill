// Exercise old/new summaries, filtering, import and missing-answer notices in the real app.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { session, descendants } = require('./app_storage.cjs');
const dimensions = ['研究目的', '研究动机', '使用技术/方法', '实验与结果', '主要贡献', '不足/局限', '未来前景/后续工作'];
const oldOrder = ['研究目的', '主要贡献', '使用技术/方法', '实验与结果', '不足/局限', '未来前景/后续工作'];
const row = dimension => ({ dimension, summary: `Evidence for ${dimension}`, basis_type: '原文明确', evidence: 'Section 1', confidence: '高' });
const oldPaper = { id: 'legacy', title: 'Legacy source', starred: true, rows: oldOrder.map(row),
  reference_groups: [{ direction: 'Methods', references: [{ title: 'Prior method', doi: '10.1234/prior' }] }] };
const newPaper = { id: 'current', title: 'Current source', rows: [...dimensions].reverse().map(row).concat(row('补充观察')) };

(async () => {
  const { context, api, elements } = await session(new Map([['summarize-paper-library-v2', JSON.stringify([oldPaper, newPaper])]]));
  try {
    const storedBefore = JSON.stringify(await api.getRepository().read());
    assert.deepEqual(elements.dimensionFilter.children.map(option => option.value), dimensions);
    vm.runInContext('openDetail("legacy")', context);
    const sectionNames = () => elements.detailRows.children.map(section => section.dataset.dimension);
    assert.deepEqual(sectionNames(), dimensions, 'Legacy claims are presented in five-question order, with the missing motivation identified');
    const missing = descendants(elements.detailRows).filter(el => el.className === 'detail-missing-answer');
    assert.equal(missing.length, 1);
    assert.ok(missing[0].textContent.includes('当前总结'));
    assert.equal(descendants(elements.detailRows).filter(el => el.className === 'detail-row').length, 6);

    // Matching all rows still changes whether missing-question notices belong in this view.
    vm.runInContext('filters.query = "Legacy source"; openDetail("legacy")', context);
    assert.deepEqual(sectionNames(), dimensions.filter(name => name !== '研究动机'));
    vm.runInContext('filters.query = ""; openDetail("legacy")', context);
    assert.deepEqual(sectionNames(), dimensions);
    vm.runInContext('filters.dimension = "研究动机"; openDetail("current")', context);
    assert.deepEqual(sectionNames(), ['研究动机']);
    vm.runInContext('openDetail("legacy", {ignoreFilters: true})', context);
    assert.deepEqual(sectionNames(), dimensions, 'Citation-source links still show the full summary');
    vm.runInContext('filters.dimension = "all"; openDetail("current")', context);
    assert.deepEqual(sectionNames(), [...dimensions, '补充观察'], 'Custom sections are preserved after the standard questions');
    assert.equal(JSON.stringify(await api.getRepository().read()), storedBefore, 'Reading notices never writes claims, counts or settings');

    const legacyMarkdown = '# 论文总结：Legacy source\n\n## 逐项总结\n\n' + oldOrder.map(name => `### ${name}\n- 【原文明确｜高】Evidence for ${name}（依据：Section 1）\n`).join('\n');
    context.testMarkdown = legacyMarkdown;
    const parsed = vm.runInContext('parseMarkdown(testMarkdown)', context);
    assert.deepEqual(Array.from(parsed.rows, r => r.dimension), oldOrder, 'Old Markdown remains readable without fabricated motivation');

    const revised = api.normalizePaper({ ...oldPaper, starred: false, rows: [...oldPaper.rows, row('研究动机')] });
    await api.mergePapers([revised], 'test');
    vm.runInContext('openDetail("legacy")', context);
    assert.deepEqual(sectionNames(), dimensions);
    assert.equal(descendants(elements.detailRows).filter(el => el.className === 'detail-missing-answer').length, 0);
    const saved = api.getLibrary().find(p => p.id === 'legacy');
    assert.equal(saved.rows.length, 7);
    assert.equal(saved.starred, true, 'Updating the summary preserves the local star');
    assert.equal(saved.reference_groups[0].references[0].doi, '10.1234/prior');
    console.log('Summary questions: new order, motivation filter, legacy gaps without writes, cache invalidation, old Markdown and update preservation passed.');
  } finally { api.getRepository().close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
