/* Shared, DOM-free citation aggregation. Derived data never replaces source records. */
(function (root) {
  "use strict";
  const clean = value => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const keyText = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const titleOf = item => clean(item.title || item.paper_title);

  function doiKey(value) {
    let text = clean(value);
    try { text = decodeURIComponent(text); } catch { /* Retain malformed input verbatim. */ }
    const match = text.match(/10\.\d{4,9}\/[^\s<>"?#]+/iu);
    if (!match) return "";
    let doi = match[0].toLowerCase().replace(/[.,;:]+$/, "");
    while (doi.endsWith(")") && doi.split(")").length > doi.split("(").length) doi = doi.slice(0, -1);
    return doi;
  }

  function arxivKey(item) {
    const text = [item.doi, item.url].map(clean).join(" ");
    const match = text.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv[.:]\s*)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i);
    return match ? match[1].toLowerCase() : "";
  }

  function identifiers(item) {
    const doi = doiKey(item.doi) || (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(clean(item.url)) ? doiKey(item.url) : "");
    const arxiv = arxivKey(item);
    return { primary: doi && !doi.startsWith("10.48550/arxiv.") ? `doi:${doi}` : arxiv ? `arxiv:${arxiv}` : doi ? `doi:${doi}` : "", arxiv };
  }

  function bibliographyKey(item) {
    const title = keyText(titleOf(item));
    if (title.length < 10 || /^(未提及|未知|题名待核查|unknown|untitled|titleunreadable)$/.test(title)) return "";
    const year = clean(item.year).match(/(?:19|20)\d{2}/)?.[0];
    const authors = keyText(item.authors);
    if (year) return `${title}|year:${year}`;
    return authors.length > 3 ? `${title}|authors:${authors}` : "";
  }

  function normalizeSettings(input = {}) {
    const directions = Object.fromEntries(Object.entries(input?.directions || {})
      .filter(([from, to]) => clean(from) && typeof to === "string" && clean(to))
      .map(([from, to]) => [clean(from), clean(to)]));
    const merges = Array.isArray(input?.merges) ? input.merges
      .filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === "string" && id.length))
      .map(pair => pair.slice()) : [];
    const identities = Object.fromEntries(Object.entries(input?.identities || {})
      .filter(([id, entry]) => id.startsWith("work:") && entry && typeof entry === "object")
      .map(([id, entry]) => [id, { aliases: [...new Set((Array.isArray(entry.aliases) ? entry.aliases : []).filter(x => typeof x === "string"))],
        records: [...new Set((Array.isArray(entry.records) ? entry.records : []).filter(x => typeof x === "string"))] }]));
    return { version: 2, directions, merges, identities };
  }

  // Record anchors survive DOI/title enrichment; aliases also recover v1 merge rules.
  // A historical ID shared by now-conflicting entities is ambiguous, never a merge instruction.
  function stableEntities(referenceIndex, settings) {
    const identities = JSON.parse(JSON.stringify(settings.identities)), aliases = new Map(), anchors = new Map();
    const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(value); };
    for (const [id, entry] of Object.entries(identities)) {
      entry.aliases.forEach(alias => add(aliases, alias, id)); entry.records.forEach(record => add(anchors, record, id));
    }
    const used = new Set(), resolution = new Map(), groups = new Map();
    for (const group of [...referenceIndex.groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const records = [...new Set(group.entries.map(entry => entry.record.record_id).filter(Boolean))].sort();
      const candidates = [...new Set(records.flatMap(record => [...(anchors.get(record) || [])]))].sort();
      const aliasMatches = [...(aliases.get(group.id) || [])].sort();
      let id = [...candidates, ...aliasMatches].find(candidate => !used.has(candidate));
      id ||= records.length ? `work:record:${records[0]}` : group.id;
      if (used.has(id)) id = group.id;
      used.add(id);
      const historical = [...new Set([...candidates, ...aliasMatches])];
      for (const alias of [group.id, id, ...historical]) add(resolution, alias, id);
      if (!Object.hasOwn(identities, id)) identities[id] = { aliases: [], records: [] };
      identities[id].aliases = [...new Set([...identities[id].aliases, group.id])].sort();
      identities[id].records = [...new Set([...identities[id].records, ...records])].sort();
      groups.set(id, { ...group, id });
    }
    // Resolve old bibliography IDs after their records acquire stronger identifiers.
    for (const [id, entry] of Object.entries(identities)) {
      const targets = resolution.get(id);
      if (targets) for (const alias of entry.aliases) for (const target of targets) add(resolution, alias, target);
    }
    return { groups, identities, resolve: id => resolution.get(id)?.size === 1 ? [...resolution.get(id)][0] : "" };
  }

  function resolveEntities(records, prefix) {
    const arxivAnchors = new Map();
    const identified = records.map(entry => ({ ...entry, ...identifiers(entry.record), bib: bibliographyKey(entry.record) }));
    for (const entry of identified) {
      if (entry.arxiv && entry.primary.startsWith("doi:")) {
        if (!arxivAnchors.has(entry.arxiv)) arxivAnchors.set(entry.arxiv, new Set());
        arxivAnchors.get(entry.arxiv).add(entry.primary);
      }
    }
    for (const entry of identified) {
      const anchors = arxivAnchors.get(entry.arxiv);
      if (entry.primary.startsWith("arxiv:") && anchors?.size === 1) entry.primary = [...anchors][0];
    }
    const bibAnchors = new Map();
    const bibAuthors = new Map();
    for (const entry of identified) {
      const authors = keyText(entry.record.authors);
      if (entry.bib && authors) {
        if (!bibAuthors.has(entry.bib)) bibAuthors.set(entry.bib, new Set());
        bibAuthors.get(entry.bib).add(authors);
      }
      if (entry.primary && entry.bib) {
        if (!bibAnchors.has(entry.bib)) bibAnchors.set(entry.bib, new Set());
        bibAnchors.get(entry.bib).add(entry.primary);
      }
    }
    const groups = new Map();
    const assignments = [];
    for (const entry of identified) {
      const anchors = bibAnchors.get(entry.bib);
      const ambiguous = anchors?.size > 1 || bibAuthors.get(entry.bib)?.size > 1;
      const identity = entry.primary || (entry.bib && !ambiguous
        ? (anchors?.size === 1 ? [...anchors][0] : `bib:${entry.bib}`)
        : `local:${JSON.stringify([entry.scope, keyText(titleOf(entry.record)) || entry.local])}`);
      const id = `${prefix}:${identity}`;
      if (!groups.has(id)) groups.set(id, { id, entries: [], review: false, methods: new Set() });
      const group = groups.get(id);
      group.entries.push(entry);
      group.review ||= Boolean(ambiguous || !entry.primary);
      group.methods.add(entry.primary ? "标识匹配" : entry.bib && !ambiguous ? "题名与年份/作者匹配" : "信息不足，独立保留");
      assignments.push(id);
    }
    // Same-title groups may be separate versions or conflicting identifiers. Never merge them silently.
    const titleGroups = new Map();
    for (const group of groups.values()) for (const entry of group.entries) {
      const title = keyText(titleOf(entry.record));
      if (!title) continue;
      if (!titleGroups.has(title)) titleGroups.set(title, new Set());
      titleGroups.get(title).add(group.id);
    }
    for (const ids of titleGroups.values()) if (ids.size > 1) for (const id of ids) groups.get(id).review = true;
    return { groups, assignments };
  }

  function build(library, inputSettings = {}) {
    const settings = normalizeSettings(inputSettings);
    const records = (Array.isArray(library) ? library : []).filter(Boolean);
    const sourceIndex = resolveEntities(records.map((record, index) => ({ record, scope: record.id || index, local: index })), "source");
    const sources = new Map();
    for (const group of sourceIndex.groups.values()) {
      const entries = group.entries.map(entry => entry.record);
      const status = entries.every(p => p.reference_status === "complete") ? "complete"
        : entries.some(p => p.reference_status === "partial") ? "partial"
        : entries.every(p => p.reference_status === "unavailable") ? "unavailable" : "unknown";
      sources.set(group.id, { id: group.id, title: titleOf(entries[0]) || "未命名来源论文", paperId: entries[0].id,
        paperIds: [...new Set(entries.map(p => p.id).filter(Boolean))], status, notes: [...new Set(entries.map(p => clean(p.reference_note)).filter(Boolean))], hasReferences: false });
    }
    const citations = [];
    const rawDirections = new Set();
    records.forEach((paper, index) => {
      const sourceId = sourceIndex.assignments[index];
      for (const group of paper.reference_groups || []) {
        const originalDirection = clean(group.direction) || "待核查/方向不明";
        for (const [refIndex, reference] of (group.references || []).entries()) {
          if (!reference || !(titleOf(reference) || reference.citation || reference.ref_id || reference.doi)) continue;
          rawDirections.add(originalDirection);
          sources.get(sourceId).hasReferences = true;
          const direction = Object.hasOwn(settings.directions, originalDirection) ? settings.directions[originalDirection] : originalDirection;
          citations.push({ record: reference, sourceId, paperId: paper.id, originalDirection, direction,
            scope: sourceId, local: reference.ref_id || `${originalDirection}:${refIndex}` });
        }
      }
    });
    const referenceIndex = stableEntities(resolveEntities(citations, "work"), settings);
    // User-confirmed merges operate on derived entities; source bibliographies remain untouched.
    const parents = new Map([...referenceIndex.groups.keys()].map(id => [id, id]));
    const find = id => {
      let node = id;
      while (parents.get(node) !== node) node = parents.get(node);
      while (parents.get(id) !== id) { const next = parents.get(id); parents.set(id, node); id = next; }
      return node;
    };
    const unresolvedMerges = [];
    for (const pair of settings.merges) {
      const [a, b] = pair.map(referenceIndex.resolve);
      if (!parents.has(a) || !parents.has(b)) { unresolvedMerges.push(pair); continue; }
      const x = find(a), y = find(b);
      if (x !== y) parents.set(x < y ? y : x, x < y ? x : y);
    }
    const works = new Map();
    for (const group of referenceIndex.groups.values()) {
      const id = find(group.id);
      if (!works.has(id)) works.set(id, { id, memberIds: [], title: "", authors: "", year: "", doi: "", url: "",
        review: false, methods: new Set(), sources: new Map(), directions: new Set(), variants: [] });
      const work = works.get(id);
      work.memberIds.push(group.id);
      work.review ||= group.review;
      for (const method of group.methods) work.methods.add(method);
      for (const entry of group.entries) {
        const ref = entry.record;
        for (const field of ["authors", "year", "doi", "url"]) if (!work[field] && clean(ref[field])) work[field] = clean(ref[field]);
        if (!work.title && titleOf(ref)) work.title = titleOf(ref);
        work.variants.push(ref);
        work.directions.add(entry.direction);
        if (!work.sources.has(entry.sourceId)) work.sources.set(entry.sourceId, { source: sources.get(entry.sourceId), contexts: [] });
        const contexts = work.sources.get(entry.sourceId).contexts;
        const context = { paperId: entry.paperId, recordId: ref.record_id || "", direction: entry.direction, originalDirection: entry.originalDirection,
          refId: clean(ref.ref_id), relation: clean(ref.relation), basis: clean(ref.classification_basis), citation: clean(ref.citation) };
        if (!contexts.some(existing => JSON.stringify(existing) === JSON.stringify(context))) contexts.push(context);
      }
    }
    for (const work of works.values()) {
      work.title ||= clean(work.variants[0]?.citation) || `题名待核查 ${clean(work.variants[0]?.ref_id)}`;
      work.count = work.sources.size;
      work.manual = work.memberIds.length > 1;
      work.searchText = keyText([work.title, work.authors, work.year, work.doi, work.url,
        ...work.variants.map(ref => [ref.title, ref.authors, ref.doi, ref.citation].join(" "))].join(" "));
      work.allSources = [...work.sources.values()];
      work.directionSources = new Map([...work.directions].map(direction => [direction,
        work.allSources.filter(edge => edge.contexts.some(context => context.direction === direction))]));
    }
    const directions = new Map();
    for (const work of works.values()) for (const [sourceId, edge] of work.sources) {
      for (const direction of new Set(edge.contexts.map(context => context.direction))) {
        if (!directions.has(direction)) directions.set(direction, { name: direction, works: new Set(), sources: new Set(), edges: 0 });
        const item = directions.get(direction);
        item.works.add(work.id); item.sources.add(sourceId); item.edges += 1;
      }
    }
    return { works: [...works.values()].sort(compareWorks), sources: [...sources.values()],
      identities: referenceIndex.identities, unresolvedMerges,
      directions: [...directions.values()].sort((a, b) => b.works.size - a.works.size || a.name.localeCompare(b.name)),
      rawDirections: [...rawDirections].sort(),
      edgeCount: [...works.values()].reduce((total, work) => total + work.count, 0),
      referenceCount: citations.length, importedCount: records.length };
  }

  function compareWorks(a, b) { return b.count - a.count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id); }
  function select(model, { query = "", direction = "" } = {}) {
    const needle = keyText(query);
    const selected = model.works.filter(work => !needle || work.searchText.includes(needle)).map(work => {
      const sources = direction ? (work.directionSources.get(direction) || []) : work.allSources;
      return { ...work, globalCount: work.count, count: sources.length, visibleSources: sources };
    }).filter(work => work.count);
    return direction ? selected.sort(compareWorks) : selected;
  }
  const api = { build, select, normalizeSettings, doiKey, bibliographyKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CitationIndex = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
