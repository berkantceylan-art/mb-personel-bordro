import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, periodBounds, previousPeriod } from "@mb/core";
import { PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, periodLabel } from "@/lib/session";
import { loadPlan } from "@/lib/salary-plan";
import { undoPayment } from "@/lib/salary-plan-actions";
import { CreatePeriodButton } from "../CreatePeriodButton";
import { PlanTable } from "./PlanTable";
import { RemitPanel } from "./RemitPanel";

const btn = "h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700";

export default async function SalaryPlanPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  const s = await getSession();
  if (!canManagePay(s.role) || !/^\d{4}-\d{2}$/.test(period)) redirect("/donemler");
  const supabase = await createClient();
  const { plan, paid, remits, accounts, closed, opened } = await loadPlan(supabase, period);
  const { end } = periodBounds(period);
  const today = new Date().toISOString().slice(0, 10);
  const payDate = today > end ? today : end;
  const t = plan.reduce(
    (a, r) => ({ total: a.total + r.totalNet, net: a.net + r.officialNet, bes: a.bes + r.bes, icra: a.icra + r.icra, bank: a.bank + r.netToBank, paidBank: a.paidBank + r.paidBank, paidCash: a.paidCash + r.paidCash, leftBank: a.leftBank + r.leftBank, leftCash: a.leftCash + r.leftCash }),
    { total: 0, net: 0, bes: 0, icra: 0, bank: 0, paidBank: 0, paidCash: 0, leftBank: 0, leftCash: 0 },
  );
  const remitDue = remits.reduce((a, r) => a + (r.paid ? 0 : r.due), 0);
  const unsaved = plan.filter((r) => !r.saved).length;
  const doneCount = plan.filter((r) => r.leftBank + r.leftCash <= 0).length;

  return (
    <>
      <PageHeader
        title={`${periodLabel(period)} maaş planı`}
        subtitle={`${plan.length} personel · ${doneCount} kişinin ödemesi tamam${closed ? " · dönem kapalı" : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href={`/donemler/${previousPeriod(period)}`} className={btn} aria-label="Önceki ay">←</Link>
            <Link href={`/donemler/${nextPeriod(period)}`} className={btn} aria-label="Sonraki ay">→</Link>
            <Link href={`/ay-sonu?donem=${period}`} className={btn}>Ay sonu adımları</Link>
            <Link href={`/bordro?donem=${period}`} className={btn}>Bordro</Link>
            <Link href="/donemler" className={btn}>Dönemler</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-5">
        {!opened && (
          <section className="bg-white border border-brand-700 rounded-[14px] p-5 flex flex-col gap-3">
            <p className="text-sm">{periodLabel(period)} dönemi henüz açılmamış. Açınca aktif personelin hakedişi yazılır ve plan dolar.</p>
            <CreatePeriodButton period={period} label={`${periodLabel(period)} dönemini aç`} />
          </section>
        )}
        {unsaved > 0 && opened && (
          <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">
            {unsaved} personelin bordrosu henüz kaydedilmedi; rakamlar taslaktır (puantaj, rapor, fazla mesai değişirse güncellenir). Ödemeden önce <Link href={`/bordro?donem=${period}`} className="font-semibold underline">Bordro</Link>&apos;da &quot;Bordroyu hesapla ve kaydet&quot; ile kesinleştirin.
          </p>
        )}

        <section className="grid gap-3 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
          <Stat label="Anlaşılan toplam maaş" value={formatTL(t.total)} sub={`Resmi net ${formatTL(t.net)}`} />
          <Stat label="Bankaya yatacak (bordro)" value={formatTL(t.bank)} sub={`BES ${formatTL(t.bes)} · icra ${formatTL(t.icra)}`} />
          <Stat label="Kalan: bankadan ödenecek" value={formatTL(t.leftBank)} sub={`Ödenen ${formatTL(t.paidBank)}`} />
          <Stat label="Kalan: elden ödenecek" value={formatTL(t.leftCash)} sub={`Ödenen ${formatTL(t.paidCash)}`} />
          <Stat label="Kurumlara ödenecek" value={formatTL(remitDue)} sub="BES · icra · SGK · vergi" />
        </section>

        {plan.length > 0 && (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="font-display font-bold text-brand-800">Personel ödemeleri</h2>
              <p className="text-xs text-muted">Kalan tutarlar avanslar, kesintiler ve rapor / eksik günler düşülerek otomatik hesaplanır. Seçin, gerekirse tutarı değiştirin, kasa / bankayı seçip ödeyin; ödeme personel carisine ve kasa / banka bakiyesine aynı anda işlenir.</p>
            </div>
            <PlanTable key={plan.map((r) => `${r.id}:${r.leftBank}:${r.leftCash}`).join("|")} period={period} rows={plan} accounts={accounts} defaultDate={payDate} closed={closed} />
          </>
        )}

        {opened && <RemitPanel period={period} remits={remits} accounts={accounts} defaultDate={payDate} closed={closed} />}

        {paid.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <div className="px-4 pt-4 pb-2 flex flex-wrap justify-between gap-2">
              <h2 className="font-display font-bold text-brand-800">Bu dönem yapılan ödemeler ({paid.length})</h2>
              <a href={`/yazdir/avans?ids=${paid.filter((p) => p.channel === "CASH").map((p) => p.id).join(",")}`} target="_blank" className="text-sm font-semibold text-brand-700">Elden makbuzlarını yazdır →</a>
            </div>
            <table className="w-full text-[13px] min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 px-3 border-b border-line">Tarih</th><th className="py-2 px-3 border-b border-line">Personel</th><th className="py-2 px-3 border-b border-line">Tür</th>
                  <th className="py-2 px-3 border-b border-line">Kasa / banka</th><th className="py-2 px-3 border-b border-line text-right">Tutar</th><th className="py-2 px-3 border-b border-line"><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {paid.map((p) => (
                  <tr key={p.id}>
                    <td className="num py-2 px-3 border-b border-[#EEF2F6]">{p.date.split("-").reverse().join(".")}</td>
                    <td className="py-2 px-3 border-b border-[#EEF2F6] font-semibold">{p.name}</td>
                    <td className="py-2 px-3 border-b border-[#EEF2F6]">{p.type === "ADVANCE" ? "Avans" : "Maaş"} · {p.channel === "BANK" ? "banka" : "elden"}</td>
                    <td className="py-2 px-3 border-b border-[#EEF2F6] text-muted">{p.account ?? <span title="Eski kayıt: kasa / banka seçilmeden girilmiş">—</span>}</td>
                    <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(p.amount)}</td>
                    <td className="py-2 px-3 border-b border-[#EEF2F6] text-right">
                      {!closed && (
                        <form action={undoPayment}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="period" value={period} />
                          <button className="h-8 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-[#33414F]">Geri al</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
