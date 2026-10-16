"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FLOW_STAGE } from "@/lib/flow";
import { stepDone } from "@/lib/prova-actions";

export type PEntry = { key: string; type: "prova" | "teslim"; label: string; date: string; back: string | null; time: string | null; method: string | null; jobId: string; no: number; patient: string | null; doctor: string | null;
  customerId: string; customer: string; stage: string; status: string; postponed: number; stepId?: string };

const ORDER = ["reception", "production", "chief", "qc", "dispatch", "out"];
const READY = new Set(["dispatch", "out"]);
const fmt = (d: string) => d.split("-").reverse().join(".");
const DAY = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Hazırlık: üretim akışındaki yerine göre risk */
function risk(e: PEntry, today: string): "late" | "risk" | "ok" | "ready" {
  if (READY.has(e.stage) || e.status === "ready") return "ready";
  if (e.date < today) return "late";
  if (e.date === today && ["reception", "production"].includes(e.stage)) return "risk";
  return "ok";
}
const RISK: Record<string, [string, string]> = { late: ["Gecikmiş", "bg-bad-bg text-bad"], risk: ["Risk: hâlâ üretimde", "bg-warn-bg text-warn"], ok: ["Yolunda", "bg-[#EEF2F6] text-muted"], ready: ["Hazır", "bg-ok-bg text-ok"] };

function Stage({ stage }: { stage: string }) {
  const i = Math.max(0, ORDER.indexOf(stage === "tryin" ? "out" : stage));
  const [label, color] = FLOW_STAGE[stage] ?? [stage, "#64748B"];
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="flex gap-0.5">{ORDER.slice(0, 5).map((s, k) => <span key={s} className="w-2.5 h-1.5 rounded-sm" style={{ background: k <= i ? color : "#E2E8F0" }} />)}</span>
      <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
    </span>
  );
}

export function ProvaBoard({ today, entries, atDoctor }: { today: string; entries: PEntry[]; atDoctor: { id: string; no: number; patient: string | null; customer: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"all" | "prova" | "teslim">("all");
  const [view, setView] = useState<"gun" | "hekim">("gun");
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [method, setMethod] = useState("");
  const [q, setQ] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  const all = useMemo(() => entries.filter((e) => !doneKeys.has(e.key)).sort((a, b) => (a.date + (a.time ?? "99")).localeCompare(b.date + (b.time ?? "99"))), [entries, doneKeys]);
  const methods = useMemo(() => [...new Set(all.map((e) => e.method).filter(Boolean))] as string[], [all]);
  const shown = all.filter((e) => (type === "all" || e.type === type) && (!method || e.method === method) && (!onlyRisk || ["late", "risk"].includes(risk(e, today)))
    && (!day || (day === "late" ? e.date < today : e.date === day)) && (!q.trim() || `${e.no} ${e.customer} ${e.patient ?? ""} ${e.doctor ?? ""}`.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr"))));
  const cnt = (f: (e: PEntry) => boolean) => all.filter(f).length;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const kpis: [string, number, string, () => void][] = [
    ["Gecikmiş", cnt((e) => e.date < today), "text-bad", () => { setDay("late"); setOnlyRisk(false); }],
    ["Bugün", cnt((e) => e.date === today), "text-brand-700", () => setDay(today)],
    ["Bugün riskli", cnt((e) => risk(e, today) === "risk"), "text-warn", () => { setDay(null); setOnlyRisk(true); }],
    ["Bugün hazır", cnt((e) => e.date <= today && risk(e, today) === "ready"), "text-ok", () => setDay(today)],
    ["Yarın", cnt((e) => e.date === tomorrow), "text-ink", () => setDay(tomorrow)],
    ["Hekimde provada", atDoctor.length, "text-[#D97706]", () => document.getElementById("hekimde")?.scrollIntoView({ behavior: "smooth" })],
  ];
  const dayList = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) { const k = e.date < today ? "late" : e.date; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => (a[0] === "late" ? "0" : a[0]).localeCompare(b[0] === "late" ? "0" : b[0]));
  }, [all, today]);
  const groups = useMemo(() => {
    const m = new Map<string, PEntry[]>();
    for (const e of shown) { const k = view === "gun" ? (e.date < today ? "late" : e.date) : e.customer; m.set(k, [...(m.get(k) ?? []), e]); }
    const arr = [...m.entries()];
    return view === "gun" ? arr.sort((a, b) => (a[0] === "late" ? "0" : a[0]).localeCompare(b[0] === "late" ? "0" : b[0])) : arr.sort((a, b) => b[1].length - a[1].length);
  }, [shown, view, today]);
  const title = (g: string) => (view === "hekim" ? g : g === "late" ? "Gecikmiş" : g === today ? `Bugün · ${fmt(g)}` : `${DAY[new Date(`${g}T12:00:00Z`).getUTCDay()]} · ${fmt(g)}`);

  async function complete(e: PEntry) {
    if (!e.stepId) return;
    setBusy(e.key);
    const r = await stepDone(e.stepId).catch(() => ({ ok: false }));
    setBusy(null);
    if (r.ok) { setDoneKeys((x) => new Set(x).add(e.key)); router.refresh(); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([l, n, c, go]) => (
          <button key={l} type="button" onClick={go} className="rounded-[16px] border border-line bg-white p-3 text-left hover:border-brand-600">
            <div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-3xl font-bold ${c}`}>{n}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button type="button" onClick={() => setDay(null)} className={`shrink-0 h-14 px-3 rounded-xl border text-xs font-semibold ${!day ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>Hepsi<div className="text-base">{all.length}</div></button>
        {dayList.map(([d, n]) => (
          <button key={d} type="button" onClick={() => setDay(day === d ? null : d)} className={`shrink-0 h-14 min-w-16 px-3 rounded-xl border text-xs font-semibold ${day === d ? "bg-brand-700 text-white border-brand-700" : d === "late" ? "bg-bad-bg text-bad border-bad/30" : d === today ? "bg-[#EEF4FB] border-brand-600" : "bg-white border-line"}`}>
            {d === "late" ? "Gecikmiş" : d === today ? "Bugün" : `${DAY[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}`}<div className="text-base">{n}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-white p-3 print:hidden">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İş no, hekim, hasta ara" className="h-10 w-56 rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
        {([["all", "Hepsi"], ["teslim", "Teslim"], ["prova", "Prova"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setType(k)} className={`h-9 px-3 rounded-full text-xs font-semibold ${type === k ? "bg-brand-700 text-white" : "border border-line text-brand-700"}`}>{l}</button>)}
        {methods.length > 0 && <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2 text-sm"><option value="">Tüm teslim şekilleri</option>{methods.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} className="w-4 h-4" />Yalnız gecikmiş / riskli</label>
        <span className="ml-auto flex gap-1">
          {([["gun", "Güne göre"], ["hekim", "Hekime göre"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`h-9 px-3 rounded-full text-xs font-semibold ${view === k ? "bg-brand-700 text-white" : "border border-line text-brand-700"}`}>{l}</button>)}
          <button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-full text-xs font-semibold border border-line text-brand-700">🖨 Listeyi yazdır</button>
        </span>
      </div>

      {groups.map(([g, list]) => {
        const ready = list.filter((e) => risk(e, today) === "ready").length;
        return (
          <section key={g} className="flex flex-col gap-2 break-inside-avoid">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className={`font-display text-lg font-bold ${g === "late" ? "text-bad" : "text-brand-800"}`}>{title(g)}</h2>
              <span className="text-sm text-muted">{list.length} kayıt · {ready} hazır</span>
              <span className="flex-1 max-w-48 h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><span className="block h-2 bg-ok" style={{ width: `${(ready / Math.max(1, list.length)) * 100}%` }} /></span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {list.map((e) => {
                const r = risk(e, today);
                return (
                  <li key={e.key} className={`rounded-xl border bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 ${r === "late" ? "border-bad/40" : r === "risk" ? "border-warn/50" : "border-line"}`}>
                    <span className="tabular-nums text-sm text-muted w-12">{e.time ?? (view === "hekim" ? fmt(e.date).slice(0, 5) : "")}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${e.type === "teslim" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{e.label}</span>
                    <Link href={`/isler/${e.jobId}`} className="font-bold text-brand-700">#{e.no}</Link>
                    {view === "gun" && <span className="font-semibold">{e.customer}</span>}
                    <span className="text-muted">{e.patient ?? ""}{e.doctor ? ` · Dr. ${e.doctor}` : ""}</span>
                    {e.method && <span className="text-xs text-muted">🚚 {e.method}</span>}
                    {e.back && <span className="text-xs text-muted">↩ dönüş {fmt(e.back)}</span>}
                    {e.postponed > 0 && <span className="text-[11px] font-semibold rounded-full bg-[#FFEDD5] text-[#9A3412] px-2 py-0.5">↻ {e.postponed}</span>}
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      <Stage stage={e.stage} />
                      <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${RISK[r]![1]}`}>{RISK[r]![0]}</span>
                      <Link href={`/yazdir/is/${e.jobId}`} target="_blank" className="h-8 px-2.5 inline-flex items-center rounded-[10px] border border-line text-xs font-semibold print:hidden">İş emri</Link>
                      {(r === "late" || e.date === today) && <Link href={`/isler/ertele?is=${e.jobId}`} className="h-8 px-2.5 inline-flex items-center rounded-[10px] border border-[#F2C38B] bg-[#FFF7ED] text-xs font-semibold text-[#9A3412] print:hidden">⏭ Ertele</Link>}
                      {e.stepId && <button type="button" disabled={busy === e.key} onClick={() => complete(e)} className="h-8 px-2.5 rounded-[10px] border border-ok text-xs font-semibold text-ok disabled:opacity-50 print:hidden">{busy === e.key ? "…" : "✓ Tamamlandı"}</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="rounded-[16px] border border-dashed border-[#C5D0DB] p-8 text-center text-muted">Filtreye uyan prova ya da teslim yok.</p>}

      {atDoctor.length > 0 && (
        <section id="hekimde" className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Hekimde provada bekleyenler ({atDoctor.length})</h2>
          <p className="text-xs text-muted">Provaya gönderilmiş, henüz laboratuvara dönmemiş işler.</p>
          <ul className="flex flex-wrap gap-2">{atDoctor.map((j) => <li key={j.id}><Link href={`/isler/${j.id}`} className="inline-flex gap-1.5 rounded-full border border-line px-3 py-1 text-xs"><b>#{j.no}</b>{j.customer}{j.patient ? <span className="text-muted">· {j.patient}</span> : null}</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
