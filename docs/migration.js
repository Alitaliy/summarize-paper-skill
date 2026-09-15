/* Lossless, provider-neutral relational snapshot. Exporting never sends data online. */
(function (root) {
  "use strict";
  const data = typeof module !== "undefined" && module.exports ? require("./data-model.js") : root.PaperData;
  const index = typeof module !== "undefined" && module.exports ? require("./citation-index.js") : root.CitationIndex;
  const TABLES = ["papers", "sources", "source_members", "works", "reference_groups", "citation_records"];

  function build(input) {
    const backup = data.validateBackup(data.clone(input));
    const model = index.build(backup.papers, backup.analysis_settings);
    const settings = { ...index.normalizeSettings(backup.analysis_settings), identities: model.identities };
    const tables = Object.fromEntries(TABLES.map(name => [name, []]));
    const paperSources = new Map(), referenceWorks = new Map();
    for (const source of model.sources) {
      const id = `source:paper:${[...source.paperIds].sort()[0]}`;
      tables.sources.push({ id, title: source.title, status: source.status, notes: source.notes });
      for (const paperId of source.paperIds) {
        paperSources.set(paperId, id);
        tables.source_members.push({ paper_id: paperId, source_id: id });
      }
    }
    for (const work of model.works) {
      tables.works.push({ id: work.id, title: work.title, authors: work.authors, year: work.year,
        doi: work.doi, url: work.url, review: work.review, member_ids: work.memberIds });
      work.variants.forEach(reference => referenceWorks.set(reference.record_id, work.id));
    }
    backup.papers.forEach((paper, position) => {
      const { reference_groups = [], ...content } = paper;
      tables.papers.push({ id: paper.id, position, data: content });
      reference_groups.forEach((group, groupPosition) => {
        const id = `${paper.id}:group:${groupPosition}`;
        const { references = [], ...content } = group;
        tables.reference_groups.push({ id, paper_id: paper.id, position: groupPosition, data: content });
        references.forEach((reference, referencePosition) => {
          if (!reference.record_id) throw new Error("引用记录尚无稳定编号，请先用新版网页导入并导出库");
          const workId = referenceWorks.get(reference.record_id);
          if (!workId) throw new Error(`引用记录未归属到文献：${reference.record_id}`);
          tables.citation_records.push({ id: reference.record_id, paper_id: paper.id, source_id: paperSources.get(paper.id),
            work_id: workId, group_id: id, position: referencePosition,
            direction: Object.hasOwn(settings.directions, group.direction) ? settings.directions[group.direction] : group.direction,
            data: reference });
        });
      });
    });
    const bundle = { format: "summarize-paper-migration", schema_version: 1, library_schema_version: data.VERSION,
      exportedAt: backup.exportedAt, revision: backup.revision, analysis_settings: settings,
      counts: { papers: backup.papers.length, sources: model.sources.length, works: model.works.length,
        references: model.referenceCount, edges: model.edgeCount, unresolved_merges: model.unresolvedMerges.length }, tables };
    validate(bundle);
    return bundle;
  }

  function restore(bundle) {
    if (bundle?.format !== "summarize-paper-migration" || bundle.schema_version !== 1 || bundle.library_schema_version !== data.VERSION) throw new Error("不支持的迁移包版本");
    for (const name of TABLES) if (!Array.isArray(bundle.tables?.[name])) throw new Error(`迁移包缺少数据表：${name}`);
    const tables = bundle.tables;
    const papers = [...tables.papers].sort((a, b) => a.position - b.position).map(row => ({ ...data.clone(row.data), reference_groups: [] }));
    const paperById = new Map(papers.map(paper => [paper.id, paper])), groups = new Map();
    for (const row of [...tables.reference_groups].sort((a, b) => a.position - b.position)) {
      const group = { ...data.clone(row.data), references: [] };
      if (!paperById.has(row.paper_id)) throw new Error("引用分组的来源论文不存在");
      paperById.get(row.paper_id).reference_groups.push(group); groups.set(row.id, group);
    }
    for (const row of [...tables.citation_records].sort((a, b) => a.position - b.position)) {
      if (!groups.has(row.group_id)) throw new Error("引用记录的分组不存在");
      groups.get(row.group_id).references.push(data.clone(row.data));
    }
    return data.validateBackup({ format: "summarize-paper-library", schema_version: data.VERSION,
      exportedAt: bundle.exportedAt, revision: bundle.revision, papers, analysis_settings: data.clone(bundle.analysis_settings) });
  }

  function validate(bundle) {
    const backup = restore(bundle), { tables } = bundle;
    const maps = {};
    for (const name of TABLES) {
      maps[name] = new Map();
      for (const row of tables[name]) {
        const id = name === "source_members" ? row.paper_id : row.id;
        if (!id || maps[name].has(id)) throw new Error(`迁移表 ${name} 存在重复或缺失编号`);
        maps[name].set(id, row);
      }
    }
    for (const row of tables.papers) if (row.data.id !== row.id) throw new Error("论文主键与原记录不一致");
    for (const row of tables.source_members) if (!maps.papers.has(row.paper_id) || !maps.sources.has(row.source_id)) throw new Error("来源论文映射无效");
    for (const row of tables.citation_records) {
      if (row.data.record_id !== row.id || !maps.works.has(row.work_id) || !maps.sources.has(row.source_id) ||
          maps.reference_groups.get(row.group_id)?.paper_id !== row.paper_id || maps.source_members.get(row.paper_id)?.source_id !== row.source_id) throw new Error("引用记录包含无效关联");
    }
    const model = index.build(backup.papers, backup.analysis_settings);
    const actual = { papers: backup.papers.length, sources: model.sources.length, works: model.works.length,
      references: model.referenceCount, edges: model.edgeCount, unresolved_merges: model.unresolvedMerges.length };
    for (const [name, count] of Object.entries(actual)) if (bundle.counts[name] !== count) throw new Error(`迁移前后 ${name} 数量不一致`);
    if (tables.works.length !== model.works.length || tables.sources.length !== model.sources.length || tables.source_members.length !== backup.papers.length) throw new Error("迁移表数量不完整");
    const expectedWorks = new Map(model.works.flatMap(work => work.variants.map(ref => [ref.record_id, work.id])));
    const expectedSources = new Map(model.sources.flatMap(source => source.paperIds.map(id => [id, `source:paper:${[...source.paperIds].sort()[0]}`])));
    for (const row of tables.source_members) if (expectedSources.get(row.paper_id) !== row.source_id) throw new Error("迁移后的来源论文归属不一致");
    for (const work of model.works) {
      const row = maps.works.get(work.id);
      if (!row || ["title", "authors", "year", "doi", "url", "review"].some(field => row[field] !== work[field])) throw new Error("迁移后的被引文献元数据不一致");
    }
    const positions = new Set();
    for (const name of ["papers", "reference_groups", "citation_records"]) for (const row of tables[name]) {
      const key = JSON.stringify([name, row.group_id || row.paper_id || "", row.position]);
      if (!Number.isInteger(row.position) || row.position < 0 || positions.has(key)) throw new Error("迁移包包含无效或重复的排序位置");
      positions.add(key);
    }
    for (const row of tables.citation_records) {
      if (expectedWorks.get(row.id) !== row.work_id) throw new Error("迁移后的文献归属与本地分析不一致");
      const original = maps.reference_groups.get(row.group_id).data.direction;
      const direction = Object.hasOwn(backup.analysis_settings.directions, original) ? backup.analysis_settings.directions[original] : original;
      if (row.direction !== direction) throw new Error("迁移后的方向与本地分析不一致");
    }
    const edges = new Set(tables.citation_records.map(row => JSON.stringify([row.source_id, row.work_id])));
    if (edges.size !== model.edgeCount) throw new Error("迁移后的去重引用篇数不一致");
    return actual;
  }
  const api = { build, restore, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PaperMigration = api;
})(globalThis);
