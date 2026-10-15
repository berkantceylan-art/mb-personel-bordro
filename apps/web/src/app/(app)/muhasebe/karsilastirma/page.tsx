import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnSecondary, inputCls, page, td, th } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { comparePeriods, isLines, isValue, pctChange, type IsRow } from "@/lib/gl-reports";

export const dynamic = "force-dynamic";

const m = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`);

/** Karşılaştırmalı gelir tablosu: bu ay, önceki ay, geçen yıl aynı ay, yıl başından, geçen yıl aynı dönem */
export default async function Compare({ searchParams }: { searchParams: Promise<{ ay?: string; detay?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : null;
  if (!month) {
    const { data: wm } = await supabase.rpc("gl_working_month");
    month = typeof wm === "string" ? wm : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);
  }
  const ps = comparePeriods(month);
  const res = await Promise.all(ps.map((p) => supabase.rpc("gl_income_statement", { p_from: p.from, p_to: p.to })));
  const error = res.find((r) => r.error)?.error;
  const sets = res.map((r) => (r.data ?? []) as IsRow[]);
  const detail = sp.detay === "1";
  const lines = isLines(sets).filter((l) => detail || l.kind !== "line");
  const strong = (k: string) => (k === "total" ? "font-bold bg-[#F7F9FB]" : k === "section" ? "font-semibold" : "text-[13px]");
  return (
    <>
      <PageHeader title="Karşılaştırmalı raporlar" subtitle={`${month} · gelir tablosu beş dönem yan yana`} actions={<span className="flex gap-4"><Link href="/muhasebe/nakit-akis" className="text-sm font-semibold text-brand-700">Nakit akış</Link><Link href={`/muhasebe/paket?ay=${month}`} className="text-sm font-semibold text-brand-700">Müşavir paketi</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">{error.message}</Notice>}
        <form className="flex flex-wrap gap-2 items-center"><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} />
          <label className="text-sm flex items-center gap-2"><input type="checkbox" name="detay" value="1" defaultChecked={detail} />Hesap ayrıntısı</label>
          <button className={btnSecondary}>Göster</button></form>
        <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr><th className={th}>Kalem</th>{ps.map((p) => <th key={p.key} className={`${th} text-right`}>{p.label}<div className="text-[11px] font-normal text-muted">{p.from.slice(0, 7)}{p.from.slice(0, 7) !== p.to.slice(0, 7) ? ` – ${p.to.slice(0, 7)}` : ""}</div></th>)}<th className={`${th} text-right`}>Ay / önceki ay</th><th className={`${th} text-right`}>Yıl / geçen yıl</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const v = sets.map((rows) => isValue(rows, l));
                return (
                  <tr key={i} className={strong(l.kind)}>
                    <td className={`${td} ${l.kind === "line" ? "pl-8" : ""}`}>{l.label}</td>
                    {v.map((x, j) => <td key={j} className={`${td} num text-right whitespace-nowrap ${x < 0 ? "text-bad" : ""}`}>{m(x)}</td>)}
                    <td className={`${td} num text-right`}>{pct(pctChange(v[0]!, v[1]!))}</td>
                    <td className={`${td} num text-right`}>{pct(pctChange(v[3]!, v[4]!))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Tutarlar TL, kuruşsuz. Gider kalemleri eksi görünür. 7/A gider hesapları yansıtılmamışsa ilgili 6xx satırında gösterilir.</p>
      </div>
    </>
  );
}
