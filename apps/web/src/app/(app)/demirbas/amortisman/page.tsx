import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EmptyRow, Money, Notice, Table, btnPrimary, inputCls, page, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/fin";
import { runDepreciation, undoDepreciation } from "@/lib/asset-actions";

export const dynamic = "force-dynamic";

/** Aylık amortisman: dönem seç → tüm demirbaşlar için tek finans kaydı */
export default async function DepreciationPage() {
  const s = await getSession();
  const lvl = s.modules.assets ?? 0;
  if (lvl < 1) redirect("/demirbas");
  const supabase = await createClient();
  const { data, error } = await supabase.from("asset_depreciation").select("period, amount").order("period", { ascending: false }).limit(50000);
  const by = new Map<string, { n: number; total: number }>();
  for (const d of (data ?? []) as { period: string; amount: number }[]) { const x = by.get(d.period) ?? { n: 0, total: 0 }; by.set(d.period, { n: x.n + 1, total: x.total + Number(d.amount) }); }
  const last = new Date(Date.now() + 3 * 3600 * 1000);
  last.setUTCDate(1); last.setUTCMonth(last.getUTCMonth() - 1);
  const suggest = last.toISOString().slice(0, 7);
  return (
    <>
      <PageHeader title="Amortisman" subtitle="Her ay sonunda bir kez çalıştırın: normal (doğrusal) yöntemle aylık amortisman gider olarak işlenir" actions={<Link href="/demirbas" className="text-sm font-semibold text-brand-700">← Demirbaş</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Amortisman tablosu yok: Supabase&apos;de 20261206000000_expenses_assets.sql çalıştırın.</Notice>}
        {lvl >= 2 && (
          <form action={runDepreciation} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Dönem<input type="month" name="period" defaultValue={suggest} max={today().slice(0, 7)} className={inputCls} /></label>
            <PendingSubmit className={btnPrimary}>Amortismanı işle</PendingSubmit>
            <span className="text-xs text-muted w-full">Aynı dönem iki kez işlenmez. Yıl sonunda muhasebecinizin VUK amortisman listesiyle karşılaştırması önerilir (kıst amortisman, binek oto sınırları vb.).</span>
          </form>
        )}
        <Table head={["Dönem", "Demirbaş", "Tutar", ""]} min={520}>
          {[...by.entries()].map(([p, x]) => (
            <tr key={p}>
              <td className={td}>{p.slice(5, 7)}.{p.slice(0, 4)}</td>
              <td className={`${td} num`}>{x.n}</td>
              <td className={tdNum}><Money v={x.total} strong /></td>
              <td className={`${td} text-right`}>{lvl >= 3 && <form action={undoDepreciation}><input type="hidden" name="period" value={p} /><ConfirmSubmit label="Geri al" question="Bu dönemin amortismanı ve finans kaydı geri alınsın mı?" /></form>}</td>
            </tr>
          ))}
          {by.size === 0 && <EmptyRow cols={4} text="Henüz amortisman işlenmedi." />}
        </Table>
      </div>
    </>
  );
}
