importScripts("config.js");
// Etkin görev yalnız bellekte (oturum depolaması) tutulur; tarayıcı kapanınca silinir.
const ORIGIN = self.MB_APP_ORIGIN;

async function token() { return (await chrome.storage.local.get("token")).token || ""; }
async function api(path, opts = {}) {
  const r = await fetch(ORIGIN + path, { ...opts, headers: { "authorization": "Bearer " + (await token()), "content-type": "application/json", ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || ("HTTP " + r.status));
  return body;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    try {
      if (msg.type === "jobs") return reply(await api("/api/sgk-robot/jobs"));
      if (msg.type === "start") {
        const data = await api(`/api/sgk-robot/jobs/${msg.id}/start`, { method: "POST" });
        await chrome.storage.session.set({ active: data });
        await chrome.tabs.create({ url: data.job.target_url || "https://e.sgk.gov.tr/Uygulamalar/Isveren" });
        return reply({ ok: true });
      }
      if (msg.type === "active") return reply((await chrome.storage.session.get("active")).active || null);
      if (msg.type === "finish") {
        const a = (await chrome.storage.session.get("active")).active;
        if (!a) return reply({ ok: false, error: "Etkin görev yok" });
        await api(`/api/sgk-robot/jobs/${a.job.id}/finish`, { method: "POST", body: JSON.stringify({ status: msg.status, reference: msg.reference || "", note: msg.note || "" }) });
        await chrome.storage.session.remove("active");
        return reply({ ok: true });
      }
      if (msg.type === "clear") { await chrome.storage.session.remove("active"); return reply({ ok: true }); }
      reply({ ok: false });
    } catch (e) { reply({ ok: false, error: String(e.message || e) }); }
  })();
  return true;
});
