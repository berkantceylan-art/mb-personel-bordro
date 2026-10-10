// MB SGK Robotu: SGK sayfalarında etkin görevin bilgilerini doldurur. Güvenlik kodunu çözmez, gönder tuşuna basmaz.
(async () => {
  const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
  const data = await send({ type: "active" });
  if (!data || !data.job) return;
  const job = data.job, login = data.login || {};
  const norm = (s) => (s || "").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    let t = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.title].join(" ");
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += " " + l.textContent; }
    const pl = el.closest("label"); if (pl) t += " " + pl.textContent;
    const td = el.closest("td,div,li"); if (td && td.previousElementSibling) t += " " + td.previousElementSibling.textContent;
    let p = el.previousElementSibling; for (let i = 0; i < 2 && p; i++, p = p.previousElementSibling) t += " " + p.textContent;
    return norm(t);
  };
  const setVal = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    if (el.tagName === "SELECT") { const opt = [...el.options].find((o) => norm(o.text) === norm(v) || o.value === v) || [...el.options].find((o) => norm(o.text).includes(norm(v))); if (!opt) return false; v = opt.value; }
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.style.outline = "3px solid #2E9D6A"; return true;
  };
  const inputs = () => [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select")].filter((e) => e.offsetParent !== null);
  const highlightButtons = () => { for (const b of document.querySelectorAll("button, input[type=submit], input[type=button], a.btn")) { const t = norm(b.value || b.textContent); if (/(gonder|kaydet|yukle|onayla|giris yap|tamam)/.test(t)) { b.style.outline = "4px solid #E8A33D"; b.style.outlineOffset = "2px"; } } };

  function fillLogin() {
    const pw = document.querySelector("input[type=password]");
    if (!pw || !login.kullaniciAdi) return 0;
    let n = 0;
    for (const el of inputs()) {
      const l = labelOf(el);
      if (/(guvenlik|captcha|dogrulama|resim)/.test(l)) { el.style.outline = "4px solid #D9534F"; el.focus(); continue; }
      if (/kullanici/.test(l) && !/sifre/.test(l)) n += setVal(el, login.kullaniciAdi) ? 1 : 0;
      else if (/isyeri/.test(l) && /kod/.test(l)) n += setVal(el, login.isyeriKodu) ? 1 : 0;
      else if (/sistem/.test(l)) n += setVal(el, login.sistemSifre) ? 1 : 0;
      else if (/isyeri/.test(l) && /sifre/.test(l)) n += setVal(el, login.isyeriSifre) ? 1 : 0;
    }
    const cap = inputs().find((el) => /(guvenlik|captcha|dogrulama|resim)/.test(labelOf(el)));
    if (cap) cap.focus();
    highlightButtons();
    return n;
  }
  function attachXml() {
    const f = document.querySelector("input[type=file]");
    if (!f || !job.payload || !job.payload.xml) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([job.payload.xml], job.payload.fileName || "sgk.xml", { type: "text/xml" }));
    f.files = dt.files; f.dispatchEvent(new Event("change", { bubbles: true })); f.style.outline = "3px solid #2E9D6A";
    highlightButtons(); return true;
  }
  function fillFields() {
    const fields = (job.payload && job.payload.fields) || [];
    let n = 0;
    const els = inputs().filter((el) => el.type !== "password");
    for (const fld of fields) {
      if (!fld.value) continue;
      const toks = norm(fld.label).split(" ").filter((t) => t.length > 2);
      let best = null, score = 0;
      for (const el of els) { if (el.dataset.mbFilled) continue; const l = labelOf(el); const s = toks.filter((t) => l.includes(t)).length / Math.max(1, toks.length); if (s > score) { score = s; best = el; } }
      if (best && score >= 0.6 && setVal(best, fld.value)) { best.dataset.mbFilled = "1"; fld.done = true; n++; }
    }
    highlightButtons(); return n;
  }

  // Panel (gölge DOM: sayfa stillerinden etkilenmez)
  if (window.top !== window) { fillLogin(); attachXml(); fillFields(); return; }
  const host = document.createElement("div"); host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" }); document.documentElement.appendChild(host);
  root.innerHTML = `<style>
    .p{width:330px;max-height:70vh;overflow:auto;background:#fff;border:2px solid #0A3D73;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:13px system-ui,sans-serif;color:#14202E}
    .h{background:#0A3D73;color:#fff;padding:8px 10px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
    .b{padding:10px;display:flex;flex-direction:column;gap:8px}.m{color:#5A6878;font-size:12px}
    .f{display:flex;gap:6px;align-items:center;border-bottom:1px solid #EEF2F6;padding:3px 0}.f span{flex:1}.f b{font-weight:600}
    button{border:0;border-radius:8px;height:32px;padding:0 10px;font-weight:600;cursor:pointer;background:#0A3D73;color:#fff}
    button.a{background:#fff;color:#0A3D73;border:1px solid #C5D0DC}button.s{height:24px;font-size:11px;padding:0 6px}
    input{height:30px;border:1px solid #C5D0DC;border-radius:6px;padding:0 6px;width:100%;box-sizing:border-box}
    .w{background:#FFF4E0;color:#8A5A00;border-radius:8px;padding:6px 8px;font-size:12px}
  </style><div class="p"><div class="h"><span>MB SGK Robotu</span><button class="a s" id="min">—</button></div><div class="b" id="body"></div></div>`;
  const body = root.getElementById("body");
  root.getElementById("min").onclick = () => { body.hidden = !body.hidden; };
  const render = (status) => {
    const fields = (job.payload && job.payload.fields) || [];
    body.innerHTML = `<b></b><div class="w">${status}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button id="fill">Yeniden doldur</button>${job.payload && job.payload.xml ? '<button id="xml" class="a">XML dosyasını indir</button>' : ""}</div>
      <div id="fl"></div>
      <div class="m">İşlem SGK'da tamamlanınca referans / belge numarasını yazıp bitirin.</div>
      <input id="ref" placeholder="SGK referans / belge no">
      <div style="display:flex;gap:6px"><button id="ok">Tamamlandı</button><button id="err" class="a">Hata</button><button id="cancel" class="a">İptal</button></div>`;
    body.querySelector("b").textContent = job.title;
    const fl = body.querySelector("#fl");
    for (const f of fields) {
      const d = document.createElement("div"); d.className = "f";
      d.innerHTML = `<span><span class="m"></span><br><b></b></span><button class="a s">Kopyala</button>`;
      d.querySelector(".m").textContent = f.label + (f.done ? " ✓" : "");
      d.querySelector("b").textContent = f.value;
      d.querySelector("button").onclick = () => navigator.clipboard.writeText(f.value);
      fl.appendChild(d);
    }
    body.querySelector("#fill").onclick = () => run();
    const xb = body.querySelector("#xml"); if (xb) xb.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([job.payload.xml], { type: "text/xml" })); a.download = job.payload.fileName || "sgk.xml"; a.click(); };
    const fin = async (st) => { const r = await send({ type: "finish", status: st, reference: body.querySelector("#ref").value }); if (r && r.ok) { body.innerHTML = '<div class="w">Sonuç yazılıma kaydedildi. Bu pencereyi kapatabilirsiniz.</div>'; } else alert((r && r.error) || "Kaydedilemedi"); };
    body.querySelector("#ok").onclick = () => fin("tamamlandi");
    body.querySelector("#err").onclick = () => fin("hata");
    body.querySelector("#cancel").onclick = () => fin("iptal");
  };
  function run() {
    const parts = [];
    const l = fillLogin(); if (l) parts.push(`Giriş bilgileri dolduruldu (${l} alan). Güvenlik kodunu girip "Giriş"e basın.`);
    if (attachXml()) parts.push("XML dosyası seçildi. Kontrol edip turuncu çerçeveli yükle / gönder tuşuna basın.");
    const n = fillFields(); if (n) parts.push(`${n} alan dolduruldu (yeşil). Kalanları aşağıdan kopyalayın.`);
    if (!parts.length) parts.push(document.querySelector("input[type=password]") ? "Giriş alanları bulunamadı; bilgileri elle girin." : "Bu sayfada doldurulacak alan bulunamadı. İlgili menüye gidin; robot her sayfada yeniden dener.");
    render(parts.join(" "));
  }
  run();
})();
