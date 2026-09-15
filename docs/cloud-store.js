/* Account-scoped offline cache + durable, ordered, idempotent RPC outbox. */
(function (root) {
  "use strict";
  const emptySync = () => ({ initialized: false, remoteRevision: 0, queue: [] });
  const conflict = error => /cloud_revision_conflict/.test(error?.message || "");
  async function open({ client, userId, project, normalizePaper, onStatus = () => {} }) {
    const namespace = `cloud:${project}:${userId}`;
    const cache = await root.LibraryStore.open({ namespace, normalizePaper });
    const subscribers = new Set();
    let closed = false, running = null, timer = null, lastError = null;
    const emit = () => subscribers.forEach(fn => fn());
    const unsubscribe = cache.subscribe(emit);
    const report = (state, extra = {}) => { if (!closed) onStatus({ state, ...extra }); };
    async function rpc(name, args = {}) {
      const controller = new AbortController();
      const timeout = root.setTimeout(() => controller.abort(), 20000);
      try {
        const sessionResult = await client.auth.getSession();
        const session = sessionResult.data?.session;
        if (sessionResult.error || session?.user.id !== userId || !session.access_token) throw new Error("登录账号已变化或失效，请重新登录此文献库账号");
        // Pin this request to the cache owner even if another tab switches accounts
        // between reading the session and sending the request.
        const { data, error } = await client.rpc(`paper_library_${name}`, args)
          .setHeader("Authorization", `Bearer ${session.access_token}`).abortSignal(controller.signal);
        if (error) throw Object.assign(new Error(error.message || "云端请求失败"), { code: error.code });
        return data;
      } finally { root.clearTimeout(timeout); }
    }
    async function remoteSnapshot(since, expected) {
      const status = expected || await rpc("status");
      if (status.sync_version !== 1) throw new Error("请先在 SQL Editor 执行 002_cloud_sync.sql");
      let after = "", settings = {}, changes = [];
      do {
        const page = await rpc("pull", { expected_revision: status.revision, since_revision: since, after_id: after });
        if (!after) settings = page.settings;
        changes.push(...page.changes);
        if (page.changes.length < 100) break;
        after = page.changes.at(-1).paper_id;
      } while (!closed);
      const ids = changes.filter(item => !item.deleted).map(item => item.paper_id), papers = [];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const rows = await rpc("read_papers", { expected_revision: status.revision, paper_ids: batch });
        if (rows.length !== batch.length) throw new Error("云端文献记录不完整，未替换本地缓存");
        papers.push(...rows);
      }
      root.PaperData.validateBackup({ papers, analysis_settings: settings });
      return { papers, analysis_settings: settings, deletes: changes.filter(item => item.deleted).map(item => item.paper_id), remoteRevision: status.revision };
    }
    function schedule() {
      if (closed) return;
      root.clearTimeout(timer);
      timer = root.setTimeout(() => sync().catch(() => {}), 700);
    }
    async function commit(change) {
      if (closed) throw new Error("账号已切换，请重试");
      const snapshot = await cache.read(), syncState = snapshot.sync || emptySync();
      if (!syncState.initialized) throw new Error("请先启用云端文献库");
      if (snapshot.revision !== change.expectedRevision) throw Object.assign(new Error("文献库已更新，请重试"), { code: "revision_conflict" });
      const payload = root.CloudData.edit(snapshot, change);
      const operation = { id: root.crypto.randomUUID(), payload };
      const revision = await cache.commit({ ...change, sync: { ...syncState, queue: [...syncState.queue, operation] } });
      report(lastError && conflict(lastError) ? "conflict" : "pending", { pending: syncState.queue.length + 1 });
      schedule();
      return revision;
    }
    // An acknowledgement changes only sync metadata. Edits appended during an uncertain
    // network request remain queued. Reusing the operation UUID cannot apply it twice.
    async function acknowledge(id, remoteRevision) {
      for (;;) {
        if (closed) return;
        const snapshot = await cache.readMeta();
        if (snapshot.sync.queue[0]?.id !== id) return;
        try {
          await cache.commit({ expectedRevision: snapshot.revision,
            sync: { ...snapshot.sync, remoteRevision, queue: snapshot.sync.queue.slice(1) } });
          emit(); return;
        } catch (error) { if (error.code !== "revision_conflict") throw error; }
      }
    }
    async function synchronize() {
      report("syncing");
      try {
        for (let sent = 0; sent < 50 && !closed; sent++) {
          const snapshot = await cache.readMeta(), state = snapshot.sync || emptySync();
          if (!state.initialized) return;
          const operation = state.queue[0];
          if (operation) {
            const revision = await rpc("commit", { expected_revision: state.remoteRevision, operation_id: operation.id, payload: operation.payload });
            await acknowledge(operation.id, revision);
            continue;
          }
          const status = await rpc("status");
          if (status.revision !== state.remoteRevision) {
            const remote = await remoteSnapshot(state.remoteRevision, status);
            if (closed) return;
            // CAS prevents a download from discarding a simultaneous local edit.
            await cache.commit({ puts: remote.papers, deletes: remote.deletes, settings: remote.analysis_settings,
              expectedRevision: snapshot.revision, sync: { ...state, remoteRevision: remote.remoteRevision } });
            emit();
          }
          lastError = null; report("synced", { revision: status.revision }); return;
        }
        schedule();
      } catch (error) {
        lastError = error;
        const current = await cache.readMeta();
        report(conflict(error) ? "conflict" : "offline", { error, pending: current.sync?.queue.length || 0 });
        throw error;
      }
    }
    function exclusive(action) {
      return root.navigator?.locks ? root.navigator.locks.request(`sync:${namespace}`, action) : action();
    }
    function sync() {
      if (closed) return Promise.resolve();
      if (!running) running = exclusive(synchronize).finally(() => { running = null; });
      return running;
    }
    async function initialize() {
      const snapshot = await cache.read();
      if (snapshot.sync?.initialized) return;
      const remote = await remoteSnapshot(-1);
      if (closed) throw new Error("账号已切换");
      await cache.commit({ puts: remote.papers, deletes: snapshot.papers.map(p => p.id), settings: remote.analysis_settings,
        expectedRevision: snapshot.revision, sync: { initialized: true, remoteRevision: remote.remoteRevision, queue: [] } });
      report("synced", { revision: remote.remoteRevision });
    }
    async function resolve(choice, backupRemote = async () => {}) {
      if (running) await running.catch(() => {});
      return exclusive(async () => {
        const snapshot = await cache.read(), remote = await remoteSnapshot(-1);
        if (closed) throw new Error("账号已切换");
        const state = { initialized: true, remoteRevision: remote.remoteRevision, queue: [] };
        if (choice === "local") await backupRemote(remote);
        if (choice === "local") state.queue.push({ id: root.crypto.randomUUID(), payload: root.CloudData.delta(remote, snapshot) });
        else if (choice !== "cloud") throw new Error("未知冲突处理方式");
        await cache.commit({ expectedRevision: snapshot.revision, sync: state,
          ...(choice === "cloud" ? { puts: remote.papers, deletes: snapshot.papers.map(p => p.id), settings: remote.analysis_settings } : {}) });
        lastError = null; emit(); schedule();
      });
    }
    async function analysis(options) {
      const snapshot = await cache.readMeta();
      if (closed || !snapshot.sync?.initialized || snapshot.sync.queue.length || lastError) return null;
      const result = await rpc("analysis", { expected_revision: snapshot.sync.remoteRevision, ...options });
      const current = await cache.readMeta();
      return current.revision === snapshot.revision && !closed ? result : null;
    }
    return { read: cache.read, readMeta: cache.readMeta, commit, initialize, sync, resolve, analysis, status: () => rpc("status"), backend: "supabase", namespace,
      subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
      close() { closed = true; root.clearTimeout(timer); unsubscribe(); subscribers.clear(); cache.close(); } };
  }
  root.CloudStore = { open };
})(globalThis);
