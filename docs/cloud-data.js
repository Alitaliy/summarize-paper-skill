/* Pure relational deltas. Only queued edits are duplicated; stars stay tiny. */
(function (root) {
  "use strict";
  const model = typeof module !== "undefined" && module.exports ? require("./data-model.js") : root.PaperData;
  const migration = typeof module !== "undefined" && module.exports ? require("./migration.js") : root.PaperMigration;
  const tables = ["papers", "sources", "source_members", "works", "reference_groups", "citation_records"];
  const key = (name, row) => name === "source_members" ? row.paper_id : row.id;
  const canonical = value => JSON.stringify(value, function (_, item) {
    return item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
  });
  const equal = (a, b) => canonical(a) === canonical(b);
  const packet = snapshot => migration.build(model.backup([...snapshot.papers].sort((a, b) => a.id.localeCompare(b.id, "en")), snapshot.analysis_settings));
  function delta(before, after) {
    const a = packet(before), b = packet(after), changes = {};
    for (const name of tables) {
      const old = new Map(a.tables[name].map(row => [key(name, row), row]));
      const next = new Map(b.tables[name].map(row => [key(name, row), row]));
      changes[name] = { puts: [...next].filter(([id, row]) => !equal(row, old.get(id))).map(([, row]) => row),
        deletes: [...old.keys()].filter(id => !next.has(id)) };
    }
    return { kind: "delta", tables: changes, settings: b.analysis_settings, counts: b.counts };
  }
  function apply(snapshot, change) {
    const papers = new Map(snapshot.papers.map(p => [p.id, p]));
    (change.deletes || []).forEach(id => papers.delete(id));
    (change.puts || []).forEach(p => papers.set(p.id, model.clone(p)));
    return { ...snapshot, papers: [...papers.values()], analysis_settings: change.settings ?? snapshot.analysis_settings };
  }
  function edit(snapshot, change) {
    const puts = change.puts || [], deletes = change.deletes || [];
    if (change.settings === undefined && !deletes.length && puts.length === 1) {
      const before = snapshot.papers.find(p => p.id === puts[0].id), after = puts[0];
      if (before && equal({ ...before, starred: false }, { ...after, starred: false })) {
        return { kind: "stars", stars: [{ id: after.id, starred: !!after.starred }] };
      }
    }
    return delta(snapshot, apply(snapshot, change));
  }
  const api = { equal, delta, apply, edit };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CloudData = api;
})(globalThis);
