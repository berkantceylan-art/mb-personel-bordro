const $ = (id) => document.getElementById(id);
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
async function load() {
  const { token } = await chrome.storage.local.get("token");
  $("setup").hidden = !!token; $("list").hidden = !token; $("msg").textContent = "";
  if (!token) return;
  const r = await send({ type: "jobs" });
  if (!r || r.error) { $("msg").textContent = (r && r.error) || "Bağlantı hatası"; return; }
  $("company").textContent = r.company + " · " + r.jobs.length + " görev";
  $("jobs").innerHTML = "";
  if (!r.jobs.length) $("jobs").innerHTML = '<p class="muted">Bekleyen görev yok. Yazılımda SGK sayfasından görev oluşturun.</p>';
  for (const j of r.jobs) {
    const d = document.createElement("div"); d.className = "job";
    d.innerHTML = `<b></b><span class="muted"></span><button>Başlat</button>`;
    d.querySelector("b").textContent = j.title;
    d.querySelector("span").textContent = new Date(j.created_at).toLocaleString("tr-TR") + (j.status === "calisiyor" ? " · çalışıyor" : "");
    d.querySelector("button").onclick = async () => { const x = await send({ type: "start", id: j.id }); if (!x.ok) $("msg").textContent = x.error || "Başlatılamadı"; else window.close(); };
    $("jobs").appendChild(d);
  }
}
$("save").onclick = async () => { const t = $("tok").value.trim(); if (!t.startsWith("mbsgk_")) { $("msg").textContent = "Anahtar mbsgk_ ile başlamalı"; return; } await chrome.storage.local.set({ token: t }); load(); };
$("refresh").onclick = load;
$("logout").onclick = async () => { await chrome.storage.local.remove("token"); load(); };
load();
