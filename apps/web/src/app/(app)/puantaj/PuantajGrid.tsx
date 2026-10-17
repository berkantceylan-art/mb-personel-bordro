"use client";
import { useMemo, useState } from "react";

export type GridDay = { d: string; n: number; wd: string; off: boolean; holiday: string | null };
export type GridCell = { t: string; c: string; h: string };
export type GridRow = { id: string; name: string; card: string | null; dept: string; cells: GridCell[]; worked: number; hours: string; absent: number; late: number; ot: string };

const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** Aylık puantaj tablosu: personel araması ve bölüm süzmesi sayfa yenilemeden çalışır */
export function PuantajGrid({ days, rows, depts, initialDept }: { days: GridDay[]; rows: GridRow[]; depts: string[]; initialDept: string }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState(initialDept);
  const shown = useMemo(() => {
    const t = norm(q.trim());
    return rows.filter((r) => (!dept || r.dept === dept) && (!t || norm(`${r.name} ${r.card ?? ""}`).includes(t)));
  }, [rows, q, dept]);
  let lastDept = "";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} list="pnt-names" autoComplete="off" placeholder="Personel ara (isim ya da PDKS no)" className="h-11 w-72 rounded-[10px] border border-[#D5DEE8] bg-white px-3" />
        <datalist id="pnt-names">{rows.map((r) => <option key={r.id} value={r.name} />)}</datalist>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
          <option value="">Tüm bölümler</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {(q || dept) && <button type="button" onClick={() => { setQ(""); setDept(""); }} className="text-sm font-semibold text-muted">Temizle</button>}
        <span className="ml-auto text-sm text-muted">{shown.length} / {rows.length} personel</span>
      </div>
      <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left py-2 px-3 font-semibold text-muted border-b border-line min-w-44">Personel</th>
              {days.map((d) => (
                <th key={d.d} className={`py-2 px-0.5 font-semibold border-b border-line text-center min-w-9 ${d.off ? "text-warn" : "text-[#33414F]"}`} title={d.holiday ?? undefined}>
                  <span className="block num">{d.n}</span>
                  <span className="font-normal">{d.wd}</span>
                </th>
              ))}
              <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Gün</th>
              <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Saat</th>
              <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Devams.</th>
              <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Geç</th>
              <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted" title="Vardiya süresini aşan çalışma. Ödenecek fazla mesai (haftalık 45 saat esası) Fazla mesai sayfasında hesaplanır.">Aşım sa</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const header = r.dept !== lastDept;
              lastDept = r.dept;
              return [
                header && <tr key={`h-${r.dept}`}><td colSpan={days.length + 6} className="sticky left-0 py-1.5 px-3 bg-[#F3F6F9] font-bold uppercase tracking-wider text-[#33414F]">{r.dept}</td></tr>,
                <tr key={r.id}>
                  <td className="sticky left-0 z-10 bg-white py-1 px-3 border-b border-[#EEF2F6]">
                    <a href={`/personel/${r.id}`} className="font-semibold text-brand-700 text-[13px]">{r.name}</a>
                    <span className="block num text-muted">{r.card ?? "PDKS no yok"}</span>
                  </td>
                  {r.cells.map((c, k) => (
                    <td key={k} className="p-0.5 border-b border-[#EEF2F6]">
                      <a href={`/puantaj/${r.id}/${days[k]!.d}`} title={c.h} className={`num flex items-center justify-center h-8 rounded ${c.c}`}>{c.t}</a>
                    </td>
                  ))}
                  <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{r.worked}</td>
                  <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{r.hours}</td>
                  <td className={`num py-1 px-2 border-b border-[#EEF2F6] text-right ${r.absent ? "text-bad font-semibold" : ""}`}>{r.absent}</td>
                  <td className={`num py-1 px-2 border-b border-[#EEF2F6] text-right ${r.late ? "text-warn font-semibold" : ""}`}>{r.late}</td>
                  <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{r.ot}</td>
                </tr>,
              ];
            })}
            {!shown.length && <tr><td colSpan={days.length + 6} className="p-6 text-center text-muted">Aramaya uyan personel yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
