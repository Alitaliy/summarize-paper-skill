(function (root) {
  "use strict";
  const STORAGE = "summarize-paper-citation-settings-v1";
  const index = root.CitationIndex;
  const state = { query: "", direction: "", limit: 20, selected: "", model: null, settings: index.normalizeSettings() };
  let app;
  const els = {};
  const node = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const action = (text, className, callback) => {
    const element = node("button", className, text);
    element.type = "button";
    element.addEventListener("click", callback);
    return element;
  };
  const small = text => node("p", "analysis-note", text);
  const shorten = (text, length) => text.length > length ? text.slice(0, length - 1) + "…" : text;
  const active = () => root.location.hash === "#/citations";

  function init(options) {
    app = options;
    for (const id of ["libraryView", "citationsView", "libraryNav", "citationsNav", "analysisStats", "analysisCoverage", "citationQuery", "citationDirection", "citationLimit", "citationReset", "rankingCount", "rankingNote", "citationRanking", "directionChart", "directionForm", "directionMappings", "citationSelection"]) els[id] = document.getElementById(id);
    try { state.settings = index.normalizeSettings(JSON.parse(localStorage.getItem(STORAGE) || "{}")); }
    catch { app.notify("分析设置未能读取，已使用原始分类"); }
    els.citationQuery.addEventListener("input", () => { state.query = els.citationQuery.value; renderResults(); });
    els.citationDirection.addEventListener("change", () => { state.direction = els.citationDirection.value; renderResults(); });
    els.citationLimit.addEventListener("change", () => { state.limit = Number(els.citationLimit.value); renderResults(); });
    els.citationReset.addEventListener("click", () => {
      state.query = ""; state.direction = ""; state.limit = 20;
      els.citationQuery.value = ""; els.citationDirection.value = ""; els.citationLimit.value = "20";
      renderResults();
    });
    els.directionForm.addEventListener("submit", event => {
      event.preventDefault();
      const directions = { ...state.settings.directions };
      for (const input of els.directionMappings.querySelectorAll("input")) {
        const label = input.value.trim();
        if (label && label !== input.dataset.direction) Object.defineProperty(directions, input.dataset.direction, { value: label, enumerable: true, configurable: true });
        else delete directions[input.dataset.direction];
      }
      if (saveSettings({ ...state.settings, directions })) app.notify("全局方向已保存，原始引用分类未改动");
    });
    root.addEventListener("hashchange", route);
    root.addEventListener("storage", event => {
      if (event.key !== STORAGE && event.key !== null) return;
      try { state.settings = index.normalizeSettings(JSON.parse(localStorage.getItem(STORAGE) || "{}")); refresh(); }
      catch { app.notify("分析设置同步失败，请刷新后重试"); }
    });
    route();
  }

  function route() {
    const analytics = active();
    els.libraryView.hidden = analytics;
    els.citationsView.hidden = !analytics;
    for (const [link, selected] of [[els.libraryNav, !analytics], [els.citationsNav, analytics]]) {
      if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    document.title = analytics ? "全局引用分析 · 论文总结管理器" : "论文总结管理器";
    if (analytics) refresh();
  }

  function refresh() {
    if (!app || !active()) return;
    state.model = index.build(app.getLibrary(), state.settings);
    const model = state.model;
    const stats = [["来源论文 · 去重", model.sources.length], ["有引用数据", model.sources.filter(s => s.hasReferences).length],
      ["被引文献 · 去重", model.works.length], ["引用关系", model.edgeCount], ["研究方向", model.directions.length]];
    els.analysisStats.replaceChildren(...stats.map(([label, value]) => {
      const card = node("article", "analysis-stat"); card.append(node("span", "", label), node("strong", "", String(value))); return card;
    }));
    const coverage = Object.fromEntries(["complete", "partial", "unavailable", "unknown"].map(status => [status, model.sources.filter(s => s.status === status).length]));
    els.analysisCoverage.textContent = `基于当前浏览器文献库：引用整理完整 ${coverage.complete} 篇，部分 ${coverage.partial} 篇，不可读 ${coverage.unavailable} 篇，状态未知 ${coverage.unknown} 篇。` +
      `排名只反映已导入的引用；参考文献中的软件、文档和网页也保留。${model.importedCount > model.sources.length ? ` ${model.importedCount} 条来源记录已合为 ${model.sources.length} 篇。` : ""}`;
    if (!model.directions.some(d => d.name === state.direction)) state.direction = "";
    const all = node("option", "", "全部方向"); all.value = "";
    els.citationDirection.replaceChildren(all, ...model.directions.map(direction => {
      const option = node("option", "", direction.name); option.value = direction.name; return option;
    }));
    els.citationDirection.value = state.direction;
    renderDirectionSettings();
    renderResults();
  }

  function renderResults() {
    if (!state.model) return;
    const works = index.select(state.model, state);
    const selected = works.find(work => work.id === state.selected) || works[0];
    state.selected = selected?.id || "";
    const shown = state.limit ? works.slice(0, state.limit) : works;
    els.rankingCount.textContent = `${shown.length} / ${works.length} 篇`;
    els.rankingNote.textContent = state.direction ? `当前方向「${state.direction}」内的被引篇数；另列全库篇数。点击条目查看引用来源。` : "按不同来源论文的篇数排序；数值相同按题名排列。点击条目查看引用来源。";
    els.citationRanking.replaceChildren();
    if (!works.length) els.citationRanking.append(small(state.model.works.length ? "没有匹配结果，试试清空搜索或切换方向。" : "还没有可分析的引用。请返回文献库，导入带有“引用脉络”的总结文件。"));
    const max = works[0]?.count || 1;
    shown.forEach((work, position) => {
      const row = action("", "citation-rank", () => {
        state.selected = work.id; renderResults();
        if (root.matchMedia?.("(max-width: 900px)").matches) els.citationSelection.scrollIntoView({ block: "start" });
      });
      row.setAttribute("aria-pressed", String(work.id === state.selected));
      row.setAttribute("aria-label", `${work.title}，被 ${work.count} 篇不同论文引用`);
      row.title = work.title;
      const content = node("span", "rank-content");
      content.append(node("span", "rank-title", work.title), node("span", "rank-meta", [work.year, work.authors,
        work.manual ? "已人工合并" : work.review ? "书目信息需核查" : "标识匹配"].filter(Boolean).join(" · ")));
      const bar = node("span", "rank-track"); const fill = node("span", "rank-fill"); fill.style.width = `${work.count / max * 100}%`; bar.append(fill); content.append(bar);
      const count = node("span", "rank-count"); count.append(node("strong", "", String(work.count)), node("span", "", "篇"));
      if (state.direction) count.append(node("small", "", `全库 ${work.globalCount}`));
      row.append(node("span", "rank-position", String(position + 1).padStart(2, "0")), content, count);
      els.citationRanking.append(row);
    });
    renderDirections();
    renderSelection(selected);
  }

  function renderDirections() {
    const directions = state.model.directions;
    const max = directions[0]?.works.size || 1;
    els.directionChart.replaceChildren();
    for (const direction of directions) {
      const row = action("", "direction-row", () => {
        state.direction = state.direction === direction.name ? "" : direction.name;
        els.citationDirection.value = state.direction;
        renderResults();
      });
      row.setAttribute("aria-pressed", String(direction.name === state.direction));
      const title = node("span", "direction-label", direction.name);
      const track = node("span", "rank-track"); const fill = node("span", "rank-fill"); fill.style.width = `${direction.works.size / max * 100}%`; track.append(fill);
      title.append(track);
      row.append(title, node("span", "direction-value", `${direction.works.size} 篇文献 · ${direction.edges} 条引用关系`));
      els.directionChart.append(row);
    }
    if (!directions.length) els.directionChart.append(small("导入引用分类后，这里会显示方向分布。"));
  }

  function renderDirectionSettings() {
    els.directionMappings.replaceChildren();
    state.model.rawDirections.forEach((direction, position) => {
      const row = node("div", "direction-mapping");
      const label = node("label", "", direction); label.htmlFor = `directionAlias${position}`;
      const input = node("input"); input.id = label.htmlFor; input.type = "text";
      input.value = Object.hasOwn(state.settings.directions, direction) ? state.settings.directions[direction] : "";
      input.placeholder = "保留原名"; input.dataset.direction = direction;
      row.append(label, input); els.directionMappings.append(row);
    });
  }

  function safeLink(work) {
    const doi = index.doiKey(work.doi);
    try {
      const url = new URL(doi ? `https://doi.org/${doi}` : work.url);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function renderSelection(work) {
    const panel = els.citationSelection;
    panel.replaceChildren();
    if (!work) { panel.append(node("h3", "", "引用来源"), small("选择左侧文献，查看哪些论文引用了它。")); return; }
    panel.append(node("p", "eyebrow", "Selected reference"), node("h3", "selected-title", work.title));
    panel.append(small([work.authors, work.year].filter(Boolean).join(" · ")));
    const metric = node("div", "selected-metric");
    metric.append(node("strong", "", String(work.count)), node("span", "", state.direction ? `篇来源论文 · 当前方向（全库 ${work.globalCount} 篇）` : "篇不同的来源论文")); panel.append(metric);
    const tags = node("div", "paper-meta"); for (const direction of work.directions) tags.append(node("span", "badge type-summary", direction)); panel.append(tags);
    const url = safeLink(work);
    if (url) { const link = node("a", "reference-link", work.doi ? `DOI：${work.doi}` : "打开文献链接 ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; panel.append(link); }
    const sources = work.visibleSources;
    panel.append(node("h4", "analysis-subtitle", "引用来源关系图"));
    panel.append(small(`箭头：来源论文 → 选中文献。${sources.length > 12 ? `图中显示前 12 / ${sources.length} 篇，完整来源见下方。` : ""}`));
    panel.append(renderGraph(work, sources.slice(0, 12)));
    panel.append(node("h4", "analysis-subtitle", `来源论文与引用语境 · ${sources.length}`));
    const sourceList = node("div", "citation-sources");
    sources.forEach(edge => {
      const item = node("article", "citation-source");
      item.append(action(edge.source.title, "source-open", () => app.openPaper(edge.source.paperId)));
      const status = { complete: "引用整理完整", partial: "引用部分整理", unavailable: "引用不可读", unknown: "引用整理状态未知" };
      item.append(small([status[edge.source.status], ...edge.source.notes].filter(Boolean).join("；")));
      const contexts = state.direction ? edge.contexts.filter(c => c.direction === state.direction) : edge.contexts;
      for (const context of contexts) {
        const details = node("details", "citation-context");
        details.append(node("summary", "", [context.refId, context.originalDirection].filter(Boolean).join(" · ")));
        details.append(small(`与本文关系：${context.relation || "未提供"}`));
        details.append(small(`分类依据：${context.basis || "未提供"}`));
        if (context.citation) details.append(small(context.citation));
        item.append(details);
      }
      sourceList.append(item);
    });
    panel.append(sourceList);
    renderMergeControls(panel, work);
  }

  function svgNode(tag, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    if (text) element.textContent = text;
    return element;
  }

  function renderGraph(work, sources) {
    const wrapper = node("div", "citation-graph");
    const height = Math.max(200, sources.length * 58 + 30), centerY = height / 2;
    const svg = svgNode("svg", { viewBox: `0 0 640 ${height}`, role: "group", "aria-label": "来源论文指向选中文献的引用关系图" });
    const defs = svgNode("defs", {});
    const marker = svgNode("marker", { id: "citationArrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" });
    marker.append(svgNode("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#579c91" })); defs.append(marker); svg.append(defs);
    sources.forEach((edge, i) => {
      const y = sources.length === 1 ? centerY : 36 + i * 58;
      svg.append(svgNode("path", { d: `M 244 ${y} C 312 ${y}, 330 ${centerY}, 388 ${centerY}`, fill: "none", stroke: "#9cc9c1", "stroke-width": 1.5, "marker-end": "url(#citationArrow)" }));
      const group = svgNode("g", { role: "button", tabindex: 0, "aria-label": `打开来源论文：${edge.source.title}`, class: "graph-source" });
      group.append(svgNode("title", {}, edge.source.title), svgNode("rect", { x: 4, y: y - 21, width: 240, height: 42, rx: 7 }),
        svgNode("text", { x: 16, y: y + 5 }, graphLines(edge.source.title, 32, 1)[0]));
      group.addEventListener("click", () => app.openPaper(edge.source.paperId));
      group.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); app.openPaper(edge.source.paperId); } });
      svg.append(group);
    });
    const target = svgNode("g", { class: "graph-target" });
    target.append(svgNode("title", {}, work.title), svgNode("rect", { x: 396, y: centerY - 59, width: 240, height: 118, rx: 10 }));
    const lines = graphLines(work.title, 30, 3);
    lines.forEach((line, i) => target.append(svgNode("text", { x: 410, y: centerY - 30 + i * 20 }, line)));
    target.append(svgNode("text", { x: 410, y: centerY + 40, class: "graph-count" }, `← ${work.count} 篇来源论文`));
    svg.append(target); wrapper.append(svg); return wrapper;
  }

  function graphLines(value, width, maximum) {
    const characters = Array.from(value), lines = [];
    let line = "", units = 0;
    for (let i = 0; i < characters.length; i++) {
      const character = characters[i], size = character.codePointAt(0) > 255 ? 2 : 1;
      if (units + size > width) {
        if (lines.length === maximum - 1) { lines.push(Array.from(line).slice(0, -1).join("") + "…"); return lines; }
        lines.push(line); line = ""; units = 0;
      }
      line += character; units += size;
    }
    if (line) lines.push(line);
    return lines;
  }

  function renderMergeControls(panel, work) {
    const details = node("details", "analysis-settings");
    details.append(node("summary", "", "文献识别与纠错"));
    details.append(small(`${work.manual ? "含人工确认的合并。" : ""}识别依据：${[...work.methods].join("、")}。${work.review ? "部分条目依赖书目信息或存在歧义，请核对原文。" : ""}`));
    const variants = node("ul", "reference-variants");
    const labels = [...new Set(work.variants.map(ref => [ref.title || ref.citation || ref.ref_id, ref.year, ref.doi].filter(Boolean).join(" · ")))];
    for (const label of labels) variants.append(node("li", "", label)); details.append(variants);
    const label = node("label", "", "确认是同一文献后，选择另一条记录合并"); label.htmlFor = "mergeCitation";
    const select = node("select"); select.id = label.htmlFor;
    const empty = node("option", "", "选择重复文献…"); empty.value = ""; select.append(empty);
    for (const other of state.model.works) {
      if (other.id === work.id) continue;
      const option = node("option", "", `${shorten(other.title, 85)} · ${other.count} 篇`); option.value = other.id; select.append(option);
    }
    const merge = action("确认合并", "button", () => {
      if (!select.value) return;
      const other = state.model.works.find(item => item.id === select.value);
      if (!other || !root.confirm(`将以下两条记录按同一文献统计？\n\n${work.title}\n${other.title}\n\n可撤销，原始引用不会修改。`)) return;
      state.selected = work.id < other.id ? work.id : other.id;
      if (saveSettings({ ...state.settings, merges: [...state.settings.merges, [work.id, other.id]] })) app.notify("文献已合并，同一来源论文仍只计一次");
    });
    details.append(label, select, merge);
    if (state.settings.merges.length) details.append(action("撤销最近一次合并", "button", () => {
      if (saveSettings({ ...state.settings, merges: state.settings.merges.slice(0, -1) })) app.notify("已撤销最近一次文献合并");
    }));
    panel.append(details);
  }

  function saveSettings(settings) {
    const next = index.normalizeSettings(settings);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); }
    catch { app.notify("分析设置未能保存，请检查浏览器存储空间后重试"); return false; }
    state.settings = next; refresh(); return true;
  }

  function importSettings(input) {
    if (!input || typeof input !== "object" || input.version !== 1) return;
    const incoming = index.normalizeSettings(input);
    const merges = [...new Map([...state.settings.merges, ...incoming.merges].map(pair => [JSON.stringify(pair), pair])).values()];
    const next = index.normalizeSettings({ directions: { ...state.settings.directions, ...incoming.directions }, merges });
    if (JSON.stringify(next) === JSON.stringify(state.settings)) return;
    if (!saveSettings(next)) throw new Error("分析设置未能保存");
  }
  root.CitationAnalytics = { init, refresh, getSettings: () => index.normalizeSettings(state.settings), importSettings };
})(window);
