"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export type RevCustomer = {
  id: string; name: string; kind: string; city: string | null; country: string | null; currency: string;
  jobs: number; units: number; revenue: number; try: number; prev_try: number; last: string | null; collected: number; new: boolean; spark: number[] | null;
};

const KIND: Record<string, [string, string]> = {
  doctor_tr: ["Hekim", "#3B82F6"], doctor_foreign: ["Yurt dışı hekim", "#8B5CF6"], clinic: ["Klinik", "#10B981"], hospital: ["Hastane", "#F59E0B"], agency: ["Aracı kurum", "#EC4899"],
};
const CUR: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };
const fmt = (v: number, c = "TRY") => `${(v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CUR[c] ?? c}`;
const dt = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");
type Sort = "try" | "change" | "jobs" | "collected" | "name";

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 80).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join(" ");
  return <svg viewBox="0 0 80 24" className="w-20 h-6" aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}

/** Müşteri bazında ciro sıralaması: arama, sıralama, pay çubuğu, eğilim, CSV */
export function RevenueTable({ rows, total, bucket, from, to }: { rows: RevCustomer[]; total: number; bucket: string; from: string; to: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("try");
  const [all, setAll] = useState(false);
  const nq = q.toLocaleLowerCase("tr").trim();
  const list = useMemo(() => {
    const ch = (r: RevCustomer) => (r.prev_try ? (r.try - r.prev_try) / r.prev_try : r.try ? 9e9 : 0);
    const f = rows.filter((r) => !nq || `${r.name} ${r.city ?? ""} ${r.country ?? ""} ${KIND[r.kind]?.[0] ?? ""}`.toLocaleLowerCase("tr").includes(nq));
    const s = [...f].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "tr") : sort === "change" ? ch(b) - ch(a) : sort === "jobs" ? b.jobs - a.jobs : sort === "collected" ? b.collected - a.collected : b.try - a.try);
    return s;
  }, [rows, nq, sort]);
  const shown = all ? list : list.slice(0, 50);
  const rank = new Map(rows.map((r, i) => [r.id, i + 1]));

  const csv = () => {
    const head = ["Sıra", "Müşteri", "Tür", "Şehir", "Ülke", "İş", "Birim", "Ciro (TL)", "Ciro (para birimi)", "Para birimi", "Önceki dönem (TL)", "Değişim %", "Tahsilat (TL)", "Son iş"];
    const lines = list.map((r) => [rank.get(r.id), r.name, KIND[r.kind]?.[0] ?? r.kind, r.city ?? "", r.country ?? "", r.jobs, r.units, (r.try / 100).toFixed(2).replace(".", ","), (r.revenue / 100).toFixed(2).replace(".", ","), r.currency, (r.prev_try / 100).toFixed(2).replace(".", ","), r.prev_try ? (((r.try - r.prev_try) / r.prev_try) * 100).toFixed(1).replace(".", ",") : "", (r.collected / 100).toFixed(2).replace(".", ","), dt(r.last)]);
    const body = [head, ...lines].map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `musteri-cirolari-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const th = (k: Sort, l: string, right = true) => (
    <th className={`p-3 ${right ? "text-right" : ""}`}><button type="button" onClick={() => setSort(k)} className={`font-semibold ${sort === k ? "text-brand-700" : ""}`}>{l}{sort === k ? " ↓" : ""}</button></th>
  );

  return (
    <section className="bg-white border border-line rounded-[16px] overflow-hidden">
      <div className="p-4 flex flex-wrap items-center gap-2 border-b border-line">
        <h2 className="font-display font-semibold text-brand-800 mr-auto">Müşteri sıralaması <span className="text-sm text-muted font-normal">· {rows.length} müşteri</span></h2>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri, şehir, ülke ara" aria-label="Müşteri ara" className="h-9 rounded-lg border border-[#D5DEE8] px-3 text-sm w-56" />
        <button type="button" onClick={csv} className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-sm font-semibold">⬇ Excel (CSV)</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]">
            <th className="p-3 w-10">#</th>{th("name", "Müşteri", false)}<th className="p-3">Pay</th>{th("try", "Ciro")}{th("change", "Değişim")}{th("jobs", "İş")}{th("collected", "Tahsilat")}<th className="p-3">Eğilim ({bucket === "day" ? "gün" : bucket === "month" ? "ay" : "yıl"})</th><th className="p-3">Son iş</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const share = total ? (r.try / total) * 100 : 0;
              const ch = r.prev_try ? Math.round(((r.try - r.prev_try) / r.prev_try) * 1000) / 10 : null;
              const col = KIND[r.kind]?.[1] ?? "#94A3B8";
              return (
                <tr key={r.id} className="border-t border-[#EEF2F6] hover:bg-[#FAFBFD]">
                  <td className="p-3 num text-muted">{rank.get(r.id)}</td>
                  <td className="p-3">
                    <Link href={`/isler/hekimler/${r.id}`} className="font-semibold text-brand-800 hover:underline">{r.name}</Link>
                    {r.new && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-ok-bg text-ok">YENİ</span>}
                    <span className="block text-xs text-muted"><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: col }} />{KIND[r.kind]?.[0] ?? r.kind}{r.city ? ` · ${r.city}` : ""}{r.country && r.country !== "TR" ? ` · ${r.country}` : ""}</span>
                  </td>
                  <td className="p-3 w-36"><div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, share)}%`, background: col }} /></div><span className="text-[11px] text-muted">%{share.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</span></td>
                  <td className="p-3 text-right"><b className="num">{fmt(r.try)}</b>{r.currency !== "TRY" && <span className="block text-[11px] text-muted num">{fmt(r.revenue, r.currency)}</span>}</td>
                  <td className="p-3 text-right">{ch === null ? <span className="text-xs text-muted">—</span> : <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${ch >= 0 ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{ch >= 0 ? "▲" : "▼"} %{Math.abs(ch).toLocaleString("tr-TR")}</span>}</td>
                  <td className="p-3 text-right num">{r.jobs}<span className="block text-[11px] text-muted">{r.units} birim</span></td>
                  <td className="p-3 text-right num">{r.collected ? fmt(r.collected) : <span className="text-muted">—</span>}</td>
                  <td className="p-3"><Spark data={r.spark ?? []} color={col} /></td>
                  <td className="p-3 num text-muted">{dt(r.last)}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9} className="p-8 text-center text-muted">Bu aralıkta ciro yapan müşteri yok.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 50 && !all && <button type="button" onClick={() => setAll(true)} className="w-full py-3 text-sm font-semibold text-brand-700 border-t border-line">Tümünü göster ({list.length})</button>}
    </section>
  );
}
