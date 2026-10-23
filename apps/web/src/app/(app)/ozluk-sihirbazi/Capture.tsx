"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dossRegister, type DossFile, type DossResult } from "@/lib/dossier-actions";
import { LiveCamera, isTouchDevice } from "@/components/LiveCamera";

// Chrome / Edge masaüstü: klasör izleme (File System Access API)
type DirHandle = { name: string; values: () => AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }> };
const SCAN_EXT = /\.(jpe?g|png|webp|pdf)$/i;

type Item = { key: string; file: File; url: string | null; rot: number; status: "wait" | "up" | "ok" | "err" };

/** Görseli döndürür, uzun kenarı en fazla 2200 px olacak şekilde JPEG'e çevirir (belge okuma için yeterli netlik) */
async function toJpeg(file: File, rot: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const max = 2200;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  const swap = rot % 180 !== 0;
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Görsel işlenemedi"))), "image/jpeg", 0.84));
}

export function Capture({
  employeeId, companyId, mode, title, hint, onDone, autoUpload = false, big = false,
}: {
  employeeId: string; companyId: string; mode: "id" | "sgk" | "docs" | "payslip" | "leave" | "exit";
  title?: string; hint?: string; onDone?: (r: DossResult) => void; autoUpload?: boolean; big?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [auto, setAuto] = useState(autoUpload);
  const [liveCam, setLiveCam] = useState(false);
  const [watch, setWatch] = useState<{ name: string; found: number } | null>(null);
  const dir = useRef<DirHandle | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const sizes = useRef<Map<string, number>>(new Map());

  const openCamera = () => (isTouchDevice() ? cam.current?.click() : setLiveCam(true));

  // Tarayıcı (scanner) kayıt klasörünü izle: yeni gelen dosya yazımı bitince otomatik yüklenip okunur
  async function startWatch() {
    const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> };
    if (!w.showDirectoryPicker) { setMsg({ ok: false, text: "Klasör izleme yalnız bilgisayarda Chrome ya da Edge ile çalışır." }); return; }
    let h: DirHandle;
    try { h = await w.showDirectoryPicker({ mode: "read", id: "ozluk-tarama" }); } catch { return; }
    seen.current = new Set();
    sizes.current = new Map();
    for await (const e of h.values()) if (e.kind === "file") seen.current.add(e.name);  // klasörde zaten olanlar atlanır
    dir.current = h;
    setAuto(true);
    setWatch({ name: h.name, found: 0 });
    setMsg({ ok: true, text: `"${h.name}" klasörü izleniyor. Tarayıcıda taradığınız belge bu klasöre düştüğü anda yüklenip okunur.` });
  }
  const stopWatch = () => { dir.current = null; setWatch(null); };
  useEffect(() => {
    if (!watch) return;
    let stop = false;
    const tick = async () => {
      const h = dir.current;
      if (!h || stop) return;
      const fresh: File[] = [];
      try {
        for await (const e of h.values()) {
          if (e.kind !== "file" || seen.current.has(e.name) || !SCAN_EXT.test(e.name) || !e.getFile) continue;
          const f = await e.getFile();
          // dosya hâlâ yazılıyorsa boyutu değişir: iki kontrol arası aynı kalınca alınır
          if (f.size > 0 && sizes.current.get(e.name) === f.size) { seen.current.add(e.name); fresh.push(f); } else sizes.current.set(e.name, f.size);
        }
      } catch { setMsg({ ok: false, text: "Klasöre erişim kesildi; yeniden seçin." }); stopWatch(); return; }
      if (fresh.length) {
        const dt = new DataTransfer();
        fresh.forEach((f) => dt.items.add(f));
        add(dt.files, "scan");
        setWatch((w0) => (w0 ? { ...w0, found: w0.found + fresh.length } : w0));
      }
    };
    const t = setInterval(() => void tick(), 2500);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch?.name]);

  const add = (list: FileList | null, source: "camera" | "scan") => {
    if (!list?.length) return;
    const next = [...list].map((file) => ({ key: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, rot: 0, status: "wait" as const }));
    setItems((cur) => [...cur, ...next]);
  };
  const busyRef = useRef(false);
  // belge modunda seri çekimde birkaç saniye beklenir: aynı belgenin sayfaları birlikte okunsun (sözleşme 2-3 sayfa)
  const multi = mode === "docs" || mode === "exit";
  useEffect(() => {
    if (!auto || busyRef.current || !items.some((x) => x.status === "wait")) return;
    const t = setTimeout(() => void run(items), multi ? 4000 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, auto]);

  async function run(list = items) {
    const todo = list.filter((x) => x.status === "wait" || x.status === "err");
    if (!todo.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    const sb = createClient();
    const files: DossFile[] = [];
    for (const it of todo) {
      setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, status: "up" } : x)));
      try {
        const isPdf = it.file.type === "application/pdf" || it.file.name.toLowerCase().endsWith(".pdf");
        const body = isPdf ? it.file : await toJpeg(it.file, it.rot);
        const path = `${companyId}/employees/${employeeId}/arsiv/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${isPdf ? "pdf" : "jpg"}`;
        const { error } = await sb.storage.from("documents").upload(path, body, { contentType: isPdf ? "application/pdf" : "image/jpeg" });
        if (error) throw new Error(error.message);
        files.push({ path, name: it.file.name || (isPdf ? "tarama.pdf" : "foto.jpg"), mime: isPdf ? "application/pdf" : "image/jpeg", source: it.key.startsWith("camera") ? "camera" : isPdf ? "scan" : "upload" });
        setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, status: "ok" } : x)));
      } catch (e) {
        setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, status: "err" } : x)));
        setMsg({ ok: false, text: `Yüklenemedi: ${(e as Error).message}` });
      }
    }
    if (files.length) {
      setMsg({ ok: true, text: "Okunuyor… (sayfa başına birkaç saniye)" });
      const all: DossResult = { ok: true, message: "" };
      const msgs: string[] = [];
      const per = multi ? 12 : 4;  // belge modunda tüm sayfalar tek seferde: çok sayfalı belgeler bölünmez
      for (let i = 0; i < files.length; i += per) {
        const fd = new FormData();
        fd.set("employeeId", employeeId);
        fd.set("mode", mode);
        fd.set("files", JSON.stringify(files.slice(i, i + per)));
        const r = await dossRegister(null, fd);
        if (!r.ok) { all.ok = false; }
        msgs.push(r.message);
        all.id = { ...(all.id ?? {}), ...(r.id ?? {}) };
        all.sgk = { ...(all.sgk ?? {}), ...(r.sgk ?? {}) };
        all.docs = [...(all.docs ?? []), ...(r.docs ?? [])];
        all.slips = [...(all.slips ?? []), ...(r.slips ?? [])];
        all.leaves = [...(all.leaves ?? []), ...(r.leaves ?? [])];
      }
      all.message = msgs.join(" ");
      setMsg({ ok: all.ok, text: all.message });
      onDone?.(all);
      setItems((cur) => cur.filter((x) => x.status !== "ok"));
      router.refresh();
    }
    busyRef.current = false;
    setBusy(false);
  }

  const pending = items.filter((x) => x.status === "wait" || x.status === "err").length;
  const btn = big ? "h-20 text-lg" : "h-14";
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border-2 border-dashed border-brand-600/40 bg-[#F7FAFD] p-4">
      {title && <div className="font-semibold text-brand-800">{title}</div>}
      {hint && <p className="text-xs text-muted -mt-2">{hint}</p>}
      <div className="grid gap-2 grid-cols-2">
        <button type="button" onClick={openCamera} className={`${btn} rounded-[12px] bg-brand-700 text-white font-bold flex items-center justify-center gap-2`}>📷 Kamerayla çek</button>
        <button type="button" onClick={() => pick.current?.click()} className={`${btn} rounded-[12px] border-2 border-brand-700 text-brand-700 bg-white font-bold flex items-center justify-center gap-2`}>🗂 Tarayıcı / dosya</button>
      </div>
      {!watch ? (
        <button type="button" onClick={() => void startWatch()} className="h-11 rounded-[12px] border border-brand-700/40 bg-white text-sm font-semibold text-brand-700">🖨 Otomatik tarama: tarayıcının kayıt klasörünü izle</button>
      ) : (
        <div className="flex items-center gap-2 rounded-[12px] bg-[#E6F4EC] px-3 py-2 text-sm text-[#1A7F52]">
          <span className="inline-block w-2 h-2 rounded-full bg-[#1A7F52] animate-pulse" />
          <span className="flex-1"><b>{watch.name}</b> izleniyor · taradığınız belge otomatik eklenir{watch.found ? ` · ${watch.found} belge alındı` : ""}</span>
          <button type="button" onClick={stopWatch} className="font-semibold underline">Durdur</button>
        </div>
      )}
      <LiveCamera open={liveCam} onClose={() => setLiveCam(false)} onShot={(f) => { const dt = new DataTransfer(); dt.items.add(f); add(dt.files, "camera"); }} />
      <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files, "camera"); e.target.value = ""; }} />
      <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files, "scan"); e.target.value = ""; }} />
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="w-4 h-4" />Çeker çekmez yükle ve oku (seri çekim)</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <div key={it.key} className="relative w-20 h-24 rounded-lg overflow-hidden border border-line bg-white grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.url ? <img src={it.url} alt="" className="w-full h-full object-cover" style={{ transform: `rotate(${it.rot}deg)` }} /> : <span className="text-xs text-muted text-center px-1">📄 {it.file.name.slice(0, 18)}</span>}
              <span className={`absolute top-1 left-1 text-[10px] px-1.5 rounded font-semibold ${it.status === "ok" ? "bg-ok text-white" : it.status === "up" ? "bg-brand-700 text-white" : it.status === "err" ? "bg-bad text-white" : "bg-white/90 text-muted"}`}>{{ wait: "sırada", up: "…", ok: "✓", err: "hata" }[it.status]}</span>
              {it.status === "wait" && (
                <div className="absolute bottom-0 inset-x-0 flex">
                  {it.url && <button type="button" onClick={() => setItems((c) => c.map((x) => (x.key === it.key ? { ...x, rot: (x.rot + 90) % 360 } : x)))} className="flex-1 bg-black/60 text-white text-xs py-0.5" aria-label="Döndür">⟳</button>}
                  <button type="button" onClick={() => setItems((c) => c.filter((x) => x.key !== it.key))} className="flex-1 bg-black/60 text-white text-xs py-0.5" aria-label="Çıkar">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {pending > 0 && !auto && (
        <button type="button" disabled={busy} onClick={() => run()} className="h-12 rounded-[12px] bg-ok text-white font-bold disabled:opacity-60">{busy ? "Yükleniyor ve okunuyor…" : `${pending} dosyayı yükle ve oku`}</button>
      )}
      {busy && auto && <p className="text-sm text-brand-700">Yükleniyor ve okunuyor…</p>}
      {msg && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
