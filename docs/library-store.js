/* Async repository boundary. Each IndexedDB commit is atomic and revision-checked. */
(function (root) {
  "use strict";
  const DB = "summarize-paper-library", FALLBACK = "summarize-paper-library-v3";
  const LEGACY = ["summarize-paper-library-v2", "summarize-paper-library-v1"];
  const SETTINGS = "summarize-paper-citation-settings-v1";
  const conflict = () => Object.assign(new Error("文献库已在其他标签页更新，请重试本次操作"), { code: "revision_conflict" });
  const empty = () => ({ schema_version: 3, revision: 0, papers: [], analysis_settings: {} });
  const copy = value => JSON.parse(JSON.stringify(value));
  // An older open tab may write a new revision without updating our content marker.
  const contentVersion = state => state.contentRevisionAt === state.revision ? state.contentRevision : state.revision;

  function validate(snapshot) {
    if (snapshot.schema_version !== 3) throw new Error("本地数据库版本不兼容，已保留原数据");
    root.PaperData.validateBackup(snapshot);
    return { ...snapshot, contentRevision: contentVersion(snapshot) };
  }

  function legacy(normalize) {
    const raw = root.localStorage.getItem(FALLBACK);
    if (raw !== null) return validate(JSON.parse(raw));
    const saved = LEGACY.map(key => root.localStorage.getItem(key)).find(value => value !== null);
    const papers = saved === undefined ? [] : JSON.parse(saved);
    if (!Array.isArray(papers)) throw new Error("旧文献库格式损坏，已保留原数据");
    const snapshot = { ...empty(), papers: papers.map(item => {
      const paper = normalize ? normalize(item) : item;
      if (!paper) throw new Error("旧文献库存在无法读取的记录，已停止自动升级");
      return root.PaperData.preparePaper(paper);
    }), analysis_settings: JSON.parse(root.localStorage.getItem(SETTINGS) || "{}") };
    return validate(snapshot);
  }

  async function open({ normalizePaper, namespace = "" } = {}) {
    const databaseName = namespace ? `${DB}:${namespace}` : DB;
    const fallbackKey = namespace ? `${FALLBACK}:${namespace}` : FALLBACK;
    const initialData = () => namespace ? empty() : legacy(normalizePaper);
    let db = null;
    const subscribers = new Set();
    const channel = root.BroadcastChannel ? new root.BroadcastChannel(databaseName) : null;
    if (channel) channel.onmessage = () => subscribers.forEach(fn => fn());
    const storageListener = event => { if (event.key === fallbackKey || event.key === null) subscribers.forEach(fn => fn()); };
    root.addEventListener?.("storage", storageListener);
    try {
    if (root.indexedDB) {
      db = await new Promise((resolve, reject) => {
        let blocked = false;
        const request = root.indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("papers", { keyPath: "id" });
          request.result.createObjectStore("meta");
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error("数据库升级被旧标签页阻塞，请关闭其他文献库页面后刷新")); };
        request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
      });
      db.onversionchange = () => db.close();
      // Read legacy data before the transaction, but decide initialization inside it.
      const initialized = await readMeta();
      if (!initialized) {
        const initial = initialData();
        await transaction("readwrite", (tx, done, fail) => {
          const meta = tx.objectStore("meta"), request = meta.get("state");
          request.onsuccess = () => {
            try {
            if (!request.result) {
              initial.papers.forEach(paper => tx.objectStore("papers").put(paper));
              const { papers, analysis_settings, ...state } = initial;
              meta.put(state, "state");
              meta.put(analysis_settings, "analysis_settings");
            }
            done();
            } catch (error) { fail(error); }
          };
        });
      }
    } else {
      const initial = root.localStorage.getItem(fallbackKey) === null ? initialData() : validate(JSON.parse(root.localStorage.getItem(fallbackKey)));
      // Do not erase the v1/v2 keys: they are the pre-upgrade recovery copy.
      if (root.localStorage.getItem(fallbackKey) === null) root.localStorage.setItem(fallbackKey, JSON.stringify(initial));
    }
    } catch (error) {
      db?.close(); channel?.close(); root.removeEventListener?.("storage", storageListener); throw error;
    }

    function transaction(mode, run, stores = ["papers", "meta"]) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("本地保存失败"));
        try { run(tx, value => { result = value; }, error => { failure = error; tx.abort(); }); }
        catch (error) { failure = error; tx.abort(); }
      });
    }

    async function read() {
      if (!db) return validate(JSON.parse(root.localStorage.getItem(fallbackKey)));
      return transaction("readonly", (tx, done) => {
        const state = tx.objectStore("meta").get("state"), papers = tx.objectStore("papers").getAll();
        const settings = tx.objectStore("meta").get("analysis_settings");
        const sync = tx.objectStore("meta").get("sync");
        let completed = 0;
        const finish = () => {
          if (++completed === 4) done(state.result ? { ...state.result, papers: papers.result, analysis_settings: settings.result ?? state.result.analysis_settings ?? {}, ...(sync.result === undefined ? {} : { sync: sync.result }) } : null);
        };
        state.onsuccess = finish; papers.onsuccess = finish; settings.onsuccess = finish; sync.onsuccess = finish;
      }).then(snapshot => snapshot && validate(snapshot));
    }

    // Sync status/revision checks must not clone and validate every reference.
    // Both metadata records are read in the same transaction for a coherent view.
    async function readMeta() {
      if (!db) {
        const { papers, analysis_settings, ...state } = await read();
        return state;
      }
      return transaction("readonly", (tx, done) => {
        const meta = tx.objectStore("meta"), state = meta.get("state"), sync = meta.get("sync");
        let completed = 0;
        const finish = () => {
          if (++completed === 2) done(state.result ? { ...state.result, contentRevision: contentVersion(state.result),
            ...(sync.result === undefined ? {} : { sync: sync.result }) } : null);
        };
        state.onsuccess = finish; sync.onsuccess = finish;
      }, ["meta"]);
    }

    async function commit({ puts = [], deletes = [], settings, sync, expectedRevision }) {
      let revision;
      const contentChanged = puts.length > 0 || deletes.length > 0 || settings !== undefined;
      if (!db) {
        const write = async () => {
          const snapshot = await read();
          if (snapshot.revision !== expectedRevision) throw conflict();
          const papers = new Map(snapshot.papers.map(paper => [paper.id, paper]));
          deletes.forEach(id => papers.delete(id)); puts.forEach(paper => papers.set(paper.id, copy(paper)));
          revision = snapshot.revision + 1;
          const next = validate({ ...snapshot, revision,
            contentRevision: contentChanged ? revision : snapshot.contentRevision, contentRevisionAt: revision,
            papers: [...papers.values()], analysis_settings: settings ?? snapshot.analysis_settings, ...(sync === undefined ? {} : { sync }) });
          root.localStorage.setItem(fallbackKey, JSON.stringify(next));
        };
        if (root.navigator?.locks) await root.navigator.locks.request(databaseName, write); else await write();
      } else {
        revision = await transaction("readwrite", (tx, done, fail) => {
          const meta = tx.objectStore("meta"), request = meta.get("state");
          request.onsuccess = () => {
            try {
            const state = request.result;
            if (state.revision !== expectedRevision) { fail(conflict()); return; }
            revision = state.revision + 1;
            const papers = tx.objectStore("papers");
            deletes.forEach(id => papers.delete(id)); puts.forEach(paper => papers.put(paper));
            const { analysis_settings: legacySettings, ...stateBase } = state;
            meta.put({ ...stateBase, revision,
              contentRevision: contentChanged ? revision : contentVersion(state), contentRevisionAt: revision }, "state");
            if (settings !== undefined || legacySettings !== undefined) meta.put(settings ?? legacySettings, "analysis_settings");
            if (sync !== undefined) meta.put(sync, "sync");
            done(revision);
            } catch (error) { fail(error); }
          };
        });
      }
      channel?.postMessage({ revision });
      return revision;
    }

    return { read, readMeta, commit, backend: db ? "indexeddb" : "localStorage",
      subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
      close() { db?.close(); channel?.close(); root.removeEventListener?.("storage", storageListener); } };
  }
  root.LibraryStore = { open };
})(globalThis);
