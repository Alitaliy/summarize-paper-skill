const STORAGE_KEY = "summarize-paper-library-v2";
const LEGACY_STORAGE_KEY = "summarize-paper-library-v1";
const HANDLE_DB = "summarize-paper-library-handles";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "watch-directory";
const SCAN_INTERVAL_MS = 5000;
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
const SUPPORTED_FILE_RE = /\.(xlsx|xls|json|md|markdown)$/i;
const WATCH_OUTPUT_FILE_RE = /(^|\/)(summary|paper_summary|[^/]+_paper_summary)\.(xlsx|xls|json|md|markdown)$/i;
const IGNORED_IMPORT_RE = /(^|\/)(manifest|package-lock|package)\.json$/i;
const IGNORED_DIRECTORY_RE = /(^|\/)(\.git|node_modules|__pycache__|\.tmp-chrome-[^/]+)$/i;
const WATCH_FILE_PRIORITY = { ".json": 1, ".xlsx": 2, ".xls": 2, ".md": 3, ".markdown": 3 };

let library = [];
let filters = { query: "", dimension: "all", type: "all", confidence: "all" };
let watchedDirectoryHandle = null;
let scanTimer = null;
let lastScanSignature = "";
let scanning = false;
let lastScanAt = null;
let watchedFileCount = 0;
let watchedFolderCount = 0;
let watchedImportFileCount = 0;
let skippedScanIssueCount = 0;
let importErrorCount = 0;

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  hydrateFilters();
  loadLibrary();
  bindEvents();
  render();
  await restoreWatchedDirectory();
});

function bindElements() {
  Object.assign(els, {
    fileInput: document.querySelector("#fileInput"),
    watchButton: document.querySelector("#watchButton"),
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
    watchPanel: document.querySelector("#watchPanel"),
    watchTitle: document.querySelector("#watchTitle"),
    watchText: document.querySelector("#watchText"),
    watchMeta: document.querySelector("#watchMeta"),
    detailPanel: document.querySelector("#detailPanel"),
    detailSource: document.querySelector("#detailSource"),
    detailTitle: document.querySelector("#detailTitle"),
    detailMeta: document.querySelector("#detailMeta"),
    detailOverview: document.querySelector("#detailOverview"),
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
  els.watchButton.addEventListener("click", chooseWatchDirectory);

  els.fileInput.addEventListener("change", async (event) => {
    await importFiles([...event.target.files], "文件导入");
    els.fileInput.value = "";
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragover");
  });

  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("is-dragover"));

  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragover");
    await importFiles([...event.dataTransfer.files], "拖拽导入");
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
    if (!library.length || !confirm("清空当前浏览器中的全部文献总结？监听目录中的原始文件不会被删除。")) return;
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
      const papers = normalizeJsonPayload(JSON.parse(els.pasteText.value), "粘贴 JSON");
      mergePapers(papers, "粘贴 JSON", { forceToast: true });
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
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    library = Array.isArray(saved) ? saved.map(normalizePaper).filter(Boolean) : [];
  } catch {
    library = [];
  }
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library, null, 2));
}

async function chooseWatchDirectory() {
  if (!window.showDirectoryPicker) {
    toast("当前浏览器不支持目录监听，请使用新版 Chrome 或 Edge");
    return;
  }

  try {
    watchedDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
    lastScanSignature = "";
    await saveDirectoryHandle(watchedDirectoryHandle);
    await startWatchingDirectory(true);
  } catch (error) {
    if (error.name !== "AbortError") toast(`监听文件夹失败：${error.message}`);
  }
}

async function restoreWatchedDirectory() {
  if (!window.showDirectoryPicker || !window.indexedDB) {
    updateWatchStatus("manual");
    return;
  }

  try {
    const handle = await readDirectoryHandle();
    if (!handle) {
      updateWatchStatus("manual");
      return;
    }
    const allowed = await ensureReadPermission(handle, false);
    if (!allowed) {
      watchedDirectoryHandle = handle;
      updateWatchStatus("needs-permission");
      return;
    }
    watchedDirectoryHandle = handle;
    await startWatchingDirectory(false);
  } catch {
    updateWatchStatus("manual");
  }
}

async function startWatchingDirectory(showToast) {
  if (!watchedDirectoryHandle) return;
  const allowed = await ensureReadPermission(watchedDirectoryHandle, true);
  if (!allowed) {
    updateWatchStatus("needs-permission");
    toast("没有读取权限，无法监听这个文件夹");
    return;
  }

  clearInterval(scanTimer);
  updateWatchStatus("scanning");
  const started = await scanWatchedDirectory({ showToast });
  if (!started) return;
  scanTimer = setInterval(() => scanWatchedDirectory({ showToast: false }), SCAN_INTERVAL_MS);
  updateWatchStatus("watching");
}

async function scanWatchedDirectory({ showToast }) {
  if (!watchedDirectoryHandle || scanning) return false;
  scanning = true;
  try {
    const scanStats = createScanStats();
    const files = [];
    for await (const item of walkSummaryOutputFiles(watchedDirectoryHandle, "", scanStats)) files.push(item);
    files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
    const importFiles = selectPreferredSummaryFiles(files);
    const signature = files.map((item) => `${item.path}:${item.file.size}:${item.file.lastModified}`).join("|");
    watchedFileCount = files.length;
    watchedFolderCount = scanStats.folders.size;
    watchedImportFileCount = importFiles.length;
    skippedScanIssueCount = scanStats.skipped.length;
    importErrorCount = 0;

    if (signature && (signature !== lastScanSignature || showToast)) {
      const papers = [];
      const errors = [];
      const companionMetadata = await readCompanionMarkdownMetadata(files);
      for (const item of importFiles) {
        try {
          const parsed = await parseFile(item.file, item.path);
          const metadata = companionMetadata.get(summaryGroupKey(item.path));
          papers.push(...parsed.map((paper) => mergePaperMetadata(paper, metadata)));
        } catch (error) {
          errors.push(`${item.path}: ${error.message}`);
        }
      }
      importErrorCount = errors.length;
      mergePapers(papers, "自动扫描", { forceToast: showToast, quietWhenNoChange: !showToast });
      if (errors.length && showToast) toast(`部分文件未导入：${errors.slice(0, 3).join("；")}`);
      if (papers.length || errors.length < importFiles.length) lastScanSignature = signature;
    }

    lastScanAt = new Date();
    updateWatchStatus("watching");
    return true;
  } catch (error) {
    updateWatchStatus("error", error.message);
    return false;
  } finally {
    scanning = false;
  }
}

function createScanStats() {
  return { folders: new Set(), skipped: [] };
}

async function* walkSummaryOutputFiles(directoryHandle, prefix = "", stats = createScanStats()) {
  try {
    for await (const [name, handle] of directoryHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        if (IGNORED_DIRECTORY_RE.test(path)) continue;
        stats.folders.add(path);
        yield* walkSummaryOutputFiles(handle, path, stats);
      } else if (handle.kind === "file" && isWatchOutputFile(path)) {
        try {
          yield { path, file: await handle.getFile() };
        } catch (error) {
          stats.skipped.push({ path, message: error.message || error.name || "无法读取文件" });
        }
      }
    }
  } catch (error) {
    if (!prefix) throw error;
    stats.skipped.push({ path: prefix, message: error.message || error.name || "无法读取目录" });
  }
}

function isWatchOutputFile(path) {
  return WATCH_OUTPUT_FILE_RE.test(path) && !IGNORED_IMPORT_RE.test(path);
}

function selectPreferredSummaryFiles(files) {
  const grouped = new Map();
  for (const item of files) {
    const key = summaryGroupKey(item.path);
    const existing = grouped.get(key);
    if (!existing || compareSummaryPreference(item, existing) < 0) grouped.set(key, item);
  }
  return [...grouped.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
}

function summaryGroupKey(path) {
  const parts = path.split("/");
  const fileName = parts.pop() || path;
  const parent = parts.join("/");
  if (parent) return parent.toLowerCase();
  return fileName.replace(/\.(xlsx|xls|json|md|markdown)$/i, "").replace(/(?:_?paper)?_?summary$/i, "").toLowerCase() || fileName.toLowerCase();
}

function compareSummaryPreference(a, b) {
  const byPriority = summaryFilePriority(a.path) - summaryFilePriority(b.path);
  if (byPriority) return byPriority;
  return b.file.lastModified - a.file.lastModified;
}

function summaryFilePriority(path) {
  const suffix = path.toLowerCase().match(/\.(xlsx|xls|json|md|markdown)$/)?.[0] || "";
  return WATCH_FILE_PRIORITY[suffix] || 99;
}

async function readCompanionMarkdownMetadata(files) {
  const metadata = new Map();
  for (const item of files) {
    if (!isMarkdownPath(item.path)) continue;
    try {
      const info = parseMarkdownMetadata(await item.file.text(), item.path);
      if (hasPaperMetadata(info)) metadata.set(summaryGroupKey(item.path), info);
    } catch {
      // Metadata is optional; a bad Markdown companion should not block JSON/Excel import.
    }
  }
  return metadata;
}

function isMarkdownPath(path) {
  return /\.(md|markdown)$/i.test(path);
}

async function ensureReadPermission(handle, requestIfNeeded) {
  const options = { mode: "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  if (requestIfNeeded && (await handle.requestPermission(options)) === "granted") return true;
  return false;
}

function saveDirectoryHandle(handle) {
  if (!window.indexedDB) return Promise.resolve();
  return withHandleStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

function readDirectoryHandle() {
  if (!window.indexedDB) return Promise.resolve(null);
  return withHandleStore("readonly", (store) => store.get(HANDLE_KEY));
}

function withHandleStore(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(HANDLE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDLE_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(HANDLE_STORE, mode);
      const request = action(tx.objectStore(HANDLE_STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    };
  });
}

async function importFiles(files, sourceLabel) {
  if (!files.length) return;
  const imported = [];
  const errors = [];

  for (const file of files) {
    try {
      const papers = await parseFile(file, file.name);
      imported.push(...papers);
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  if (imported.length) mergePapers(imported, sourceLabel, { forceToast: true });
  if (errors.length) toast(`部分文件导入失败：${errors.join("；")}`);
}

async function parseFile(file, sourcePath = file.name) {
  const name = sourcePath.toLowerCase();
  if (name.endsWith(".json")) return normalizeJsonPayload(JSON.parse(await file.text()), sourcePath);
  if (name.endsWith(".md") || name.endsWith(".markdown")) return [parseMarkdown(await file.text(), sourcePath)];
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return [await parseWorkbook(file, sourcePath)];
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
    return [normalizePaper({ ...payload, title: payload.paper_title || payload.title, rows: payload.rows, sourceFile })];
  }
  throw new Error("JSON 需要包含 rows 数组或 papers 数组");
}

async function parseWorkbook(file, sourcePath) {
  if (!window.XLSX) throw new Error("Excel 解析库未加载，请刷新页面或检查网络");
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("论文总结")) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("工作簿没有工作表");

  const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const titleCell = String(matrix[0]?.[0] || "").trim();
  const title = titleCell.replace(/^论文总结[:：]\s*/, "") || sourcePath.replace(/\.(xlsx|xls)$/i, "");
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell).trim() === "维度"));
  if (headerIndex < 0) throw new Error("未找到包含“维度”的表头行");

  const headers = matrix[headerIndex].map((cell) => String(cell).trim());
  const rows = matrix.slice(headerIndex + 1).map((line) => rowFromHeaders(headers, line)).filter((row) => row.summary || row.dimension);
  if (!rows.length) throw new Error("没有读到总结行");
  return normalizePaper({ title, rows, sourceFile: sourcePath });
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
  const metadata = parseMarkdownMetadata(text, sourceFile);
  const title = metadata.title || (text.match(/^#\s*论文总结[:：]\s*(.+)$/m)?.[1] || sourceFile.replace(/\.(md|markdown)$/i, "")).trim();
  const rows = parseGroupedMarkdown(text).concat(parseMarkdownTable(text));
  const normalized = rows.map(normalizeRow).filter((row) => row.summary || row.dimension);
  if (!normalized.length) throw new Error("Markdown 中没有读到逐项总结内容");
  return normalizePaper({ ...metadata, title, rows: normalized, sourceFile });
}

function parseMarkdownMetadata(text, sourceFile = "summary.md") {
  const title = (text.match(/^#\s*论文总结[:：]\s*(.+)$/m)?.[1] || sourceFile.replace(/\.(md|markdown)$/i, "")).trim();
  const basicInfo = parseBasicInfoBlock(text);
  const overview = cleanMarkdownText(extractSection(text, "总览"));
  const venue = basicInfo["年份/会议或期刊"] || basicInfo["会议或期刊"] || basicInfo["期刊"] || basicInfo["年份"];
  return {
    title,
    authors: basicInfo["作者"],
    venue,
    year: extractYear(venue || basicInfo["年份"]),
    field: basicInfo["研究领域"],
    integrity: basicInfo["资料完整性说明"],
    overview,
  };
}

function parseBasicInfoBlock(text) {
  const block = extractSection(text, "基本信息");
  const info = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^[-*]\s*([^：:]+)[：:]\s*(.+)$/);
    if (match) info[match[1].trim()] = cleanMarkdownText(match[2]);
  }
  return info;
}

function extractSection(text, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m");
  const match = text.match(pattern);
  if (!match) return "";
  const start = (match.index || 0) + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function cleanMarkdownText(value) {
  return cleanCell(String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/gm, ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractYear(value) {
  return String(value || "").match(/(?:19|20)\d{2}/)?.[0] || "";
}

function parseGroupedMarkdown(text) {
  const start = text.indexOf("## 逐项总结");
  if (start < 0) return [];
  const endCandidates = ["## 推测内容清单", "## 需注意的原文限制"].map((heading) => text.indexOf(heading, start + 1)).filter((index) => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  const block = text.slice(start, end);
  const rows = [];
  let dimension = "";
  for (const line of block.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+)/);
    if (heading) {
      dimension = heading[1].trim();
      continue;
    }
    const item = line.match(/^[-*]\s+(?:【([^】]+)】\s*)?(.+)/);
    if (!item || !dimension) continue;
    const tags = (item[1] || "").split(/[|｜]/).map((value) => value.trim()).filter(Boolean);
    rows.push({
      dimension,
      basis_type: tags.find((tag) => TYPES.includes(tag)) || "原文概括",
      confidence: tags.find((tag) => CONFIDENCES.includes(tag)) || "",
      summary: item[2].replace(/（依据[:：].*?）$/, "").trim(),
      evidence: item[2].match(/（依据[:：](.*?)）$/)?.[1]?.trim() || "",
      review_suggestion: "",
    });
  }
  return rows;
}

function parseMarkdownTable(text) {
  const start = text.indexOf("## 逐项总结");
  const end = text.indexOf("## 推测内容清单", start);
  const block = text.slice(start >= 0 ? start : 0, end >= 0 ? end : text.length);
  return block.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-+/.test(line) && !/^\|\s*维度\s*\|/.test(line))
    .map(splitMarkdownRow)
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({ dimension: cells[0], basis_type: cells[1], summary: cells[2], evidence: cells[3], confidence: "", review_suggestion: "" }));
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
  const title = cleanCell(input.paper_title || input.title || input.name || `未命名论文 ${input.fallbackIndex || ""}`) || "未命名论文";
  const sourceFile = cleanCell(input.sourceFile || input.source_file || "手动导入");
  const fingerprint = hashString(`${title}\n${JSON.stringify(rows)}`);
  const venue = cleanCell(input.venue || input.journal || input.publication || input["年份/会议或期刊"]);
  const year = cleanCell(input.year || extractYear(venue));
  const overview = cleanCell(input.overview || input.abstract || input.brief || buildPaperBrief(rows));
  return {
    id: input.id || `paper-${hashString(title)}`,
    fingerprint,
    title,
    authors: cleanCell(input.authors || input.author || input["作者"]),
    venue,
    year,
    field: cleanCell(input.field || input.research_field || input.topic || input["研究领域"]),
    integrity: cleanCell(input.integrity || input.source_quality || input["资料完整性说明"]),
    overview,
    sourceFile,
    importedAt: input.importedAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
    rows,
  };
}

function buildPaperBrief(rows) {
  const preferred = rows.find((row) => row.dimension === "主要贡献" && row.summary)
    || rows.find((row) => row.dimension === "研究目的" && row.summary)
    || rows.find((row) => row.summary);
  return preferred?.summary || "";
}

function hasPaperMetadata(metadata) {
  return Boolean(metadata && (metadata.authors || metadata.venue || metadata.year || metadata.field || metadata.overview || metadata.integrity));
}

function mergePaperMetadata(paper, metadata) {
  if (!paper || !hasPaperMetadata(metadata)) return paper;
  return {
    ...paper,
    authors: paper.authors || metadata.authors || "",
    venue: paper.venue || metadata.venue || "",
    year: paper.year || metadata.year || "",
    field: paper.field || metadata.field || "",
    integrity: paper.integrity || metadata.integrity || "",
    overview: paper.overview || metadata.overview || "",
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

function mergePapers(papers, sourceLabel, options = {}) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const paper of papers.filter(Boolean)) {
    const sameFingerprint = library.find((item) => item.fingerprint === paper.fingerprint);
    if (sameFingerprint) {
      if (applyPaperMetadataUpdate(sameFingerprint, paper)) {
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const sameTitleIndex = library.findIndex((item) => normalizeKey(item.title) === normalizeKey(paper.title));
    if (sameTitleIndex >= 0) {
      const existing = library[sameTitleIndex];
      library[sameTitleIndex] = {
        ...paper,
        id: existing.id,
        importedAt: existing.importedAt,
        authors: paper.authors || existing.authors || "",
        venue: paper.venue || existing.venue || "",
        year: paper.year || existing.year || "",
        field: paper.field || existing.field || "",
        integrity: paper.integrity || existing.integrity || "",
        overview: paper.overview || existing.overview || "",
        sourceFile: mergeSourceNames(existing.sourceFile, paper.sourceFile),
      };
      updated += 1;
    } else {
      library.unshift(paper);
      added += 1;
    }
  }

  library.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  saveLibrary();
  render();

  if (options.forceToast || (!options.quietWhenNoChange && (added || updated))) {
    toast(`${sourceLabel}完成：新增 ${added} 篇，更新 ${updated} 篇，跳过重复 ${skipped} 篇`);
  }
}

function applyPaperMetadataUpdate(existing, incoming) {
  let changed = false;
  for (const key of ["authors", "venue", "year", "field", "integrity", "overview"]) {
    if (!existing[key] && incoming[key]) {
      existing[key] = incoming[key];
      changed = true;
    }
  }
  if (incoming.sourceFile) {
    const merged = mergeSourceNames(existing.sourceFile, incoming.sourceFile);
    if (merged !== existing.sourceFile) {
      existing.sourceFile = merged;
      changed = true;
    }
  }
  if (changed) existing.updatedAt = new Date().toISOString();
  return changed;
}

function mergeSourceNames(a, b) {
  const names = new Set(String(a || "").split("；").concat(String(b || "").split("；")).map((item) => item.trim()).filter(Boolean));
  return [...names].slice(0, 6).join("；");
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function render() {
  const visible = getVisiblePapers();
  renderStats();
  renderWatchStatusMeta();
  renderCards(visible);
  els.emptyState.style.display = library.length ? "none" : "block";
  els.resultSummary.textContent = library.length ? `显示 ${visible.length} / ${library.length} 篇文献` : "暂无文献";
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
    .map((paper) => ({ ...paper, visibleRows: filterRows(paper.rows, paper) }))
    .filter((paper) => paper.visibleRows.length);
}

function filterRows(rows, paperOrTitle, maybeSourceFile = "") {
  const paper = typeof paperOrTitle === "object"
    ? paperOrTitle
    : { title: paperOrTitle, sourceFile: maybeSourceFile };
  const query = filters.query.toLowerCase();
  return rows.filter((row) => {
    if (filters.dimension !== "all" && row.dimension !== filters.dimension) return false;
    if (filters.type !== "all" && row.basis_type !== filters.type) return false;
    if (filters.confidence !== "all" && row.confidence !== filters.confidence) return false;
    if (!query) return true;
    const haystack = [
      paper.title,
      paper.sourceFile,
      paper.authors,
      paper.venue,
      paper.year,
      paper.field,
      paper.overview,
      row.dimension,
      row.basis_type,
      row.summary,
      row.evidence,
      row.confidence,
      row.review_suggestion,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderCards(papers) {
  els.paperGrid.replaceChildren();

  for (const paper of papers) {
    const card = document.createElement("article");
    card.className = "paper-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `打开论文详情：${paper.title}`);
    card.addEventListener("click", () => openDetail(paper.id));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDetail(paper.id);
    });

    const title = document.createElement("h3");
    title.className = "paper-card-title";
    title.textContent = paper.title;

    const venue = document.createElement("p");
    venue.className = "paper-card-venue";
    venue.textContent = compactVenue(paper) || "期刊/会议未标注";

    const topic = document.createElement("p");
    topic.className = "paper-card-topic";
    topic.textContent = paper.field || inferTopic(paper.rows) || "主题未标注";

    const brief = document.createElement("p");
    brief.className = "paper-card-brief";
    brief.textContent = shortText(paper.overview || buildPaperBrief(paper.visibleRows || paper.rows), 82);

    const footer = document.createElement("div");
    footer.className = "paper-card-foot";
    const count = document.createElement("span");
    count.textContent = `${paper.rows.length} 点`;
    const deleteButton = button("删", "tiny-button");
    deleteButton.title = "从浏览器本地库删除这篇文献";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePaper(paper.id);
    });
    footer.append(count, deleteButton);

    card.append(title, venue, topic, brief, footer);
    els.paperGrid.append(card);
  }
}

function renderDimensionSummary(dimension, rows) {
  const item = document.createElement("section");
  item.className = "dimension-item";
  const label = document.createElement("strong");
  label.textContent = `${dimension} · ${rows.length} 点`;
  const list = document.createElement("ul");
  list.className = "summary-points";
  for (const row of rows.slice(0, 4)) {
    const li = document.createElement("li");
    li.textContent = row.summary || "无总结内容";
    list.append(li);
  }
  if (rows.length > 4) {
    const li = document.createElement("li");
    li.textContent = `另有 ${rows.length - 4} 点，打开详情查看`;
    li.className = "more-point";
    list.append(li);
  }
  item.append(label, list);
  return item;
}

function openDetail(id) {
  const paper = library.find((item) => item.id === id);
  if (!paper) return;
  const rows = filterRows(paper.rows, paper);

  els.detailSource.textContent = paper.sourceFile;
  els.detailTitle.textContent = paper.title;
  els.detailMeta.replaceChildren(...paperDetailBadges(paper));
  els.detailOverview.textContent = paper.overview || buildPaperBrief(paper.rows);
  els.detailOverview.style.display = els.detailOverview.textContent ? "block" : "none";
  els.detailRows.replaceChildren();

  for (const [dimension, groupRows] of groupRowsByDimension(rows)) {
    els.detailRows.append(renderDetailSection(dimension, groupRows));
  }

  els.detailPanel.classList.add("is-open");
  els.detailPanel.setAttribute("aria-hidden", "false");
}

function renderDetailSection(dimension, rows) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("div");
  heading.className = "detail-section-head";
  const title = document.createElement("h3");
  title.textContent = dimension || "未标注维度";
  heading.append(title, badge(`${rows.length} 点`));
  section.append(heading);

  const list = document.createElement("div");
  list.className = "detail-point-list";
  for (const row of rows) list.append(renderDetailPoint(row));
  section.append(list);
  return section;
}

function renderDetailPoint(row) {
  const wrapper = document.createElement("article");
  wrapper.className = "detail-row";

  const head = document.createElement("div");
  head.className = "detail-row-head";
  const tags = document.createElement("div");
  tags.className = "paper-meta";
  tags.append(badge(row.basis_type || "未标注", typeClass(row.basis_type)));
  if (row.confidence) tags.append(badge(`置信度 ${row.confidence}`));
  head.append(tags);

  const summary = document.createElement("p");
  summary.textContent = row.summary || "无总结内容";
  wrapper.append(head, summary);

  if (row.evidence) {
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    evidence.textContent = `依据：${row.evidence}`;
    wrapper.append(evidence);
  }

  if (row.review_suggestion) {
    const review = document.createElement("div");
    review.className = "review";
    review.textContent = `核查建议：${row.review_suggestion}`;
    wrapper.append(review);
  }

  return wrapper;
}

function groupRowsByDimension(rows) {
  const known = new Map(DIMENSIONS.map((dimension) => [dimension, []]));
  const other = new Map();
  for (const row of rows) {
    const target = known.has(row.dimension) ? known : other;
    if (!target.has(row.dimension)) target.set(row.dimension || "未标注维度", []);
    target.get(row.dimension || "未标注维度").push(row);
  }
  return [...known.entries(), ...other.entries()].filter(([, groupRows]) => groupRows.length);
}

function closeDetail() {
  els.detailPanel.classList.remove("is-open");
  els.detailPanel.setAttribute("aria-hidden", "true");
}

function deletePaper(id) {
  const paper = library.find((item) => item.id === id);
  if (!paper || !confirm(`删除“${paper.title}”？监听目录里的原始文件不会被删除。`)) return;
  library = library.filter((item) => item.id !== id);
  saveLibrary();
  closeDetail();
  render();
  toast("已从本地文献库删除");
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

function updateWatchStatus(status, message = "") {
  els.watchPanel.dataset.status = status;
  if (status === "watching") {
    els.watchTitle.textContent = `正在监听：${watchedDirectoryHandle?.name || "已选择文件夹"}`;
    if (watchedFileCount) {
      els.watchText.textContent = `页面每 5 秒递归扫描子文件夹，已发现 ${watchedFileCount} 个总结文件，并优先按 JSON、Excel、Markdown 导入。`;
    } else {
      els.watchText.textContent = "已递归扫描子文件夹，暂未发现 summary.json、paper_summary.xlsx 或 *_paper_summary.md 这类总结文件。";
    }
  } else if (status === "scanning") {
    els.watchTitle.textContent = "正在扫描输出目录";
    els.watchText.textContent = "递归查找每篇论文文件夹中的 summary / *_paper_summary 输出文件。";
  } else if (status === "needs-permission") {
    els.watchTitle.textContent = `需要授权：${watchedDirectoryHandle?.name || "上次选择的文件夹"}`;
    els.watchText.textContent = "浏览器需要重新授权读取目录；点击“监听文件夹”重新选择即可。";
  } else if (status === "error") {
    els.watchTitle.textContent = "监听出错";
    els.watchText.textContent = message || "请重新选择输出目录。";
  } else {
    els.watchTitle.textContent = "未监听输出目录";
    els.watchText.textContent = "点击“监听文件夹”，可以选择 paper 总目录；页面会递归扫描每篇论文子文件夹里的总结文件。";
  }
  renderWatchStatusMeta();
}

function renderWatchStatusMeta() {
  if (!els.watchMeta) return;
  els.watchMeta.replaceChildren();
  if (watchedDirectoryHandle) els.watchMeta.append(badge(watchedDirectoryHandle.name));
  if (watchedFolderCount) els.watchMeta.append(badge(`${watchedFolderCount} 个子文件夹`));
  if (watchedFileCount) els.watchMeta.append(badge(`${watchedFileCount} 个总结文件`));
  if (watchedImportFileCount) els.watchMeta.append(badge(`${watchedImportFileCount} 个导入源`));
  if (skippedScanIssueCount) els.watchMeta.append(badge(`跳过 ${skippedScanIssueCount} 个失效项`, "type-missing"));
  if (importErrorCount) els.watchMeta.append(badge(`${importErrorCount} 个解析失败`, "type-missing"));
  if (lastScanAt) els.watchMeta.append(badge(`最近扫描 ${lastScanAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`));
}

function compactVenue(paper) {
  if (paper.venue) return shortText(paper.venue, 68);
  return paper.year || "";
}

function inferTopic(rows) {
  const method = rows.find((row) => row.dimension === "使用技术/方法" && row.summary)?.summary;
  const purpose = rows.find((row) => row.dimension === "研究目的" && row.summary)?.summary;
  return shortText(method || purpose || "", 34);
}

function paperDetailBadges(paper) {
  const badges = [];
  if (paper.year && !String(paper.venue || "").includes(paper.year)) badges.push(badge(paper.year));
  if (paper.venue) badges.push(badge(shortText(paper.venue, 80)));
  if (paper.field) badges.push(badge(shortText(paper.field, 64)));
  if (paper.authors) badges.push(badge(shortText(paper.authors, 70)));
  badges.push(badge(`${paper.rows.length} 行总结`), badge(`导入 ${formatDate(paper.importedAt)}`), ...typeBadges(paper.rows));
  return badges;
}

function shortText(value, limit = 80) {
  const text = cleanCell(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
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
  return (hash >>> 0).toString(16);
}
