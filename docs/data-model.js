/* Local records and portable backups. No network access or account credentials. */
(function (root) {
  "use strict";
  const VERSION = 3;
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const uuid = () => root.crypto.randomUUID();
  const refs = paper => (paper.reference_groups || []).flatMap(group => group.references || []);
  const doi = item => String(item.doi || "").toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi.org\//, "").replace(/[.;]+$/, "");

  function preparePaper(input, previous) {
    const paper = clone(input);
    paper.id = previous?.id || paper.id || `paper-${uuid()}`;
    paper.record_version = 1;
    const oldRefs = refs(previous || {}), used = new Set();
    for (const reference of refs(paper)) {
      const compatible = oldRefs.filter(old => !used.has(old.record_id) && !(doi(old) && doi(reference) && doi(old) !== doi(reference)));
      let candidates = compatible.filter(old => reference.record_id && old.record_id === reference.record_id);
      if (!candidates.length && doi(reference)) candidates = compatible.filter(old => doi(old) === doi(reference));
      if (candidates.length !== 1) candidates = compatible.filter(old => key(reference.title) && key(old.title) === key(reference.title) && (!old.year || !reference.year || old.year === reference.year));
      if (candidates.length !== 1) candidates = compatible.filter(old => reference.ref_id && old.ref_id === reference.ref_id && (!key(old.title) || !key(reference.title) || key(old.title) === key(reference.title)));
      const match = candidates.length === 1 ? candidates[0] : null;
      reference.record_id = match?.record_id || reference.record_id || `ref-${uuid()}`;
      if (used.has(reference.record_id)) reference.record_id = `ref-${uuid()}`;
      used.add(reference.record_id);
    }
    for (const group of paper.reference_groups || []) group.references = (group.references || []).map(reference => ({ record_id: reference.record_id, ...reference }));
    return paper;
  }

  function validateBackup(payload) {
    if (!payload || typeof payload !== "object") throw new Error("文献库备份不是有效对象");
    if (payload.schema_version !== undefined && payload.schema_version !== VERSION) throw new Error(`不支持的文献库版本：${payload.schema_version}，请使用兼容版本的网页`);
    if (!Array.isArray(payload.papers)) throw new Error("文献库缺少 papers 数组");
    if (payload.revision !== undefined && (!Number.isSafeInteger(payload.revision) || payload.revision < 0)) throw new Error("文献库修订号无效");
    const ids = new Set(), referenceIds = new Set();
    for (const paper of payload.papers) {
      if (!paper || !Array.isArray(paper.rows) || !paper.rows.length) throw new Error("文献记录缺少总结行，已停止导入");
      if (paper.id && ids.has(paper.id)) throw new Error(`文献编号重复：${paper.id}`);
      if (paper.id) ids.add(paper.id);
      for (const reference of refs(paper)) {
        if (reference.record_id && referenceIds.has(reference.record_id)) throw new Error(`引用记录编号重复：${reference.record_id}`);
        if (reference.record_id) referenceIds.add(reference.record_id);
      }
    }
    if (payload.analysis_settings && (typeof payload.analysis_settings !== "object" || Array.isArray(payload.analysis_settings))) throw new Error("分析设置格式无效");
    if (payload.analysis_settings?.version > 2) throw new Error("分析设置版本较新，请升级网页后再导入");
    return payload;
  }

  function backup(papers, settings, revision = 0) {
    return validateBackup({ format: "summarize-paper-library", schema_version: VERSION,
      exportedAt: new Date().toISOString(), revision, papers: clone(papers), analysis_settings: clone(settings || {}) });
  }

  const api = { VERSION, clone, preparePaper, validateBackup, backup, refs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PaperData = api;
})(globalThis);
