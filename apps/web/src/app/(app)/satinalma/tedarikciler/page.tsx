import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { rfqError } from "@/lib/rfq";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tedarikçi karnesi" };

type S = { party_id: string; name: string; orders: number; received: number; on_time_pct: number | null; avg_delay: number | null; avg_lead: number | null; damage_pct: number | null; rfq_invited: number; rfq_quoted: number; rfq_won: number; spend: number; score: number };
const tone = (n: number) => (n >= 80 ? "bg-ok-bg text-ok" : n >= 60 ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad");

/** Tedarikçi karnesi (son 12 ay): zamanında teslim, gecikme, teslim süresi, hasar, teklif yanıtı ve puan */
export default async function SupplierScorecard() {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const { data, error } = await (await createClient()).rpc("pur_supplier_scores");
  const rows = (data ?? []) as S[];
  return (
    <>
      <PageHeader title="Tedarikçi karnesi" subtitle="Son 12 ay · puan = %50 zamanında teslim + %30 hasarsız teslim + %20 teklif yanıtı"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/satinalma/teklifler" className="text-brand-700">Teklifler</Link><Link href="/satinalma" className="text-brand-700">← Satın alma</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{rfqError(error.message)}</p>}
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Tedarikçi</th><th className="p-3 text-center">Puan</th><th className="p-3 text-right">Harcama</th><th className="p-3 text-right">Sipariş</th><th className="p-3 text-right">Zamanında</th><th className="p-3 text-right">Ort. gecikme</th><th className="p-3 text-right">Ort. teslim</th><th className="p-3 text-right">Hasar</th><th className="p-3 text-right">Teklif yanıtı</th><th className="p-3 text-right">Kazandı</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.party_id} className="border-t border-[#EEF2F6]">
                  <td className="p-3 font-semibold"><Link href={`/finans/cariler/${r.party_id}`} className="text-brand-700">{r.name}</Link></td>
                  <td className="p-3 text-center"><span className={`inline-block min-w-10 rounded-lg px-2 py-1 font-bold ${tone(r.score)}`}>{r.score}</span></td>
                  <td className="p-3 text-right tabular-nums">{money(r.spend, "TRY")}</td>
                  <td className="p-3 text-right">{r.orders}</td>
                  <td className="p-3 text-right">{r.on_time_pct != null ? `%${Number(r.on_time_pct)}` : "—"}</td>
                  <td className={`p-3 text-right ${Number(r.avg_delay ?? 0) > 2 ? "text-bad font-semibold" : ""}`}>{r.avg_delay != null ? `${Number(r.avg_delay)} gün` : "—"}</td>
                  <td className="p-3 text-right">{r.avg_lead != null ? `${Number(r.avg_lead)} gün` : "—"}</td>
                  <td className={`p-3 text-right ${Number(r.damage_pct ?? 0) > 1 ? "text-bad font-semibold" : ""}`}>{r.damage_pct != null ? `%${Number(r.damage_pct)}` : "—"}</td>
                  <td className="p-3 text-right">{r.rfq_invited ? `${r.rfq_quoted}/${r.rfq_invited}` : "—"}</td>
                  <td className="p-3 text-right">{r.rfq_won || "—"}</td>
                </tr>
              ))}
              {!rows.length && !error && <tr><td colSpan={10} className="p-8 text-center text-muted">Son 12 ayda sipariş ya da teklif yok.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Veri eksik olduğunda (ör. termin girilmemiş sipariş) ilgili bileşen 75 puan sayılır. Zamanında teslim: mal kabul tarihi ≤ istenen teslim tarihi.</p>
      </div>
    </>
  );
}
