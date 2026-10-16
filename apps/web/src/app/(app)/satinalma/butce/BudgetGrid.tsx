"use client";
import { useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { saveBudget } from "@/lib/purchasing3-actions";
import { MONTHS } from "@/lib/purchasing3";

type Row = { id: string; name: string; kind: string; months: number[]; used: boolean };

const fmt = (kurus: number) => (kurus ? String(Math.round(kurus / 100)) : "");
const num = (v: string) => {
  let t = v.trim().replace(/\s|TL|₺/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Bütçe ızgarası: gider türü × 12 ay (TL, KDV hariç) */
export function BudgetGrid({ year, rows }: { year: number; rows: Row[] }) {
  const [vals, setVals] = useState<Record<string, string[]>>(() => Object.fromEntries(rows.map((r) => [r.id, r.months.map(fmt)])));
  const [all, setAll] = useState(false);
  const shown = rows.filter((r) => all || r.used || r.months.some((m) => m > 0));
  const set = (id: string, i: number, v: string) => setVals((p) => ({ ...p, [id]: p[id].map((x, j) => (j === i ? v : x)) }));
  const spread = (id: string) => {
    const yearly = num(window.prompt("Yıllık tutar (TL) — 12 aya eşit dağıtılır") ?? "");
    if (!yearly) return;
    const m = Math.round(yearly / 12);
    setVals((p) => ({ ...p, [id]: Array(12).fill(String(m)) }));
  };
  const copyFirst = (id: string) => setVals((p) => ({ ...p, [id]: Array(12).fill(p[id][0] ?? "") }));
  const total = (id: string) => (vals[id] ?? []).reduce((a, v) => a + num(v), 0);
  const grand = shown.reduce((a, r) => a + total(r.id), 0);

  return (
    <form action={saveBudget} className="rounded-[16px] border border-line bg-white flex flex-col">
      <input type="hidden" name="year" value={year} />
      {/* Gizli satırlar da gönderilsin ki silinmesinler */}
      {rows.filter((r) => !shown.includes(r)).flatMap((r) => (vals[r.id] ?? []).map((v, i) => <input key={`${r.id}${i}`} type="hidden" name={`b_${r.id}_${i + 1}`} value={v} />))}
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-line">
        <h2 className="font-display font-bold text-brand-800">{year} bütçesi</h2>
        <span className="text-xs text-muted">TL, KDV hariç. Boş bırakılan ay bütçesiz sayılır.</span>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm gider türlerini göster</label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px]">
          <thead><tr className="text-left text-xs text-muted"><th className="p-2 pl-4 w-56">Gider türü</th>{MONTHS.map((m) => <th key={m} className="p-1 text-center">{m}</th>)}<th className="p-2 text-right">Yıllık</th><th className="p-2" /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-[#EEF2F6]">
                <td className="p-2 pl-4 font-semibold">{r.name}{r.kind === "stock" && <span className="block text-[11px] font-normal text-muted">stoklu malzeme alışı</span>}</td>
                {(vals[r.id] ?? []).map((v, i) => (
                  <td key={i} className="p-1"><input name={`b_${r.id}_${i + 1}`} value={v} onChange={(e) => set(r.id, i, e.target.value)} inputMode="decimal" className="h-9 w-full min-w-[72px] rounded-md border border-[#D5DEE8] px-1.5 text-right tabular-nums" /></td>
                ))}
                <td className="p-2 text-right tabular-nums font-semibold whitespace-nowrap">{total(r.id).toLocaleString("tr-TR")} ₺</td>
                <td className="p-2 whitespace-nowrap text-xs">
                  <button type="button" onClick={() => spread(r.id)} className="font-semibold text-brand-700">Yıllığı dağıt</button>
                  <span className="text-muted"> · </span>
                  <button type="button" onClick={() => copyFirst(r.id)} className="font-semibold text-brand-700" title="Ocak tutarını tüm aylara kopyala">Ocak→hepsi</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={15} className="p-6 text-center text-muted">Henüz bütçe yok. &quot;Tüm gider türlerini göster&quot; ile başlayın.</td></tr>}
          </tbody>
          <tfoot><tr className="border-t border-line"><td className="p-2 pl-4 font-bold">Toplam</td><td colSpan={12} /><td className="p-2 text-right tabular-nums font-bold whitespace-nowrap">{grand.toLocaleString("tr-TR")} ₺</td><td /></tr></tfoot>
        </table>
      </div>
      <div className="p-4 border-t border-line flex justify-end">
        <PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Bütçeyi kaydet</PendingSubmit>
      </div>
    </form>
  );
}
