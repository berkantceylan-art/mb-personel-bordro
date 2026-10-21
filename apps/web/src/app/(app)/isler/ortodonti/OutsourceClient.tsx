"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { jobIdsByNo, outsourceReceive, outsourceSend, outsourceUndo, setOutsourceLab } from "@/lib/outsource-actions";

type Row = { id: string; no: number; date: string; due: string; customer: string; doctor: string; patient: string; items: string; party: string };
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-bold disabled:opacity-40";

/** Gönderilecek işler: seç → "Ortodontiye gitti" → yazdırılacak günlük liste */
export function OutsourceSend({ labs, rows }: { labs: { id: string; name: string }[]; rows: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(rows.map((r) => r.id)));
  const [lab, setLab] = useState(labs[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string; batch?: string | null } | null>(null);
  const [extra, setExtra] = useState("");
  // laba göre süz: varsayılanı seçili laba ait olanlar önce, istenirse hepsi
  const [allLabs, setAllLabs] = useState(false);
  const list = rows.filter((r) => allLabs || !lab || labs.length < 2 || r.party === lab);
  const labName = new Map(labs.map((l) => [l.id, l.name]));
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  async function send(ids: string[]) {
    setBusy(true); setMsg(null);
    const r = await outsourceSend(ids, lab, note);
    setMsg(r); setBusy(false);
    if (r.ok) { setNote(""); setExtra(""); router.refresh(); }
  }
  return (
    <div className="flex flex-col gap-3">
      {list.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2"><input type="checkbox" checked={list.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(list.map((r) => r.id)) : new Set())} /></th><th className="py-2 px-2">İş</th><th className="py-2 px-2">Kayıt</th><th className="py-2 px-2">Hekim</th><th className="py-2 px-2">Hasta</th><th className="py-2 px-2">Ürün</th>{labs.length > 1 && <th className="py-2 px-2">Varsayılan lab</th>}<th className="py-2 px-2">Teslim</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-[#EEF2F6]">
                  <td className="py-2 px-2"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="py-2 px-2"><Link href={`/isler/${r.id}`} className="font-semibold text-brand-700">#{r.no}</Link></td>
                  <td className="py-2 px-2">{r.date}</td>
                  <td className="py-2 px-2">{r.customer}{r.doctor && r.doctor !== r.customer ? <span className="block text-xs text-muted">{r.doctor}</span> : null}</td>
                  <td className="py-2 px-2">{r.patient}</td>
                  <td className="py-2 px-2 text-xs">{r.items}</td>
                  {labs.length > 1 && <td className="py-2 px-2 text-xs">{labName.get(r.party) ?? ""}</td>}
                  <td className="py-2 px-2">{r.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted">Gönderilecek iş yok. Ortodonti ürünlerine Ürünler ekranında &quot;Dışarıda yapılır&quot; seçilirse kayıtlı işler buraya kendiliğinden düşer.</p>}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {labs.length > 1 && <label className="flex items-center gap-2 h-10"><input type="checkbox" checked={allLabs} onChange={(e) => setAllLabs(e.target.checked)} /> Başka laba ayrılmış işleri de göster</label>}
        {labs.length > 1 && <label className="flex flex-col gap-1 font-semibold">Gönderilecek laboratuvar<select value={lab} onChange={(e) => setLab(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2 font-normal">{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
        <label className="flex flex-col gap-1 font-semibold flex-1 min-w-[200px]">Not (listeye yazılır)<input value={note} onChange={(e) => setNote(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
        <button type="button" disabled={busy || !list.some((r) => sel.has(r.id))} onClick={() => send(list.filter((r) => sel.has(r.id)).map((r) => r.id))} className={btn}>{busy ? "…" : `Ortodontiye gitti (${list.filter((r) => sel.has(r.id)).length})`}</button>
      </div>
      <details className="text-sm"><summary className="cursor-pointer font-semibold text-brand-700">Listede olmayan bir işi gönder</summary>
        <form className="flex flex-wrap gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); const nos = extra.split(/[\s,;]+/).filter(Boolean); if (!nos.length) return; const ids = await jobIdsByNo(nos); if (!ids.length) { setMsg({ ok: false, message: "İş numarası bulunamadı." }); return; } await send(ids); }}>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="İş numaraları (boşluk / virgülle)" className="h-10 flex-1 min-w-[220px] rounded-[10px] border border-[#D5DEE8] px-3" />
          <button disabled={busy} className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] text-brand-700 font-semibold">Gönder</button>
        </form>
      </details>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}{msg.batch && <> · <Link href={`/yazdir/ortodonti/${msg.batch}`} className="underline">Listeyi yazdır</Link></>}</p>}
    </div>
  );
}

/** İş geldi: iş no / barkod okut, Enter */
export function OutsourceReceive() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState("");
  const [log, setLog] = useState<{ ok: boolean; message: string; job?: number; jobId?: string; patient?: string | null; customer?: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await outsourceReceive(code, problem, note);
    setLog([r, ...log].slice(0, 30)); setCode(""); setBusy(false);
    if (problem) { setProblem(false); setNote(""); }
    ref.current?.focus();
    if (r.ok) router.refresh();
  }
  return (
    <div className="flex flex-col gap-2">
      <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label className="flex flex-col gap-1 font-semibold">İş no / barkod<input ref={ref} autoFocus value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="Okutun ya da yazıp Enter" className="h-11 w-[240px] rounded-[10px] border border-[#D5DEE8] px-3 text-base font-normal" /></label>
        <label className="flex items-center gap-2 h-11"><input type="checkbox" checked={problem} onChange={(e) => setProblem(e.target.checked)} /> Sorunlu geldi</label>
        {problem && <label className="flex flex-col gap-1 font-semibold flex-1 min-w-[200px]">Sorun<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="kırık, uyumsuz, eksik…" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>}
        <button disabled={busy || !code.trim()} className={`${btn} h-11`}>{busy ? "…" : "İş geldi"}</button>
      </form>
      {log.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {log.map((l, i) => <li key={i} className={l.ok ? "text-ok" : "text-bad"}>{l.job ? <Link href={`/isler/${l.jobId}`} className="font-semibold underline">#{l.job}</Link> : null} {l.customer ?? ""} {l.patient ? `· ${l.patient}` : ""} — {l.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export function UndoButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} onClick={async () => { setBusy(true); await outsourceUndo(id); setBusy(false); router.refresh(); }} className="text-xs text-muted underline">geri al</button>;
}

export function LabPicker({ parties }: { parties: { id: string; name: string }[] }) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-3 items-center text-sm">
      <select value={id} onChange={(e) => setId(e.target.value)} className="h-10 min-w-[280px] rounded-[10px] border border-[#D5DEE8] px-2"><option value="">— cari seçin —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button type="button" disabled={!id} onClick={async () => { const r = await setOutsourceLab(id, true); setMsg(r.message); if (r.ok) router.refresh(); }} className={btn}>Dış laboratuvar yap</button>
      {msg && <span className="font-semibold">{msg}</span>}
    </div>
  );
}

/** İş kartında: dış laba gönder / iş geldi */
export function JobOutsourceButtons({ jobId, jobNo, openId, sentDays, labs }: { jobId: string; jobNo: number; openId: string | null; sentDays: number | null; labs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lab, setLab] = useState(labs[0]?.id ?? "");
  if (openId) return (
    <span className="flex items-center gap-2">
      <Link href="/isler/ortodonti" className="text-xs font-semibold rounded-full bg-[#EDE9FE] text-[#5B21B6] px-2 py-1">Dış labda · {sentDays} gün</Link>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await outsourceReceive(String(jobNo), false, ""); setMsg(r.ok ? null : r.message); setBusy(false); router.refresh(); }} className="h-10 px-3 rounded-[10px] bg-[#5B21B6] text-white text-sm font-semibold">İş geldi</button>
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </span>
  );
  if (!labs.length) return null;
  return (
    <span className="flex items-center gap-1">
      {labs.length > 1 && <select value={lab} onChange={(e) => setLab(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2 text-sm">{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await outsourceSend([jobId], lab, ""); setMsg(r.ok ? null : r.message); setBusy(false); router.refresh(); }} className="h-10 px-3 rounded-[10px] border border-[#C4B5FD] bg-white text-sm font-semibold text-[#5B21B6]">{labs.length > 1 ? "Dış laba gönder" : `${labs[0]!.name.split(" ")[0]}'ya gönder`}</button>
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </span>
  );
}
