(function () {
  const endpoint = "/__dev/revision";
  const script = document.currentScript;
  let currentServerId = script ? script.dataset.serverId || null : null;
  let currentRevision = null;
  let pendingChange = null;
  let timer = null;
  let checking = false;
  let reloading = false;

  function scheduleCheck(delay = 1000) {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (document.hidden || reloading) return;
    timer = window.setTimeout(checkForChanges, delay);
  }

  async function checkForChanges() {
    timer = null;
    if (checking || document.hidden || reloading) return;
    checking = true;

    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return;

      const payload = await response.json();
      if (!payload || typeof payload.revision !== "string") return;

      const serverId = typeof payload.server_id === "string" ? payload.server_id : null;
      if (currentRevision === null) {
        currentRevision = payload.revision;
        if (!currentServerId) currentServerId = serverId;
        if (serverId && currentServerId && serverId !== currentServerId) {
          pendingChange = `${serverId}:${payload.revision}`;
        }
        return;
      }

      const changed = payload.revision !== currentRevision
        || (serverId && currentServerId && serverId !== currentServerId);
      if (!changed) {
        pendingChange = null;
        return;
      }

      const signature = `${serverId || ""}:${payload.revision}`;
      if (pendingChange === signature) {
        reloading = true;
        window.location.reload();
        return;
      }
      pendingChange = signature;
    } catch (_error) {
      // Retry after Flask restarts or a mobile connection briefly drops.
    } finally {
      checking = false;
      scheduleCheck(1000);
    }
  }

  function checkWhenVisible() {
    if (document.hidden) {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      return;
    }
    checkForChanges();
  }

  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("pageshow", checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  window.addEventListener("online", checkWhenVisible);
  scheduleCheck(0);
})();
