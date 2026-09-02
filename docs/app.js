const STORAGE_KEY = "summarize-paper-library-v1";
const DIMENSIONS = ["研究目的", "主要贡献", "使用技术/方法", "实验与结果", "不足/局限", "未来前景/后续工作"];
const TYPES = ["原文明确", "原文概括", "合理推测", "未提及"];
const CONFIDENCES = ["高", "中", "低"];
const HEADER_MAP = new Map([
  ["维度", "dimension"],
  ["类型", "basis_type"],
  ["总结", "summary"],
  ["原文依据/推测依据", "evidence"],
  ["置信度", "confidence"],
  ["后期核查建议", "review_suggestion"],
]);

let library = [];
let filters = {
  query: "",
  dimension: "all",
  type: "all",
  confidence: "all",
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  hydrateFilters();
  loadLibrary();
  bindEvents();
  render();
});

function bindElements() {
  Object.assign(els, {
    fileInput: document.querySelector("#fileInput"),
    pasteButton: document.querySelector("#pasteButton"),
    exportButton: document.querySelector("#exportButton"),
    searchInput: document.querySelector("#searchInput"),
    dimensionFilter: document.querySelector("#dimensionFilter"),
    typeFilter: document.querySelector("#typeFilter"),
    confidenceFilter: document.querySelector("#confidenceFilter"),
    clearFiltersButton: document.querySelector("#clearFiltersButton"),
    clearLibraryButton: document.querySelector("#clearLibraryButton"),
    paperGrid: document.querySelector("#paperGrid"),
    emptyState: document.querySelector("#emptyState"),
    dropZone: document.querySelector("#dropZone"),
    paperCount: document.querySelector("#paperCount"),
    rowCount: document.querySelector("#rowCount"),
    sourceBackedCount: document.querySelector("#sourceBackedCount"),
    inferredCount: document.querySelector("#inferredCount"),
    resultSummary: document.querySelector("#resultSummary"),
    detailPanel: document.querySelector("#detailPanel"),
    detailSource: document.querySelector("#detailSource"),
    detailTitle: document.querySelector("#detailTitle"),
    detailMeta: document.querySelector("#detailMeta"),
    detailRows: document.querySelector("#detailRows"),
    closeDetailButton: document.querySelector("#closeDetailButton"),
    pasteDialog: document.querySelector("#pasteDialog"),
    pasteText: document.querySelector("#pasteText"),
    pasteImportButton: document.querySelector("#pasteImportButton"),
    toast: document.querySelector("#toast"),
  });
}

function hydrateFilters() {
  fillSelect(els.dimensionFilter, DIMENSIONS);
  fillSelect(els.typeFilter, TYPES);
  fillSelect(els.confidenceFilter, CONFIDENCES);
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function bindEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    await importFiles([...event.target.files]);
    els.fileInput.value = "";
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragover");
  });

  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("is-dragover");
  });

  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragover");
    await importFiles([...event.dataTransfer.files]);
  });

  els.searchInput.addEventListener("input", () => {
    filters.query = els.searchInput.value.trim();
    render();
  });

  els.dimensionFilter.addEventListener("change", () => {
    filters.dimension = els.dimensionFilter.value;
    render();
  });

  els.typeFilter.addEventListener("change", () => {
    filters.type = els.typeFilter.value;
    render();
  });

  els.confidenceFilter.addEventListener("change", () => {
    filters.confidence = els.confidenceFilter.value;
    render();
  });

  els.clearFiltersButton.addEventListener("click", () => {
    filters = { query: "", dimension: "all", type: "all", confidence: "all" };
    els.searchInput.value = "";
    els.dimensionFilter.value = "all";
    els.typeFilter.value = "all";
    els.confidenceFilter.value = "all";
    render();
  });

  els.exportButton.addEventListener("click", exportLibrary);

  els.clearLibraryButton.addEventListener("click", () => {
    if (!library.length || !confirm("清空当前浏览器中的全部文献总结？")) return;
    library = [];
    saveLibrary();
    render();
    toast("本地文献库已清空");
  });

  els.pasteButton.addEventListener("click", () => {
    els.pasteText.value = "";
    els.pasteDialog.showModal();
  });

  els.pasteImportButton.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      const papers = normalizeJsonPayload(JSON.parse(els.pasteText.value));
      mergePapers(papers, "粘贴 JSON");
      els.pasteDialog.close();
    } catch (error) {
      toast(`JSON 导入失败：${error.message}`);
    }
  });

  els.closeDetailButton.addEventListener("click", closeDetail);
  els.detailPanel.addEventListener("click", (event) => {
    if (event.target === els.detailPanel) closeDetail();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
}

function loadLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    library = Array.isArray(saved) ? saved.map(normalizePaper).filter(Boolean) : [];
  } catch {
    library = [];
  }
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library, null, 2));
}

async function importFiles(files) {
  if (!files.length) return;
  const imported = [];
  const errors = [];

  for (const file of files) {
    try {
      const papers = await parseFile(file);
      imported.push(...papers);
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  if (imported.length) mergePapers(imported, "文件导入");
  if (errors.length) toast(`部分文件导入失败：${errors.join("；")}`);
}

async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    return normalizeJsonPayload(JSON.parse(await file.text()), file.name);
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return [parseMarkdown(await file.text(), file.name)];
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return [await parseWorkbook(file)];
  }
  throw new Error("仅支持 .xlsx、.xls、.json、.md");
}

function normalizeJsonPayload(payload, sourceFile = "summary.json") {
  if (Array.isArray(payload)) {
    return payload.map((item, index) => normalizePaper({ ...item, sourceFile: item.sourceFile || sourceFile, fallbackIndex: index }));
  }
  if (payload && Array.isArray(payload.papers)) {
    return payload.papers.map((item, index) => normalizePaper({ ...item, sourceFile: item.sourceFile || sourceFile, fallbackIndex: index }));
  }
  if (payload && Array.isArray(payload.rows)) {
    return [normalizePaper({
      title: payload.paper_title || payload.title,
      rows: payload.rows,
      sourceFile,
    })];
  }
  throw new Error("JSON 需要包含 rows 数组或 papers 数组");
}

async function parseWorkbook(file) {
  if (!window.XLSX) {
    throw new Error("Excel 解析库未加载，请刷新页面或检查网络");
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("论文总结")) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("工作簿没有工作表");

  const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const titleCell = String(matrix[0]?.[0] || "").trim();
  const title = titleCell.replace(/^论文总结[:：]\s*/, "") || file.name.replace(/\.(xlsx|xls)$/i, "");
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell).trim() === "维度"));
  if (headerIndex < 0) throw new Error("未找到包含“维度”的表头行");

  const headers = matrix[headerIndex].map((cell) => String(cell).trim());
  const rows = matrix.slice(headerIndex + 1).map((line) => rowFromHeaders(headers, line)).filter((row) => row.summary || row.dimension);
  if (!rows.length) throw new Error("没有读到总结行");

  return normalizePaper({ title, rows, sourceFile: file.name });
}

function rowFromHeaders(headers, values) {
  const row = {};
  headers.forEach((header, index) => {
    const key = HEADER_MAP.get(header);
    if (key) row[key] = cleanCell(values[index]);
  });
  return normalizeRow(row);
}

function parseMarkdown(text, sourceFile = "summary.md") {
  const title = (text.match(/^#\s*论文总结[:：]\s*(.+)$/m)?.[1] || sourceFile.replace(/\.(md|markdown)$/i, "")).trim();
  const table = extractMarkdownTable(text);
  const rows = table.map((cells) => normalizeRow({
    dimension: cells[0],
    basis_type: cells[1],
    summary: cells[2],
    evidence: cells[3],
    confidence: "",
    review_suggestion: "",
  })).filter((row) => row.summary || row.dimension);
  if (!rows.length) throw new Error("Markdown 中没有读到逐项总结表格");
  return normalizePaper({ title, rows, sourceFile });
}

function extractMarkdownTable(text) {
  const start = text.indexOf("## 逐项总结");
  const end = text.indexOf("## 推测内容清单", start);
  const block = text.slice(start >= 0 ? start : 0, end >= 0 ? end : text.length);
  return block.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-+/.test(line) && !/^\|\s*维度\s*\|/.test(line))
    .map(splitMarkdownRow)
    .filter((cells) => cells.length >= 4);
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/<br\s*\/?>/gi, "\n"));
}

function normalizePaper(input) {
  const rows = (input.rows || []).map(normalizeRow).filter((row) => row.dimension || row.summary);
  if (!rows.length) return null;
  const title = cleanCell(input.paper_title || input.title || input.name || `未命名论文 ${input.fallbackIndex || ""}`).trim() || "未命名论文";
  const sourceFile = cleanCell(input.sourceFile || input.source_file || "手动导入");
  const fingerprint = hashString(`${title}\n${JSON.stringify(rows)}`);
  return {
    id: input.id || fingerprint,
    fingerprint,
    title,
    sourceFile,
    importedAt: input.importedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rows,
  };
}

function normalizeRow(input) {
  return {
    dimension: cleanCell(input.dimension || input["维度"]),
    basis_type: cleanCell(input.basis_type || input.type || input["类型"]),
    summary: cleanCell(input.summary || input["总结"]),
    evidence: cleanCell(input.evidence || input["原文依据/推测依据"]),
    confidence: cleanCell(input.confidence || input["置信度"]),
    review_suggestion: cleanCell(input.review_suggestion || input.reviewSuggestion || input["后期核查建议"]),
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mergePapers(papers, sourceLabel) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const paper of papers.filter(Boolean)) {
    const sameFingerprint = library.find((item) => item.fingerprint === paper.fingerprint);
    if (sameFingerprint) {
      skipped += 1;
      continue;
    }

    const sameTitleIndex = library.findIndex((item) => item.title === paper.title);
    if (sameTitleIndex >= 0) {
      library[sameTitleIndex] = {
        ...paper,
        id: library[sameTitleIndex].id,
        importedAt: library[sameTitleIndex].importedAt,
      };
      updated += 1;
    } else {
      library.unshift(paper);
      added += 1;
    }
  }

  saveLibrary();
  render();
  toast(`${sourceLabel}完成：新增 ${added} 篇，更新 ${updated} 篇，跳过重复 ${skipped} 篇`);
}

function render() {
  const visible = getVisiblePapers();
  renderStats();
  renderCards(visible);
  els.emptyState.style.display = library.length ? "none" : "block";
  els.resultSummary.textContent = library.length
    ? `显示 ${visible.length} / ${library.length} 篇文献`
    : "暂无文献";
}

function renderStats() {
  const rows = library.flatMap((paper) => paper.rows);
  els.paperCount.textContent = library.length;
  els.rowCount.textContent = rows.length;
  els.sourceBackedCount.textContent = rows.filter((row) => row.basis_type === "原文明确" || row.basis_type === "原文概括").length;
  els.inferredCount.textContent = rows.filter((row) => row.basis_type === "合理推测").length;
}

function getVisiblePapers() {
  return library
    .map((paper) => ({ ...paper, visibleRows: filterRows(paper.rows, paper.title, paper.sourceFile) }))
    .filter((paper) => paper.visibleRows.length);
}

function filterRows(rows, title, sourceFile) {
  const query = filters.query.toLowerCase();
  return rows.filter((row) => {
    if (filters.dimension !== "all" && row.dimension !== filters.dimension) return false;
    if (filters.type !== "all" && row.basis_type !== filters.type) return false;
    if (filters.confidence !== "all" && row.confidence !== filters.confidence) return false;
    if (!query) return true;
    const haystack = [title, sourceFile, row.dimension, row.basis_type, row.summary, row.evidence, row.confidence, row.review_suggestion].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderCards(papers) {
  els.paperGrid.replaceChildren();

  for (const paper of papers) {
    const card = document.createElement("article");
    card.className = "paper-card";

    const header = document.createElement("header");
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = paper.title;
    const meta = document.createElement("div");
    meta.className = "paper-meta";
    meta.append(
      badge(`${paper.rows.length} 行总结`),
      badge(formatDate(paper.importedAt)),
      ...typeBadges(paper.rows),
    );
    titleWrap.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const detailButton = button("查看", "tiny-button");
    detailButton.addEventListener("click", () => openDetail(paper.id));
    const deleteButton = button("删", "tiny-button");
    deleteButton.title = "删除这篇文献";
    deleteButton.addEventListener("click", () => deletePaper(paper.id));
    actions.append(detailButton, deleteButton);
    header.append(titleWrap, actions);

    const dimensionList = document.createElement("div");
    dimensionList.className = "dimension-list";
    for (const dimension of DIMENSIONS) {
      const rows = paper.visibleRows.filter((row) => row.dimension === dimension);
      if (!rows.length) continue;
      const item = document.createElement("div");
      item.className = "dimension-item";
      const label = document.createElement("strong");
      label.textContent = `${dimension} · ${rows.length}`;
      const summary = document.createElement("p");
      summary.textContent = rows.map((row) => row.summary).join(" ");
      item.append(label, summary);
      dimensionList.append(item);
    }

    const footer = document.createElement("div");
    footer.className = "card-footer";
    const source = document.createElement("span");
    source.className = "source-name";
    source.textContent = paper.sourceFile;
    const fullButton = button("打开详情", "button compact");
    fullButton.addEventListener("click", () => openDetail(paper.id));
    footer.append(source, fullButton);

    card.append(header, dimensionList, footer);
    els.paperGrid.append(card);
  }
}

function openDetail(id) {
  const paper = library.find((item) => item.id === id);
  if (!paper) return;
  const rows = filterRows(paper.rows, paper.title, paper.sourceFile);

  els.detailSource.textContent = paper.sourceFile;
  els.detailTitle.textContent = paper.title;
  els.detailMeta.replaceChildren(
    badge(`${paper.rows.length} 行总结`),
    badge(`导入 ${formatDate(paper.importedAt)}`),
    ...typeBadges(paper.rows),
  );
  els.detailRows.replaceChildren();

  for (const dimension of DIMENSIONS) {
    const groupRows = rows.filter((row) => row.dimension === dimension);
    for (const row of groupRows) {
      els.detailRows.append(renderDetailRow(row));
    }
  }

  els.detailPanel.classList.add("is-open");
  els.detailPanel.setAttribute("aria-hidden", "false");
}

function renderDetailRow(row) {
  const wrapper = document.createElement("article");
  wrapper.className = "detail-row";

  const head = document.createElement("div");
  head.className = "detail-row-head";
  const dimension = document.createElement("h3");
  dimension.textContent = row.dimension || "未标注维度";
  head.append(dimension, badge(row.basis_type || "未标注", typeClass(row.basis_type)));

  const summary = document.createElement("p");
  summary.textContent = row.summary || "无总结内容";
  wrapper.append(head, summary);

  if (row.evidence) {
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    evidence.textContent = `依据：${row.evidence}`;
    wrapper.append(evidence);
  }

  if (row.confidence || row.review_suggestion) {
    const review = document.createElement("div");
    review.className = "review";
    review.textContent = `置信度：${row.confidence || "未标注"}${row.review_suggestion ? `；核查建议：${row.review_suggestion}` : ""}`;
    wrapper.append(review);
  }

  return wrapper;
}

function closeDetail() {
  els.detailPanel.classList.remove("is-open");
  els.detailPanel.setAttribute("aria-hidden", "true");
}

function deletePaper(id) {
  const paper = library.find((item) => item.id === id);
  if (!paper || !confirm(`删除“${paper.title}”？`)) return;
  library = library.filter((item) => item.id !== id);
  saveLibrary();
  closeDetail();
  render();
  toast("已删除这篇文献");
}

function exportLibrary() {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), papers: library }, null, 2);
  const blob = new Blob([data], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `summarize-paper-library-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function typeBadges(rows) {
  const counts = countBy(rows, "basis_type");
  return TYPES.filter((type) => counts[type]).map((type) => badge(`${type} ${counts[type]}`, typeClass(type)));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "未标注";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function badge(text, className = "") {
  const span = document.createElement("span");
  span.className = `badge ${className}`.trim();
  span.textContent = text;
  return span;
}

function button(text, className) {
  const el = document.createElement("button");
  el.className = className;
  el.type = "button";
  el.textContent = text;
  return el;
}

function typeClass(type) {
  if (type === "原文明确") return "type-original";
  if (type === "原文概括") return "type-summary";
  if (type === "合理推测") return "type-inferred";
  if (type === "未提及") return "type-missing";
  return "";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 3600);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `paper-${(hash >>> 0).toString(16)}`;
}
