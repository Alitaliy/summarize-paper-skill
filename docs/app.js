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
const REFERENCE_HEADER_MAP = new Map([
  ["大方向", "direction"],
  ["方向概括", "direction_summary"],
  ["引用编号", "ref_id"],
  ["题名", "title"],
  ["作者", "authors"],
  ["年份", "year"],
  ["来源", "venue"],
  ["DOI", "doi"],
  ["链接", "url"],
  ["与本文关系", "relation"],
  ["分类依据", "classification_basis"],
  ["可追踪性", "traceability"],
  ["完整引文", "citation"],
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
let repository = null;
let localRepository = null;
let unsubscribeRepository = null;
let remoteAnalysis = null;
let revision = 0;
let dataRevision = 0;
let analysisSettings = {};
let mutationQueue = Promise.resolve();
let searchCache = new WeakMap();
let statsRevision = -1;
let citationModel = null;
const scanCache = new Map();

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  hydrateFilters();
  try {
    repository = await LibraryStore.open({ normalizePaper });
    localRepository = repository;
    await loadLibrary();
  } catch (error) {
    repository?.close(); repository = null;
    showStorageError(`本地文献库未能打开：${error.message}。原数据已保留，请关闭其他标签页后刷新重试。`);
  }
  bindEvents();
  window.CitationAnalytics?.init({
    getLibrary: () => library,
    getRevision: () => dataRevision,
    getSettings: () => analysisSettings,
    getModel: () => citationModel,
    getRemoteAnalysis: options => remoteAnalysis?.(options),
    saveSettings: settings => runMutation(async () => {
      const next = { ...settings, identities: combineSettings(analysisSettings, settings).identities };
      const model = CitationIndex.build(library, next);
      next.identities = model.identities;
      await saveLibrary({ settings: next });
      analysisSettings = next; citationModel = model;
      return next;
    }),
    openPaper: (id) => openDetail(id, { ignoreFilters: true }),
    notify: toast,
  });
  subscribeRepository();
  render();
  if (repository) await restoreWatchedDirectory();
  if (repository) window.CloudUI?.init({ normalizePaper,
    localSnapshot: () => localRepository.read(),
    useStore: switchRepository, useLocal: () => switchRepository(localRepository),
    importLocal: snapshot => mergePapers(snapshot.papers.map(normalizePaper), "本地库迁移", { settings: snapshot.analysis_settings, forceToast: true }),
    exportCurrent: exportLibrary,
    exportSnapshot: (snapshot, name) => downloadJson(PaperData.backup(snapshot.papers, snapshot.analysis_settings), `${name}-${Date.now()}.json`),
    setRemoteAnalysis: fn => { remoteAnalysis = fn; },
  }).catch(error => showStorageError(`云端登录暂不可用：${error.message}。本地库仍可使用。`));
});

function subscribeRepository() {
  unsubscribeRepository?.();
  const source = repository;
  unsubscribeRepository = source?.subscribe(() => {
    runMutation(async () => {
      if (repository !== source) return;
      const changed = await loadLibrary();
      if (changed) { window.CitationAnalytics?.replaceSettings(analysisSettings); render(); }
    }).catch(() => {});
  });
}

async function switchRepository(next) {
  if (repository === next) return;
  await runMutation(async () => {
    const previous = repository;
    repository = next;
    try { await loadLibrary(); } catch (error) { repository = previous; await loadLibrary(); throw error; }
    subscribeRepository(); closeDetail();
    // Selecting an account does not silently grant it a folder from another account.
    clearInterval(scanTimer); watchedDirectoryHandle = null; scanCache.clear(); lastScanSignature = "";
    watchedFileCount = watchedFolderCount = watchedImportFileCount = skippedScanIssueCount = importErrorCount = 0; lastScanAt = null;
    updateWatchStatus("idle");
    els.clearLibraryButton.textContent = next.backend === "supabase" ? "清空云端库" : "清空本地库";
    const description = document.getElementById("storageDescription");
    if (description) description.textContent = next.backend === "supabase" ? "支持 Excel、JSON、Markdown；登录账号内同步，本机保留缓存" : "支持 Excel、JSON、Markdown；数据保存在当前浏览器";
    window.CitationAnalytics?.replaceSettings(analysisSettings); render();
  });
  await restoreWatchedDirectory();
}

function bindElements() {
  Object.assign(els, {
    fileInput: document.querySelector("#fileInput"),
    watchButton: document.querySelector("#watchButton"),
    pasteButton: document.querySelector("#pasteButton"),
    exportButton: document.querySelector("#exportButton"),
    migrationButton: document.querySelector("#migrationButton"),
    storageStatus: document.querySelector("#storageStatus"),
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
    referenceCount: document.querySelector("#referenceCount"),
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
    summaryTab: document.querySelector("#summaryTab"),
    referencesTab: document.querySelector("#referencesTab"),
    summaryPane: document.querySelector("#summaryPane"),
    referencesPane: document.querySelector("#referencesPane"),
    detailReferences: document.querySelector("#detailReferences"),
    detailReferenceCount: document.querySelector("#detailReferenceCount"),
    referenceEmpty: document.querySelector("#referenceEmpty"),
    referenceNote: document.querySelector("#referenceNote"),
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
  els.migrationButton.addEventListener("click", exportMigration);

  els.clearLibraryButton.addEventListener("click", async () => {
    if (!library.length || !confirm(repository?.backend === "supabase" ? "清空此账号的云端文献库？此删除会同步至其他设备。监听目录中的原始文件不会被删除。" : "清空当前浏览器中的全部文献总结？监听目录中的原始文件不会被删除。")) return;
    try { await runMutation(async () => {
      await saveLibrary({ deletes: library.map(paper => paper.id) });
      library = []; dataChanged(); citationModel = CitationIndex.build(library, analysisSettings);
      render(); toast(repository.backend === "supabase" ? "文献库已清空，等待同步" : "本地文献库已清空");
    }); } catch { /* Persistent status contains the failure. */ }
  });

  els.pasteButton.addEventListener("click", () => {
    els.pasteText.value = "";
    els.pasteDialog.showModal();
  });

  els.pasteImportButton.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      let payload = JSON.parse(els.pasteText.value);
      if (payload.format === "summarize-paper-migration") { PaperMigration.validate(payload); payload = PaperMigration.restore(payload); }
      const papers = normalizeJsonPayload(payload, "粘贴 JSON");
      await mergePapers(papers, "粘贴 JSON", { forceToast: true, settings: payload.analysis_settings });
      els.pasteDialog.close();
    } catch (error) {
      toast(`JSON 导入失败：${error.message}`);
    }
  });

  els.closeDetailButton.addEventListener("click", closeDetail);
  els.summaryTab.addEventListener("click", () => selectDetailTab("summary"));
  els.referencesTab.addEventListener("click", () => selectDetailTab("references"));
  els.detailPanel.addEventListener("click", (event) => {
    if (event.target === els.detailPanel) closeDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
}

async function loadLibrary() {
  const saved = await repository.read();
  const loaded = saved.papers.map(normalizePaper);
  if (loaded.some(paper => !paper)) throw new Error("存在无法读取的文献记录");
  loaded.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (citationModel && window.CloudData?.equal(loaded, library) && window.CloudData.equal(saved.analysis_settings, analysisSettings)) {
    revision = saved.revision; return false;
  }
  library = loaded;
  library.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  revision = saved.revision;
  analysisSettings = saved.analysis_settings;
  dataChanged();
  citationModel = CitationIndex.build(library, analysisSettings);
  const next = CitationIndex.normalizeSettings({ ...analysisSettings, identities: citationModel.identities });
  if (JSON.stringify(next) !== JSON.stringify(analysisSettings)) await saveLibrary({ settings: next });
  analysisSettings = next;
  return true;
}

function dataChanged() { dataRevision += 1; searchCache = new WeakMap(); }

function showStorageError(message) {
  if (els.storageStatus) { els.storageStatus.hidden = false; els.storageStatus.textContent = message; }
  toast(message);
}

function runMutation(action) {
  const pending = mutationQueue.then(async () => {
    if (!repository) throw new Error("本地数据库尚未就绪，未修改数据");
    return action();
  });
  mutationQueue = pending.catch(async error => {
    if (error.code === "revision_conflict") {
      try { await loadLibrary(); window.CitationAnalytics?.replaceSettings(analysisSettings); render(); } catch { /* Preserve the last readable snapshot. */ }
    }
    showStorageError(`操作未保存：${error.message}。请重试或先导出库备份。`);
  });
  return pending;
}

async function saveLibrary(change) {
  revision = await repository.commit({ ...change, expectedRevision: revision });
  if (els.storageStatus) els.storageStatus.hidden = true;
}

async function chooseWatchDirectory() {
  if (!window.showDirectoryPicker) {
    toast("当前浏览器不支持目录监听，请使用新版 Chrome 或 Edge");
    return;
  }

  try {
    watchedDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
    lastScanSignature = "";
    scanCache.clear();
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
  const source = repository;
  const allowed = await ensureReadPermission(watchedDirectoryHandle, true);
  if (!allowed) {
    updateWatchStatus("needs-permission");
    toast("没有读取权限，无法监听这个文件夹");
    return;
  }

  clearInterval(scanTimer);
  updateWatchStatus("scanning");
  const started = await scanWatchedDirectory({ showToast });
  if (!started || repository !== source) return;
  scanTimer = setInterval(() => scanWatchedDirectory({ showToast: false }), SCAN_INTERVAL_MS);
  updateWatchStatus("watching");
}

async function scanWatchedDirectory({ showToast }) {
  if (!watchedDirectoryHandle || scanning) return false;
  const source = repository;
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
      const pendingCache = [];
      let settings;
      const activePaths = new Set(importFiles.map(item => item.path));
      for (const path of scanCache.keys()) if (!activePaths.has(path)) scanCache.delete(path);
      for (const item of importFiles) {
        try {
          const companions = files.filter(other => isMarkdownPath(other.path) && summaryGroupKey(other.path) === summaryGroupKey(item.path));
          const itemSignature = [item, ...companions].map(other => `${other.path}:${other.file.size}:${other.file.lastModified}`).join("|");
          if (scanCache.get(item.path) === itemSignature && !showToast) continue;
          const parsed = await parseFile(item.file, item.path);
          const companionMetadata = await readCompanionMarkdownMetadata(companions);
          const metadata = companionMetadata.get(summaryGroupKey(item.path));
          const changed = parsed.map((paper) => mergePaperMetadata(paper, metadata));
          papers.push(...changed);
          if (parsed.analysis_settings) settings = combineSettings(settings || {}, parsed.analysis_settings);
          pendingCache.push([item.path, itemSignature]);
        } catch (error) {
          errors.push(`${item.path}: ${error.message}`);
        }
      }
      importErrorCount = errors.length;
      if (repository !== source) return false;
      if (papers.length || settings) await mergePapers(papers, "自动扫描", { quietWhenNoChange: true, settings, repository: source });
      if (repository !== source) return false;
      pendingCache.forEach(([path, value]) => scanCache.set(path, value));
      if (showToast && !errors.length) toast(`扫描完成：已读取 ${papers.length} 篇论文`);
      if (errors.length && showToast) toast(`部分文件未导入：${errors.slice(0, 3).join("；")}`);
      if (!errors.length) lastScanSignature = signature;
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
  const key = repository?.namespace ? `${HANDLE_KEY}:${repository.namespace}` : HANDLE_KEY;
  return withHandleStore("readwrite", (store) => store.put(handle, key));
}

function readDirectoryHandle() {
  if (!window.indexedDB) return Promise.resolve(null);
  const key = repository?.namespace ? `${HANDLE_KEY}:${repository.namespace}` : HANDLE_KEY;
  return withHandleStore("readonly", (store) => store.get(key));
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
  const source = repository;
  const imported = [];
  const errors = [];
  let settings;

  for (const file of files) {
    try {
      const papers = await parseFile(file, file.name);
      imported.push(...papers);
      if (papers.analysis_settings) settings = combineSettings(settings || {}, papers.analysis_settings);
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  if (imported.length) {
    try { await mergePapers(imported, sourceLabel, { forceToast: true, settings, repository: source }); }
    catch (error) { errors.push(error.message); }
  }
  if (errors.length) toast(`部分文件导入失败：${errors.join("；")}`);
}

async function parseFile(file, sourcePath = file.name) {
  const name = sourcePath.toLowerCase();
  if (name.endsWith(".json")) {
    let payload = JSON.parse(await file.text());
    if (payload.format === "summarize-paper-migration") { PaperMigration.validate(payload); payload = PaperMigration.restore(payload); }
    const papers = normalizeJsonPayload(payload, sourcePath);
    if (payload.analysis_settings) Object.defineProperty(papers, "analysis_settings", { value: payload.analysis_settings });
    return papers;
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) return [parseMarkdown(await file.text(), sourcePath)];
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return [await parseWorkbook(file, sourcePath)];
  throw new Error("仅支持 .xlsx、.xls、.json、.md");
}

function normalizeJsonPayload(payload, sourceFile = "summary.json") {
  if (payload?.format === "summarize-paper-library" || payload?.papers) PaperData.validateBackup(payload);
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
  const referenceGroups = parseWorkbookReferenceGroups(workbook);
  return normalizePaper({ title, rows, reference_groups: referenceGroups, ...parseWorkbookReferenceMetadata(workbook), sourceFile: sourcePath });
}

function parseWorkbookReferenceMetadata(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name.includes("引用文献脉络"));
  if (!sheetName) return {};
  const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const row = matrix.find((line) => cleanCell(line[0]) === "整理状态");
  if (!row) return {};
  return { reference_status: cleanCell(row[1]), reference_count_expected: row[3], reference_note: cleanCell(row[5]) };
}

function rowFromHeaders(headers, values) {
  const row = {};
  headers.forEach((header, index) => {
    const key = HEADER_MAP.get(header);
    if (key) row[key] = cleanCell(values[index]);
  });
  return normalizeRow(row);
}

function parseWorkbookReferenceGroups(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name.includes("引用文献脉络"));
  if (!sheetName) return [];
  const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell).trim() === "大方向"));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((cell) => String(cell).trim());
  const rows = matrix.slice(headerIndex + 1).map((values) => {
    const row = {};
    headers.forEach((header, index) => {
      const key = REFERENCE_HEADER_MAP.get(header);
      if (key) row[key] = cleanCell(values[index]);
    });
    return row;
  }).filter((row) => row.direction || row.title || row.ref_id);
  return referenceGroupsFromFlatRows(rows);
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
  const metadataEnd = [text.indexOf("## 逐项总结"), text.indexOf("## 引用文献脉络")].filter((index) => index >= 0);
  const metadataText = text.slice(0, metadataEnd.length ? Math.min(...metadataEnd) : Math.min(text.length, 3000));
  const doi = extractDoi([basicInfo["DOI"], basicInfo["doi"], venue, metadataText].join(" "));
  const referenceGroups = parseReferenceGroupsFromMarkdown(text);
  return {
    title,
    authors: basicInfo["作者"],
    venue,
    doi,
    year: extractYear(venue || basicInfo["年份"]),
    field: basicInfo["研究领域"],
    integrity: basicInfo["资料完整性说明"],
    overview,
    reference_groups: referenceGroups,
    ...parseReferenceMetadataFromMarkdown(text),
  };
}

function parseReferenceMetadataFromMarkdown(text) {
  const block = extractSection(text, "引用文献脉络");
  const read = (label) => block.match(new RegExp(`^[-*][\\t ]*${label}[：:][\\t ]*(.*)$`, "m"))?.[1]?.trim() || "";
  return { reference_status: read("整理状态"), reference_note: read("整理说明"), reference_count_expected: read("原文引用总数") };
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

function extractDoi(value) {
  const match = String(value || "").match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if (!match) return "";
  let doi = match[0].replace(/[.,;:，。；：、]+$/g, "");
  while ((doi.match(/\(/g) || []).length < (doi.match(/\)/g) || []).length) {
    doi = doi.slice(0, -1);
  }
  return doi;
}

function parseGroupedMarkdown(text) {
  const start = text.indexOf("## 逐项总结");
  if (start < 0) return [];
  const endCandidates = ["## 引用文献脉络", "## 推测内容清单", "## 需注意的原文限制"].map((heading) => text.indexOf(heading, start + 1)).filter((index) => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  const block = text.slice(start, end);
  const rows = [];
  let dimension = "";
  for (const line of block.split(/\r?\n/)) {
    const review = line.match(/^\s+[-*]\s+核查建议[：:]\s*(.+)$/);
    if (review && rows.length) {
      rows[rows.length - 1].review_suggestion = review[1].trim();
      continue;
    }
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
  const endCandidates = ["## 引用文献脉络", "## 推测内容清单", "## 需注意的原文限制"]
    .map((heading) => text.indexOf(heading, start + 1))
    .filter((index) => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : -1;
  const block = text.slice(start >= 0 ? start : 0, end >= 0 ? end : text.length);
  return block.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-+/.test(line) && !/^\|\s*维度\s*\|/.test(line))
    .map(splitMarkdownRow)
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({ dimension: cells[0], basis_type: cells[1], summary: cells[2], evidence: cells[3], confidence: cells[4] || "", review_suggestion: cells[5] || "" }));
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

function parseReferenceGroupsFromMarkdown(text) {
  const block = extractSection(text, "引用文献脉络");
  if (!block) return [];

  const groups = [];
  let current = null;
  let tableHeaders = [];
  for (const line of block.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(?:大方向[：:]\s*)?(.+)$/);
    if (heading) {
      current = { direction: cleanMarkdownText(heading[1]), summary: "", references: [] };
      groups.push(current);
      tableHeaders = [];
      continue;
    }
    if (!current) continue;

    const summary = line.match(/^[-*]\s*方向(?:概括|说明)[：:]\s*(.+)$/);
    if (summary) {
      current.summary = cleanMarkdownText(summary[1]);
      continue;
    }
    if (!line.trim().startsWith("|")) continue;

    const cells = splitMarkdownRow(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (!tableHeaders.length && cells.some((cell) => REFERENCE_HEADER_MAP.has(cleanMarkdownText(cell)))) {
      tableHeaders = cells.map((cell) => cleanMarkdownText(cell));
      continue;
    }
    if (!tableHeaders.length) continue;

    const reference = {};
    tableHeaders.forEach((header, index) => {
      const key = REFERENCE_HEADER_MAP.get(header);
      if (!key || key === "direction" || key === "direction_summary") return;
      const raw = cells[index] || "";
      reference[key] = key === "url" ? extractMarkdownUrl(raw) || cleanMarkdownText(raw) : cleanMarkdownText(raw);
    });
    if (reference.title || reference.ref_id || reference.citation) current.references.push(reference);
  }
  return normalizeReferenceGroups(groups);
}

function extractMarkdownUrl(value) {
  return String(value || "").match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() || "";
}

function referenceGroupsFromFlatRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const direction = cleanCell(row.direction || "待核查/方向不明");
    if (!grouped.has(direction)) grouped.set(direction, { direction, summary: cleanCell(row.direction_summary), references: [] });
    const group = grouped.get(direction);
    if (!group.summary && row.direction_summary) group.summary = cleanCell(row.direction_summary);
    if (row.title || row.ref_id || row.citation) group.references.push(row);
  }
  return normalizeReferenceGroups([...grouped.values()]);
}

function normalizePaper(input) {
  const rows = (input.rows || []).map(normalizeRow).filter((row) => row.dimension || row.summary);
  if (!rows.length) return null;
  const referenceGroups = normalizeReferenceGroups(
    input.reference_groups || input.referenceGroups || input.citation_groups || input.references_by_direction || input["引用文献脉络"] || [],
  );
  const title = cleanCell(input.paper_title || input.title || input.name || `未命名论文 ${input.fallbackIndex || ""}`) || "未命名论文";
  const sourceFile = cleanCell(input.sourceFile || input.source_file || "手动导入");
  const fingerprint = hashString(`${title}\n${JSON.stringify(rows)}`);
  const venue = cleanCell(input.venue || input.journal || input.publication || input["年份/会议或期刊"]);
  const year = cleanCell(input.year || extractYear(venue));
  const overview = cleanCell(input.overview || input.abstract || input.brief || buildPaperBrief(rows));
  const doi = extractDoi([input.doi, input.DOI, input["DOI"], venue, overview, sourceFile].join(" "));
  return {
    id: input.id || `paper-${crypto.randomUUID()}`,
    record_version: input.record_version || 1,
    fingerprint,
    title,
    starred: input.starred === true,
    authors: cleanCell(input.authors || input.author || input["作者"]),
    venue,
    doi,
    year,
    field: cleanCell(input.field || input.research_field || input.topic || input["研究领域"]),
    integrity: cleanCell(input.integrity || input.source_quality || input["资料完整性说明"]),
    overview,
    sourceFile,
    importedAt: input.importedAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
    rows,
    reference_groups: referenceGroups,
    ...normalizeReferenceMetadata(input),
  };
}

function normalizeReferenceMetadata(input) {
  const status = ["complete", "partial", "unavailable"].includes(input.reference_status) ? input.reference_status : "";
  const value = input.reference_count_expected;
  const count = value !== null && value !== undefined && String(value).trim() !== "" ? Number(value) : NaN;
  return {
    reference_status: status,
    reference_note: cleanCell(input.reference_note),
    reference_count_expected: Number.isInteger(count) && count >= 0 ? count : null,
  };
}

function buildPaperBrief(rows) {
  const preferred = rows.find((row) => row.dimension === "主要贡献" && row.summary)
    || rows.find((row) => row.dimension === "研究目的" && row.summary)
    || rows.find((row) => row.summary);
  return preferred?.summary || "";
}

function hasPaperMetadata(metadata) {
  return Boolean(metadata && (
    metadata.authors || metadata.venue || metadata.doi || metadata.year || metadata.field || metadata.overview || metadata.integrity
    || normalizeReferenceGroups(metadata.reference_groups || []).length
    || metadata.reference_status || metadata.reference_note
  ));
}

function mergePaperMetadata(paper, metadata) {
  if (!paper || !hasPaperMetadata(metadata)) return paper;
  return {
    ...paper,
    authors: paper.authors || metadata.authors || "",
    venue: paper.venue || metadata.venue || "",
    doi: paper.doi || metadata.doi || "",
    year: paper.year || metadata.year || "",
    field: paper.field || metadata.field || "",
    integrity: paper.integrity || metadata.integrity || "",
    overview: paper.overview || metadata.overview || "",
    reference_groups: paper.reference_status || paper.reference_groups?.length ? (paper.reference_groups || []) : normalizeReferenceGroups(metadata.reference_groups || []),
    ...normalizeReferenceMetadata(paper.reference_status ? paper : metadata),
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

function normalizeReferenceGroups(input) {
  if (!Array.isArray(input)) return [];
  return input.map((group) => {
    if (!group || typeof group !== "object") return null;
    const references = group.references || group.citations || group.items || group["文献"] || [];
    const normalizedReferences = (Array.isArray(references) ? references : [])
      .map(normalizeReference)
      .filter((reference) => reference.title || reference.citation || reference.ref_id || reference.doi);
    const direction = cleanCell(group.direction || group.name || group.topic || group["大方向"] || "待核查/方向不明");
    const summary = cleanCell(group.summary || group.description || group.direction_summary || group["方向概括"]);
    if (!normalizedReferences.length && !summary) return null;
    return { direction, summary, references: normalizedReferences };
  }).filter(Boolean);
}

function normalizeReference(input) {
  const item = typeof input === "string" ? { citation: input } : (input || {});
  const citation = cleanCell(item.citation || item.full_citation || item["完整引文"]);
  const doi = extractDoi([item.doi, item.DOI, item["DOI"], item.url, item.link, citation].join(" "));
  let url = cleanCell(item.url || item.link || item["链接"]);
  if (!/^https?:\/\//i.test(url)) url = "";
  if (!url && doi) url = `https://doi.org/${doi}`;
  const title = cleanCell(item.title || item.paper_title || item["题名"]);
  const authors = cleanCell(item.authors || item.author || item["作者"]);
  const year = cleanCell(item.year || item["年份"] || extractYear(citation));
  let traceability = cleanCell(item.traceability || item["可追踪性"]);
  if (!traceability) traceability = doi || url ? "完整" : (title && (authors || year) ? "部分" : "待核查");
  return {
    ...(item.record_id ? { record_id: String(item.record_id) } : {}),
    ref_id: cleanCell(item.ref_id || item.label || item.number || item["引用编号"]),
    title,
    authors,
    year,
    venue: cleanCell(item.venue || item.source || item.publication || item["来源"]),
    doi,
    url,
    citation,
    relation: cleanCell(item.relation || item.role || item["与本文关系"]),
    classification_basis: cleanCell(item.classification_basis || item.basis || item.evidence || item["分类依据"]),
    traceability,
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function combineSettings(current, incoming = {}) {
  const a = CitationIndex.normalizeSettings(current), b = CitationIndex.normalizeSettings(incoming);
  const identities = { ...a.identities };
  for (const [id, entry] of Object.entries(b.identities)) identities[id] = {
    aliases: [...new Set([...(identities[id]?.aliases || []), ...entry.aliases])],
    records: [...new Set([...(identities[id]?.records || []), ...entry.records])],
  };
  return CitationIndex.normalizeSettings({ directions: { ...a.directions, ...b.directions }, identities,
    merges: [...new Map([...a.merges, ...b.merges].map(pair => [JSON.stringify(pair), pair])).values()] });
}

async function mergePapers(papers, sourceLabel, options = {}) {
  return runMutation(async () => {
    if (options.repository && repository !== options.repository) throw new Error("导入期间文献库已切换，请在目标文献库中重新导入");
    let added = 0, updated = 0, skipped = 0;
    const next = new Map(library.map(paper => [paper.id, paper]));
    const byTitle = new Map(library.map(paper => [normalizeKey(paper.title), paper]));
    const byDoi = new Map(library.filter(paper => paper.doi).map(paper => [CitationIndex.doiKey(paper.doi), paper]));
    const changed = new Map();
    for (const incoming of papers.filter(Boolean)) {
      const doi = CitationIndex.doiKey(incoming.doi);
      let existing = next.get(incoming.id) || (doi && byDoi.get(doi)) || byTitle.get(normalizeKey(incoming.title));
      if (existing?.doi && doi && CitationIndex.doiKey(existing.doi) !== doi) existing = null;
      let paper;
      if (existing) {
        // Reconcile occurrence IDs before comparing content, including DOI-only updates.
        const prepared = PaperData.preparePaper(incoming, existing);
        if (existing.fingerprint === incoming.fingerprint) {
          paper = PaperData.clone(existing);
          if (!applyPaperMetadataUpdate(paper, prepared)) { skipped += 1; continue; }
        } else {
          paper = { ...prepared, id: existing.id, importedAt: existing.importedAt,
            updatedAt: new Date().toISOString(), starred: Boolean(existing.starred || incoming.starred),
            reference_groups: incoming.reference_status || incoming.reference_groups?.length ? prepared.reference_groups : existing.reference_groups,
            ...normalizeReferenceMetadata(incoming.reference_status ? incoming : existing),
            sourceFile: mergeSourceNames(existing.sourceFile, incoming.sourceFile) };
          for (const field of ["authors", "venue", "doi", "year", "field", "integrity", "overview"]) paper[field] ||= existing[field] || "";
        }
        updated += 1;
      } else {
        const id = next.has(incoming.id) ? `paper-${crypto.randomUUID()}` : incoming.id;
        paper = PaperData.preparePaper({ ...incoming, id }); added += 1;
      }
      next.set(paper.id, paper); changed.set(paper.id, paper);
      byTitle.set(normalizeKey(paper.title), paper);
      if (paper.doi) byDoi.set(CitationIndex.doiKey(paper.doi), paper);
    }
    let settings = combineSettings(analysisSettings, options.settings || papers.analysis_settings);
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(analysisSettings);
    if (changed.size || settingsChanged) {
      const values = [...next.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      PaperData.validateBackup({ papers: values, analysis_settings: settings });
      const model = CitationIndex.build(values, settings);
      settings = { ...settings, identities: model.identities };
      await saveLibrary({ puts: [...changed.values()], settings });
      library = values; analysisSettings = settings; citationModel = model; dataChanged();
      window.CitationAnalytics?.replaceSettings(settings); render();
    }
    if (options.forceToast || (!options.quietWhenNoChange && (added || updated))) toast(`${sourceLabel}完成：新增 ${added} 篇，更新 ${updated} 篇，跳过重复 ${skipped} 篇`);
    return { added, updated, skipped };
  });
}

function applyPaperMetadataUpdate(existing, incoming) {
  let changed = false;
  if (incoming.starred && !existing.starred) {
    existing.starred = true;
    changed = true;
  }
  for (const key of ["authors", "venue", "doi", "year", "field", "integrity", "overview"]) {
    if (!existing[key] && incoming[key]) {
      existing[key] = incoming[key];
      changed = true;
    }
  }
  if (incoming.reference_status || incoming.reference_groups?.length) {
    const current = JSON.stringify(existing.reference_groups || []);
    const next = JSON.stringify(incoming.reference_groups || []);
    if (current !== next) {
      existing.reference_groups = incoming.reference_groups || [];
      changed = true;
    }
  }
  if (incoming.reference_status) {
    for (const [key, value] of Object.entries(normalizeReferenceMetadata(incoming))) {
      if (existing[key] !== value) {
        existing[key] = value;
        changed = true;
      }
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
  window.CitationAnalytics?.refresh();
}

function renderStats() {
  if (statsRevision === dataRevision) return;
  statsRevision = dataRevision;
  const rows = library.flatMap((paper) => paper.rows);
  const references = library.flatMap(paperReferences);
  els.paperCount.textContent = library.length;
  els.rowCount.textContent = rows.length;
  els.sourceBackedCount.textContent = rows.filter((row) => row.basis_type === "原文明确" || row.basis_type === "原文概括").length;
  els.inferredCount.textContent = rows.filter((row) => row.basis_type === "合理推测").length;
  els.referenceCount.textContent = references.length;
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
  let cached = searchCache.get(paper);
  if (query && !cached) {
    cached = { text: [paper.title, paper.sourceFile, paper.authors, paper.venue, paper.doi, paper.year,
      paper.field, paper.overview, referenceSearchText(paper)].join(" ").toLowerCase(), rows: new WeakMap() };
    searchCache.set(paper, cached);
  }
  const paperMatches = query && cached.text.includes(query);
  return rows.filter((row) => {
    if (filters.dimension !== "all" && row.dimension !== filters.dimension) return false;
    if (filters.type !== "all" && row.basis_type !== filters.type) return false;
    if (filters.confidence !== "all" && row.confidence !== filters.confidence) return false;
    if (!query) return true;
    if (paperMatches) return true;
    if (!cached.rows.has(row)) cached.rows.set(row, [row.dimension, row.basis_type, row.summary, row.evidence,
      row.confidence, row.review_suggestion].join(" ").toLowerCase());
    return cached.rows.get(row).includes(query);
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
      if (event.target !== card) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDetail(paper.id);
    });

    const cardHead = document.createElement("div");
    cardHead.className = "paper-card-head";
    const accent = document.createElement("span");
    accent.className = "paper-card-accent";
    accent.setAttribute("aria-hidden", "true");
    const year = document.createElement("span");
    year.className = "paper-card-year";
    year.textContent = paper.year || "年份未标注";
    const starButton = createStarButton(paper);
    cardHead.append(accent, year, starButton);

    const title = document.createElement("h3");
    title.className = "paper-card-title";
    title.textContent = paper.title;
    title.title = paper.title;

    const doi = cardDoiText(paper);
    const venue = document.createElement("p");
    venue.className = "paper-card-venue";
    venue.textContent = doi;
    venue.title = doi;

    const topic = document.createElement("p");
    topic.className = "paper-card-topic";
    topic.textContent = paper.field || inferTopic(paper.rows) || "主题未标注";
    topic.title = topic.textContent;

    const brief = document.createElement("p");
    brief.className = "paper-card-brief";
    brief.textContent = cardBriefText(paper);
    brief.title = brief.textContent;

    const body = document.createElement("div");
    body.className = "paper-card-body";
    body.append(title);
    if (doi) body.append(venue);
    body.append(topic, brief);

    const footer = document.createElement("div");
    footer.className = "paper-card-foot";
    const count = document.createElement("span");
    const referenceCount = paperReferences(paper).length;
    count.textContent = referenceCount ? `${paper.rows.length} 点 · ${referenceCount} 篇引用` : `${paper.rows.length} 点 · 滚动/点击`;
    const deleteButton = button("删", "tiny-button");
    deleteButton.title = repository?.backend === "supabase" ? "删除这篇文献并同步至其他设备" : "从浏览器本地库删除这篇文献";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePaper(paper.id);
    });
    footer.append(count, deleteButton);

    card.append(cardHead, body, footer);
    els.paperGrid.append(card);
  }
}

function createStarButton(paper) {
  const starButton = document.createElement("button");
  starButton.type = "button";
  starButton.className = "star-button";
  syncStarButton(starButton, paper);
  starButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    starButton.disabled = true;
    try { await runMutation(async () => {
      const existing = library.find(item => item.id === paper.id);
      if (!existing) return;
      const next = { ...existing, starred: !existing.starred };
      await saveLibrary({ puts: [next] });
      existing.starred = next.starred; paper.starred = next.starred;
      syncStarButton(starButton, paper);
      toast(paper.starred ? "已标记为重点" : "已取消重点标记");
    }); } catch { /* Keep the previous star on write failure. */ }
    finally { starButton.disabled = false; }
  });
  return starButton;
}

function syncStarButton(starButton, paper) {
  const starred = Boolean(paper.starred);
  starButton.textContent = starred ? "★" : "☆";
  starButton.classList.toggle("is-starred", starred);
  starButton.setAttribute("aria-pressed", String(starred));
  starButton.setAttribute("aria-label", `${starred ? "取消重点标记" : "标记为重点"}：${paper.title}`);
  starButton.title = starred ? "取消重点标记" : "标记为重点";
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

function openDetail(id, { ignoreFilters = false } = {}) {
  const paper = library.find((item) => item.id === id);
  if (!paper) return;
  const rows = ignoreFilters ? paper.rows : filterRows(paper.rows, paper);
  const references = paperReferences(paper);

  els.detailSource.textContent = paper.sourceFile;
  els.detailTitle.textContent = paper.title;
  els.detailMeta.replaceChildren(...paperDetailBadges(paper));
  els.detailOverview.textContent = paper.overview || buildPaperBrief(paper.rows);
  els.detailOverview.style.display = els.detailOverview.textContent ? "block" : "none";
  els.detailRows.replaceChildren();
  els.detailReferences.replaceChildren();
  els.detailReferenceCount.textContent = references.length;
  els.referenceNote.textContent = referenceStatusText(paper);
  els.referenceNote.hidden = !els.referenceNote.textContent;

  for (const [dimension, groupRows] of groupRowsByDimension(rows)) {
    els.detailRows.append(renderDetailSection(dimension, groupRows));
  }
  for (const group of paper.reference_groups || []) {
    els.detailReferences.append(renderReferenceGroup(group));
  }
  els.referenceEmpty.style.display = paper.reference_groups?.length ? "none" : "block";
  selectDetailTab("summary");

  els.detailPanel.classList.add("is-open");
  els.detailPanel.setAttribute("aria-hidden", "false");
}

function referenceStatusText(paper) {
  const labels = { complete: "引用已完整整理", partial: "参考文献仅部分可读", unavailable: "未提供可读参考文献" };
  const label = labels[paper.reference_status];
  if (!label) return paper.reference_note || "";
  const count = paperReferences(paper).length;
  const expected = paper.reference_count_expected;
  const coverage = expected !== null && expected !== undefined ? `已整理 ${count} / ${expected} 条` : `已整理 ${count} 条`;
  return [label, coverage, paper.reference_note].filter(Boolean).join("；");
}

function selectDetailTab(tab) {
  const showReferences = tab === "references";
  els.summaryTab.classList.toggle("is-active", !showReferences);
  els.referencesTab.classList.toggle("is-active", showReferences);
  els.summaryTab.setAttribute("aria-selected", String(!showReferences));
  els.referencesTab.setAttribute("aria-selected", String(showReferences));
  els.summaryPane.hidden = showReferences;
  els.referencesPane.hidden = !showReferences;
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

function renderReferenceGroup(group) {
  const section = document.createElement("section");
  section.className = "reference-group";

  const heading = document.createElement("div");
  heading.className = "reference-group-head";
  const title = document.createElement("h3");
  title.textContent = group.direction || "待核查/方向不明";
  heading.append(title, badge(`${group.references.length} 篇`));
  section.append(heading);

  if (group.summary) {
    const summary = document.createElement("p");
    summary.className = "reference-group-summary";
    summary.textContent = group.summary;
    section.append(summary);
  }

  if (group.references.length) {
    const list = document.createElement("div");
    list.className = "reference-list";
    for (const reference of group.references) list.append(renderReferenceItem(reference));
    section.append(list);
  }
  return section;
}

function renderReferenceItem(reference) {
  const item = document.createElement("article");
  item.className = "reference-item";
  const title = document.createElement("p");
  title.className = "reference-title";
  const label = [reference.ref_id, reference.title || reference.citation || "题名待核查"].filter(Boolean).join(" ");
  const targetUrl = referenceTargetUrl(reference);
  if (targetUrl) {
    const link = document.createElement("a");
    link.href = targetUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    title.append(link);
  } else {
    title.textContent = label;
  }
  item.append(title);

  const metaValues = [reference.authors, reference.year, reference.venue, reference.traceability].filter(Boolean);
  if (metaValues.length) {
    const meta = document.createElement("div");
    meta.className = "reference-meta";
    for (const value of metaValues) {
      const span = document.createElement("span");
      span.textContent = value;
      meta.append(span);
    }
    item.append(meta);
  }

  if (reference.relation) {
    const relation = document.createElement("p");
    relation.className = "reference-relation";
    relation.textContent = `与本文关系：${reference.relation}`;
    item.append(relation);
  }
  if (reference.classification_basis) {
    const basis = document.createElement("p");
    basis.className = "reference-basis";
    basis.textContent = `分类依据：${reference.classification_basis}`;
    item.append(basis);
  }
  if (targetUrl) {
    const link = document.createElement("a");
    link.className = "reference-link";
    link.href = targetUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = reference.doi ? `DOI：${reference.doi}` : "打开文献链接";
    item.append(link);
  }
  return item;
}

function referenceTargetUrl(reference) {
  const value = cleanCell(reference.url || (reference.doi ? `https://doi.org/${reference.doi}` : ""));
  return /^https?:\/\//i.test(value) ? value : "";
}

function paperReferences(paper) {
  return (paper.reference_groups || []).flatMap((group) => group.references || []);
}

function referenceSearchText(paper) {
  return (paper.reference_groups || []).flatMap((group) => [
    group.direction,
    group.summary,
    ...(group.references || []).flatMap((reference) => Object.values(reference)),
  ]).join(" ");
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

async function deletePaper(id) {
  const paper = library.find((item) => item.id === id);
  if (!paper || !confirm(`删除“${paper.title}”？监听目录里的原始文件不会被删除。`)) return;
  try { await runMutation(async () => {
    await saveLibrary({ deletes: [id] });
    library = library.filter((item) => item.id !== id); dataChanged();
    citationModel = CitationIndex.build(library, analysisSettings);
    closeDetail(); render(); toast(repository.backend === "supabase" ? "已删除，等待同步" : "已从本地文献库删除");
  }); } catch { /* Keep the original record if the transaction fails. */ }
}

async function exportLibrary() {
  await mutationQueue;
  if (!repository) { toast("数据库未能打开，无法导出完整文献库，请先恢复读取"); return; }
  downloadJson(PaperData.backup(library, analysisSettings, revision), "summarize-paper-library");
}

async function exportMigration() {
  await mutationQueue;
  if (!repository) { toast("请先恢复文献库读取，再生成迁移包"); return; }
  try {
    const bundle = PaperMigration.build(PaperData.backup(library, analysisSettings, revision));
    downloadJson(bundle, "summarize-paper-migration");
    toast(`迁移包已导出：${bundle.counts.papers} 篇论文、${bundle.counts.works} 篇被引文献`);
  } catch (error) { toast(`迁移包校验失败：${error.message}`); }
}

function downloadJson(payload, name) {
  const data = JSON.stringify(payload);
  const blob = new Blob([data], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
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

function cardDoiText(paper) {
  return paper.doi || extractDoi([paper.venue, paper.overview, paper.sourceFile].join(" "));
}

function inferTopic(rows) {
  const method = rows.find((row) => row.dimension === "使用技术/方法" && row.summary)?.summary;
  const purpose = rows.find((row) => row.dimension === "研究目的" && row.summary)?.summary;
  return cleanCell(method || purpose || "");
}

function cardBriefText(paper) {
  const text = paper.overview || buildPaperBrief(paper.visibleRows || paper.rows);
  return cleanCell(text || "点击查看完整论文总结");
}

function paperDetailBadges(paper) {
  const badges = [];
  const references = paperReferences(paper);
  if (paper.doi) badges.push(badge(`DOI ${shortText(paper.doi, 80)}`));
  if (paper.year && !String(paper.venue || "").includes(paper.year)) badges.push(badge(paper.year));
  if (paper.venue) badges.push(badge(shortText(paper.venue, 80)));
  if (paper.field) badges.push(badge(shortText(paper.field, 64)));
  if (paper.authors) badges.push(badge(shortText(paper.authors, 70)));
  badges.push(badge(`${paper.rows.length} 行总结`));
  if (references.length) badges.push(badge(`${paper.reference_groups.length} 个引用方向`), badge(`${references.length} 篇引用`));
  badges.push(badge(`导入 ${formatDate(paper.importedAt)}`), ...typeBadges(paper.rows));
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
