(function (root) {
  "use strict";
  async function init(app) {
    const config = root.PaperCloudConfig, el = id => document.getElementById(id);
    if (!config?.url || !el("cloudButton")) return;
    const button = el("cloudButton"), dialog = el("cloudDialog"), message = el("cloudMessage"), form = el("cloudLoginForm");
    let client, store = null, user = null, active = false, generation = 0, busy = false;
    let currentState = "local", authSerial = Promise.resolve();
    const labels = { local: "云端同步", ready: "启用云端库", pending: "待同步", syncing: "正在同步…", synced: "已同步", offline: "同步待重试", conflict: "同步有冲突", login: "请重新登录" };
    const controls = () => {
      form.hidden = !!user;
      el("cloudAccount").textContent = user?.email || "登录后可在多个设备读取同一文献库。";
      el("cloudSetup").hidden = !user || active;
      el("cloudConnected").hidden = !active;
      el("cloudConflict").hidden = currentState !== "conflict";
      el("cloudLogout").hidden = !user;
      for (const id of ["cloudUse", "cloudMigrate", "cloudRetry", "cloudLogout", "cloudKeepLocal", "cloudUseRemote", "cloudLogin"]) el(id).disabled = busy;
      button.textContent = labels[currentState] || "云端同步";
      button.dataset.state = currentState;
      el("cloudBanner").hidden = !["pending", "offline", "conflict", "login"].includes(currentState);
      el("cloudBanner").textContent = currentState === "conflict" ? "云端有其他设备的新改动。本机修改已保留，请打开“同步有冲突”选择处理方式。" :
        currentState === "login" ? "登录已失效。待同步数据保留在此账号的本机缓存中，重新登录后继续。" :
          "本机修改已保存，正在等待上传。可以继续使用；通过顶部同步按钮查看状态。";
    };
    function status(info) {
      currentState = info.state;
      const messages = { synced: `云端已同步（版本 ${info.revision ?? "—"}）。星标、导入内容和引用分析设置都会同步。`,
        pending: `本机已保存，${info.pending || 1} 项操作等待上传。`, syncing: "正在核对并同步云端文献…",
        conflict: "云端版本已变化。本机待同步内容已保留，请先导出备份，再选择使用哪个版本。",
        offline: `同步暂未完成，本机数据已保留。${info.error?.message || "请检查网络后重试。"}` };
      message.textContent = messages[info.state] || "";
      controls();
    }
    async function work(action) {
      if (busy) return;
      busy = true; controls();
      try { await action(); } catch (error) {
        message.textContent = /PGRST202|Could not find the function/.test(`${error.code} ${error.message}`) ?
          "数据库还缺同步函数。请在 Supabase 的 SQL Editor 执行 002_cloud_sync.sql，然后重试。" : error.message;
      } finally { busy = false; controls(); }
    }
    button.addEventListener("click", () => dialog.showModal());
    el("cloudClose").addEventListener("click", () => dialog.close());
    if (!root.supabase) {
      message.textContent = "登录组件未能加载，请刷新网页重试。当前仍可使用本地文献库。";
      el("cloudLogin").disabled = true; return;
    }
    client = root.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
        storageKey: `paper-cloud-auth:${new URL(config.url).hostname}` }
    });
    async function sessionChanged(session) {
      const nextUser = session?.user || null;
      if (user?.id && user.id === nextUser?.id) return;
      const token = ++generation;
      if (active) await app.useLocal();
      store?.close(); store = null; active = false; user = nextUser;
      if (!user) { currentState = "local"; message.textContent = "当前使用此浏览器的本地文献库。"; controls(); return; }
      currentState = "ready"; message.textContent = "正在检查账号文献库…"; controls();
      store = await root.CloudStore.open({ client, userId: user.id, project: new URL(config.url).hostname, normalizePaper: app.normalizePaper,
        onStatus: info => { if (token === generation && active) status(info); } });
      const cached = await store.read();
      if (cached.sync?.initialized) {
        await app.useStore(store); active = true; controls();
        await store.sync().catch(() => {});
      } else {
        await preview();
      }
    }
    async function preview() {
      const [remote, local] = await Promise.all([store.status(), app.localSnapshot()]);
      message.textContent = `此浏览器本地 ${local.papers.length} 篇；此账号云端 ${remote.papers} 篇、${remote.works} 篇被引文献。`;
      el("cloudMigrate").textContent = remote.papers ? "合并本地库并启用同步" : "迁移本地库并启用同步";
      currentState = "ready"; controls();
    }
    function queueSession(session) {
      authSerial = authSerial.catch(() => {}).then(async () => {
        while (busy) await new Promise(resolve => root.setTimeout(resolve, 50));
        await work(() => sessionChanged(session));
      });
    }
    // The auth callback must return synchronously; calling SDK methods inside it can deadlock.
    client.auth.onAuthStateChange((_event, session) => root.setTimeout(() => queueSession(session), 0));
    form.addEventListener("submit", event => {
      event.preventDefault();
      work(async () => {
        const password = el("cloudPassword").value;
        const { data, error } = await client.auth.signInWithPassword({ email: el("cloudEmail").value.trim(), password });
        el("cloudPassword").value = "";
        if (error) throw new Error(error.message === "Invalid login credentials" ? "邮箱或密码不正确，请使用 Authentication → Users 中的账号。" : error.message);
        // Queue after this UI operation releases its busy flag.
        root.setTimeout(() => queueSession(data.session), 0);
      });
    });
    async function enable(mergeLocal) {
      if (!store) return;
      const local = mergeLocal ? await app.localSnapshot() : null;
      await store.initialize();
      await app.useStore(store); active = true; controls();
      if (local?.papers.length) await app.importLocal(local);
      await store.sync();
    }
    el("cloudUse").addEventListener("click", () => work(() => enable(false)));
    el("cloudMigrate").addEventListener("click", () => work(() => enable(true)));
    el("cloudRetry").addEventListener("click", () => work(() => active ? store.sync() : preview()));
    el("cloudSetupRetry").addEventListener("click", () => work(preview));
    el("cloudLogout").addEventListener("click", () => work(async () => {
      const cached = await store?.read();
      if (cached?.sync?.queue.length && !root.confirm(`还有 ${cached.sync.queue.length} 项改动未上传。退出后将保留在此账号的本机缓存中，下次登录继续。确定退出？`)) return;
      // Local sign-out does not revoke other devices' sessions.
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      await sessionChanged(null);
    }));
    el("cloudBackup").addEventListener("click", () => work(() => app.exportCurrent()));
    for (const [id, choice] of [["cloudKeepLocal", "local"], ["cloudUseRemote", "cloud"]]) el(id).addEventListener("click", () => work(async () => {
      const warning = choice === "local" ? "用本机当前完整文献库替换云端版本？其他设备的新改动可能被替换；云端版本也会下载为备份。" :
        "采用云端版本并放弃本机待同步操作？会先下载本机库备份。";
      if (!root.confirm(warning)) return;
      await app.exportCurrent();
      await store.resolve(choice, snapshot => app.exportSnapshot(snapshot, "cloud-before-conflict")); await store.sync();
    }));
    const poll = () => { if (active && !busy && document.visibilityState !== "hidden") store.sync().catch(() => {}); };
    root.addEventListener("online", poll);
    document.addEventListener("visibilitychange", poll);
    root.setInterval(poll, 30000);
    app.setRemoteAnalysis(async options => active ? store.analysis(options) : null);
    const { data, error } = await client.auth.getSession();
    if (error) { message.textContent = error.message; controls(); }
    else queueSession(data.session);
    controls();
  }
  root.CloudUI = { init };
})(globalThis);
