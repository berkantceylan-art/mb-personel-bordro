"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DATASETS, PRESETS, type DsKey, type ReportConfig } from "@/lib/report-defs";
import { runReport, saveReport, type ReportResult } from "@/lib/report-actions";

const COLORS = ["#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED", "#0891B2", "#DB2777", "#65A30D", "#64748B", "#EA580C"];
const fmtN = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

/** Sürükle-bırak gerektirmeyen rapor tasarlayıcı: veri kümesi → kırılım → ölçü → grafik; kaydet / paylaş / CSV */
export function ReportDesigner({ allowed, initial, saved }: { allowed: DsKey[]; initial?: { id: string; name: string; config: ReportConfig; shared: boolean; mine: boolean }; saved?: boolean }) {
  const router = useRouter();
  const first = allowed[0] ?? "jobs";
  const [c, setC] = useState<ReportConfig>(initial?.config ?? { ds: first, date: DATASETS[first].dates[0]![0], preset: "last_12", dim: "month", metric: Object.keys(DATASETS[first].metrics)[0]!, currency: "TRY", chart: "line", top: 15 });
  const [res, setRes] = useState<ReportResult | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [shared, setShared] = useState(initial?.shared ?? false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const def = DATASETS[c.ds];

  const run = (cfg = c) => start(async () => { setMsg(null); setRes(await runReport(cfg)); });
  useEffect(() => { if (initial) run(initial.config); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setDs(ds: DsKey) {
    const d = DATASETS[ds];
    setC({ ...c, ds, date: d.dates[0]![0], dim: "month", dim2: undefined, metric: Object.keys(d.metrics)[0]!, chart: "line" });
    setRes(null);
  }

  const rows = useMemo(() => res?.rows ?? [], [res]);
  const pivot = useMemo(() => {
    if (!c.dim2) return null;
    const cols = [...new Set(rows.map((r) => r.k2 ?? ""))];
    const colTot = new Map(cols.map((k) => [k, rows.filter((r) => r.k2 === k).reduce((a, r) => a + r.v, 0)]));
    cols.sort((a, b) => (colTot.get(b) ?? 0) - (colTot.get(a) ?? 0));
    const keep = cols.slice(0, 8);
    const rk = [...new Set(rows.map((r) => r.k1))];
    return { cols: keep, other: cols.length > 8, rows: rk.map((k1) => ({ k1, vals: keep.map((k2) => rows.find((r) => r.k1 === k1 && r.k2 === k2)?.v ?? 0), rest: rows.filter((r) => r.k1 === k1 && !keep.includes(r.k2 ?? "")).reduce((a, r) => a + r.v, 0) })) };
  }, [rows, c.dim2]);

  function csv() {
    const head = pivot ? [def.dims[c.dim] ?? c.dim, ...pivot.cols, ...(pivot.other ? ["Diğer"] : [])] : [def.dims[c.dim] ?? c.dim, def.metrics[c.metric] ?? c.metric];
    const body = pivot ? pivot.rows.map((r) => [r.k1, ...r.vals, ...(pivot.other ? [r.rest] : [])]) : rows.map((r) => [r.k1, r.v]);
    const text = [head, ...body].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    a.download = `${(name || def.label).replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
    a.click();
  }

  const sel = "h-9 rounded-[8px] border border-line bg-white px-2 text-sm";
  const lab = "text-xs font-semibold text-muted flex flex-col gap-1";
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const isTime = c.dim === "month" || c.dim === "week";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap gap-3 items-end">
        <label className={lab}>Veri<select value={c.ds} onChange={(e) => setDs(e.target.value as DsKey)} className={sel}>{allowed.map((k) => <option key={k} value={k}>{DATASETS[k].label}</option>)}</select></label>
        {def.dates.length > 1 && <label className={lab}>Tarih alanı<select value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} className={sel}>{def.dates.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
        <label className={lab}>Dönem<select value={c.preset} onChange={(e) => setC({ ...c, preset: e.target.value })} className={sel}>{Object.entries(PRESETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {c.preset === "custom" && <><label className={lab}>Başlangıç<input type="date" value={c.from ?? ""} onChange={(e) => setC({ ...c, from: e.target.value })} className={sel} /></label><label className={lab}>Bitiş<input type="date" value={c.to ?? ""} onChange={(e) => setC({ ...c, to: e.target.value })} className={sel} /></label></>}
        <label className={lab}>Kırılım<select value={c.dim} onChange={(e) => setC({ ...c, dim: e.target.value, chart: e.target.value === "month" || e.target.value === "week" ? c.chart === "table" ? "table" : "line" : c.chart === "line" ? "bar" : c.chart })} className={sel}>{Object.entries(def.dims).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={lab}>İkinci kırılım<select value={c.dim2 ?? ""} onChange={(e) => setC({ ...c, dim2: e.target.value || undefined })} className={sel}><option value="">—</option>{Object.entries(def.dims).filter(([k]) => k !== c.dim).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={lab}>Ölçü<select value={c.metric} onChange={(e) => setC({ ...c, metric: e.target.value })} className={sel}>{Object.entries(def.metrics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {def.money && <label className={lab}>Para birimi<select value={c.currency ?? "TRY"} onChange={(e) => setC({ ...c, currency: e.target.value })} className={sel}>{["TRY", "EUR", "USD"].map((x) => <option key={x}>{x}</option>)}</select></label>}
        <label className={lab}>Görünüm<select value={c.chart} onChange={(e) => setC({ ...c, chart: e.target.value as ReportConfig["chart"] })} className={sel}><option value="bar">Çubuk</option><option value="line">Çizgi / sütun (zaman)</option><option value="table">Tablo</option></select></label>
        {!isTime && !c.dim2 && <label className={lab}>İlk<select value={String(c.top ?? 15)} onChange={(e) => setC({ ...c, top: Number(e.target.value) })} className={sel}>{[10, 15, 25, 50, 1000].map((n) => <option key={n} value={n}>{n === 1000 ? "Hepsi" : n}</option>)}</select></label>}
        <button type="button" disabled={pending} onClick={() => run()} className="h-9 px-4 rounded-[8px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">{pending ? "Hesaplanıyor…" : "Raporu çalıştır"}</button>
      </div>

      {res && !res.ok && <p className="text-sm text-bad font-semibold">{res.message}</p>}
      {res?.ok && (
        <div className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <b className="font-display text-lg">{def.label} · {def.metrics[c.metric]} · {def.dims[c.dim]}{c.dim2 ? ` × ${def.dims[c.dim2]}` : ""}</b>
            <span className="text-muted">{res.from} – {res.to} · {res.n} kayıt · toplam <b className="text-ink">{fmtN(res.total ?? 0)}{def.money && ["total", "amount", "subtotal", "vat"].includes(c.metric) ? ` ${c.currency ?? "TRY"}` : ""}</b>{res.truncated ? " · ilk 20.000 kayıt" : ""}</span>
            <button type="button" onClick={csv} className="ml-auto h-8 px-3 rounded-[8px] border border-line text-xs font-semibold">CSV indir</button>
          </div>
          {rows.length === 0 && <p className="text-sm text-muted">Bu dönemde kayıt yok.</p>}
          {rows.length > 0 && c.chart !== "table" && !pivot && (
            isTime || c.chart === "line" ? (
              <svg viewBox={`0 0 ${Math.max(rows.length, 2) * 48 + 40} 220`} className="w-full h-60" role="img" aria-label="Grafik">
                <line x1="30" x2={rows.length * 48 + 40} y1="190" y2="190" stroke="#E1E7EE" />
                {rows.map((r, i) => <g key={r.k1}><rect x={36 + i * 48} y={190 - (Math.max(0, r.v) / max) * 170} width="30" height={(Math.max(0, r.v) / max) * 170} rx="3" fill="#2563EB" opacity="0.85" /><text x={51 + i * 48} y="206" textAnchor="middle" fontSize="10" fill="#64748B">{isTime ? r.k1.slice(2).replace("-", ".") : r.k1.slice(0, 8)}</text><text x={51 + i * 48} y={184 - (Math.max(0, r.v) / max) * 170} textAnchor="middle" fontSize="9" fill="#14202E">{r.v >= 1000 ? `${Math.round(r.v / 100) / 10}b` : fmtN(r.v)}</text></g>)}
              </svg>
            ) : (
              <ul className="flex flex-col gap-1.5">{rows.map((r, i) => <li key={r.k1} className="grid grid-cols-[minmax(120px,240px)_1fr_auto] gap-3 items-center text-sm"><span className="truncate" title={r.k1}>{r.k1}</span><span className="h-5 rounded bg-[#EEF2F6]"><span className="block h-5 rounded" style={{ width: `${(Math.abs(r.v) / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></span><b className="num">{fmtN(r.v)}</b></li>)}</ul>
            )
          )}
          {rows.length > 0 && pivot && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2">{def.dims[c.dim]}</th>{pivot.cols.map((k, i) => <th key={k} className="text-right"><span className="inline-block h-2 w-2 rounded-full mr-1" style={{ background: COLORS[i % COLORS.length] }} />{k}</th>)}{pivot.other && <th className="text-right">Diğer</th>}<th className="text-right">Toplam</th></tr></thead>
                <tbody>{pivot.rows.map((r) => <tr key={r.k1} className="border-t border-[#EEF2F6]"><td className="py-1.5 font-semibold">{r.k1}</td>{r.vals.map((v, i) => <td key={i} className="text-right num">{v ? fmtN(v) : ""}</td>)}{pivot.other && <td className="text-right num">{r.rest ? fmtN(r.rest) : ""}</td>}<td className="text-right num font-bold">{fmtN(r.vals.reduce((a, b) => a + b, 0) + r.rest)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && c.chart === "table" && !pivot && (
            <table className="w-full text-sm"><tbody>{rows.map((r) => <tr key={r.k1} className="border-t border-[#EEF2F6]"><td className="py-1.5">{r.k1}</td><td className="text-right num font-semibold">{fmtN(r.v)}</td><td className="text-right text-xs text-muted w-16">{res.total ? `%${Math.round((r.v / res.total) * 100)}` : ""}</td></tr>)}</tbody></table>
          )}
          <div className="flex flex-wrap gap-2 items-center border-t border-line pt-3">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Rapor adı" className="h-9 w-64 rounded-[8px] border border-line px-2 text-sm" />
            <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Şirkette paylaş</label>
            <button type="button" disabled={pending || (initial && !initial.mine)} onClick={() => start(async () => { const r = await saveReport({ id: initial?.mine ? initial.id : undefined, name: name || def.label, config: c, shared }); setMsg(r.message); if (r.ok && r.id && !initial) router.push(`/rapor-tasarla?r=${r.id}`); })} className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold disabled:opacity-50">{initial?.mine ? "Güncelle" : "Kaydet"}</button>
            {initial?.mine && saved && <button type="button" onClick={() => confirm("Rapor silinsin mi?") && start(async () => { await saveReport({ id: initial.id, name, config: c, shared, delete: true }); router.push("/rapor-tasarla"); })} className="h-9 px-3 text-sm font-semibold text-bad">Sil</button>}
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
