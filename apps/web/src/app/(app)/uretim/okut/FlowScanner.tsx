"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { flowScan, type FlowResult } from "@/lib/flow-actions";
import { ACTION_BUTTON, FLOW_ROLE, FLOW_STAGE } from "@/lib/flow";

type P = { id: string; name: string; role: string };

/** Kutu okut: kamera ya da el okuyucu. İlk okutma = aldım; teknisyende ikinci okutma = bitirdim. Şef / kontrol / pazarlama düğmeyle karar verir. */
export function FlowScanner({ me, people, canPickPerson }: { me: P | null; people: P[]; canPickPerson: boolean }) {
  const router = useRouter();
  const [emp, setEmp] = useState(me?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  const [res, setRes] = useState<FlowResult | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [log, setLog] = useState<{ at: string; text: string; ok: boolean }[]>([]);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const last = useRef({ code: "", t: 0 });
  const lastCode = useRef("");

  useEffect(() => {
    if (canPickPerson) { try { const v = localStorage.getItem("flow-emp"); if (v) setEmp(v); } catch { /* yok */ } }
    return () => stop.current?.();
  }, [canPickPerson]);

  // Çevrimdışı kuyruk: bağlantı yokken okutmalar telefonda saklanır, bağlantı gelince sırayla gönderilir
  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQ().length);
    const flush = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      let q = readQ();
      while (q.length) {
        const it = q[0]!;
        try {
          const r = await flowScan(it.code, it.emp, it.action, it.reason, it.target);
          setLog((l) => [{ at: new Date(it.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), text: `(çevrimdışı okutma) ${r.ok ? `İş #${r.job} — ${actionText(r)}` : r.message ?? "Hata"}`, ok: r.ok }, ...l].slice(0, 15));
        } catch { break; }
        q = readQ().slice(1);
        writeQ(q);
        setQueued(q.length);
      }
      router.refresh();
    };
    void flush();
    const on = () => void flush();
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = setInterval(() => { if (readQ().length) void flush(); }, 30000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, [router]);

  const person = people.find((p) => p.id === emp) ?? me;

  async function run(c: string, action = "auto", rsn: string | null = null, tgt: string | null = null) {
    const v = c.trim();
    if (!v || busy) return;
    setBusy(true);
    let r: FlowResult;
    try {
      if (!navigator.onLine) throw new Error("offline");
      r = await flowScan(v, emp || null, action, rsn, tgt);
    } catch {
      // bağlantı yok: kuyruğa al
      const q = [...readQ(), { code: v, emp: emp || null, action, reason: rsn, target: tgt, at: Date.now() }];
      writeQ(q);
      setQueued(q.length);
      setBusy(false);
      setCode("");
      setLog((l) => [{ at: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), text: `${v} — bağlantı yok, sıraya alındı (${q.length})`, ok: true }, ...l].slice(0, 15));
      if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
      input.current?.focus();
      return;
    }
    setBusy(false);
    setCode("");
    setRejecting(false); setReason(""); setTarget("");
    lastCode.current = v;
    setRes(r);
    const text = r.ok ? `İş #${r.job} ${r.patient ?? ""} — ${actionText(r)}` : r.message ?? "Hata";
    setLog((l) => [{ at: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), text, ok: r.ok }, ...l].slice(0, 15));
    if (navigator.vibrate) navigator.vibrate(r.ok ? 70 : [90, 60, 90]);
    if (r.ok) router.refresh();
    input.current?.focus();
  }

  async function camera() {
    if (on) { stop.current?.(); setOn(false); return; }
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      setOn(true);
      const controls = await new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (r) => {
        if (!r) return;
        const t = r.getText(), n = Date.now();
        if (last.current.code === t && n - last.current.t < 5000) return;
        last.current = { code: t, t: n };
        void run(t);
      });
      stop.current = () => controls.stop();
    } catch { setOn(false); }
  }

  const stage = res?.stage ? FLOW_STAGE[res.stage] : null;
  return (
    <div className="flex flex-col gap-4">
      {(!online || queued > 0) && (
        <div className={`rounded-[12px] px-4 py-3 text-sm font-semibold ${online ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"}`}>
          {online ? `${queued} çevrimdışı okutma gönderiliyor…` : `İnternet yok: okutmalar telefonda saklanıyor${queued ? ` (${queued})` : ""}; bağlantı gelince otomatik gönderilir.`}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {canPickPerson ? (
          <label className="flex flex-col gap-1 text-sm font-semibold">Okutan kişi
            <select value={emp} onChange={(e) => { setEmp(e.target.value); try { localStorage.setItem("flow-emp", e.target.value); } catch { /* yok */ } }} className="h-12 min-w-64 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
              {me && <option value={me.id}>Ben ({me.name})</option>}
              {people.filter((p) => p.id !== me?.id).map((p) => <option key={p.id} value={p.id}>{p.name} · {FLOW_ROLE[p.role] ?? p.role}</option>)}
            </select>
          </label>
        ) : (
          <div className="text-sm"><b>{person?.name ?? "—"}</b> <span className="text-muted">· {FLOW_ROLE[person?.role ?? "technician"]}</span></div>
        )}
        <button type="button" onClick={camera} className="h-12 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold">{on ? "Kamerayı kapat" : "📷 Kamerayla okut"}</button>
      </div>

      <div className={`relative rounded-2xl overflow-hidden bg-black aspect-[4/3] sm:aspect-[16/9] max-h-[45vh] ${on ? "" : "hidden"}`}>
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-[18%] border-2 border-white/80 rounded-xl" />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void run(code); }} className="flex gap-2">
        <input ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" placeholder="İş no ya da kutudaki QR" className="h-16 min-w-0 flex-1 rounded-[14px] border-2 border-brand-600 bg-white px-4 font-mono text-2xl" />
        <button disabled={busy} className="h-16 px-6 rounded-[14px] bg-brand-700 text-lg font-bold text-white disabled:opacity-60">{busy ? "…" : "Okut"}</button>
      </form>

      {res && !res.ok && <div className="rounded-[16px] bg-bad-bg p-4 text-lg font-semibold text-bad">✖ {res.message}</div>}
      {res?.ok && (
        <section className="overflow-hidden rounded-[18px] border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 p-4 text-white" style={{ background: stage?.[1] ?? "#0A3D73" }}>
            <span className="font-display text-3xl font-black">#{res.job}</span>
            <span className="text-lg font-semibold">{actionText(res)}</span>
            <span className="ml-auto rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">{stage?.[0]}</span>
          </div>
          <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
            <div><span className="block text-xs text-muted">Hasta</span><b className="text-base">{res.patient ?? "—"}</b></div>
            <div><span className="block text-xs text-muted">Hekim / klinik</span><b className="text-base">{res.customer ?? "—"}{res.doctor ? ` · ${res.doctor}` : ""}</b></div>
            <div><span className="block text-xs text-muted">Teslim</span><b>{res.due ? new Date(res.due).toLocaleDateString("tr-TR") : "—"}</b></div>
            <div><span className="block text-xs text-muted">Şu an elinde</span><b>{res.holder ?? "kimsede değil (sırada)"}</b>{res.minutes ? <span className="text-muted"> · {res.minutes} dk çalışıldı</span> : null}</div>
          </div>
          {(res.warnings ?? []).map((w, i) => <p key={i} className="mx-4 mb-2 rounded-lg bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">⚠ {w}</p>)}
          {(res.options ?? []).length > 0 && !rejecting && (
            <div className="flex flex-wrap gap-2 border-t border-line p-4">
              {(res.options ?? []).map((o) => (
                <button key={o} type="button" disabled={busy} onClick={() => (o === "reject" ? setRejecting(true) : run(lastCode.current, o))}
                  className={`h-14 flex-1 min-w-40 rounded-[12px] text-base font-bold ${o === "reject" ? "border-2 border-bad text-bad bg-white" : o === "exit" ? "bg-ok text-white" : "bg-brand-700 text-white"}`}>
                  {ACTION_BUTTON[o] ?? o}
                </button>
              ))}
            </div>
          )}
          {rejecting && (
            <div className="flex flex-col gap-2 border-t border-line p-4">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus placeholder="Neden geri gönderiyorsunuz? (ör. kenar uyumu, renk)" className="rounded-[10px] border border-[#D5DEE8] px-3 py-2" />
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
                <option value="">İşi en son bitiren teknisyene</option>
                {people.filter((p) => p.role === "technician" || p.role === "chief").map((p) => <option key={p.id} value={p.id}>{p.name} · {FLOW_ROLE[p.role]}</option>)}
              </select>
              <div className="flex gap-2">
                <button type="button" disabled={busy || !reason.trim()} onClick={() => run(lastCode.current, "reject", reason, target || null)} className="h-12 flex-1 rounded-[12px] bg-bad font-bold text-white disabled:opacity-50">Geri gönder</button>
                <button type="button" onClick={() => setRejecting(false)} className="h-12 px-4 rounded-[12px] border border-line font-semibold">Vazgeç</button>
              </div>
            </div>
          )}
          {res.job_id && <div className="border-t border-line px-4 py-2 text-right"><Link href={`/isler/${res.job_id}`} className="text-sm font-semibold text-brand-700">İş kaydını aç →</Link></div>}
        </section>
      )}

      {log.length > 1 && (
        <ul className="divide-y divide-[#EEF2F6] rounded-[12px] border border-line bg-white px-3 text-sm">
          {log.slice(1).map((l, i) => <li key={i} className={`flex gap-3 py-1.5 ${l.ok ? "" : "text-bad"}`}><span className="num text-muted">{l.at}</span>{l.text}</li>)}
        </ul>
      )}
    </div>
  );
}

function actionText(r: FlowResult) {
  switch (r.action) {
    case "take": return "Aldınız ✓";
    case "done": return "Bıraktınız — sıradaki alacak";
    case "approve": return r.stage === "dispatch" ? "Kalite onaylandı ✓" : "Şef onayı verildi ✓";
    case "reject": return "Geri gönderildi";
    case "exit":
    case "exit_force": return "Çıkış yapıldı — hekim carisine işlendi ✓";
    case "tryin_out": return "Provaya gönderildi";
    case "hold": return "Elinizde — karar verin";
    default: return r.action ?? "";
  }
}

type QItem = { code: string; emp: string | null; action: string; reason: string | null; target: string | null; at: number };
function readQ(): QItem[] { try { return JSON.parse(localStorage.getItem("flow-queue") ?? "[]") as QItem[]; } catch { return []; } }
function writeQ(q: QItem[]) { try { localStorage.setItem("flow-queue", JSON.stringify(q.slice(-500))); } catch { /* depolama yok */ } }
