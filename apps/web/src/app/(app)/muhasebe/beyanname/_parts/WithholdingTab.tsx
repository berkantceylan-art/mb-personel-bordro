import Link from "next/link";
import { Card } from "@/components/ui";
import { KPI, Notice, btnPrimary, inputCls, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { glPayrollAccrual } from "@/lib/gl-actions";
import { RpcError, type TabProps } from "./shared";

type Pay = { people: number; days: number; gross: number; income_tax: number; stamp_tax: number; sgk_employee: number; unemployment_employee: number; employer_share: number; employer_cost: number; net: number; bes: number; garnishment: number; net_to_bank: number; accrual: { id: string; no: number; year: number } | null };

const m = (v: number) => fmt(v);

/** Muhtasar ve prim hizmet: ücret stopajı, ücret damga vergisi, kira / serbest meslek stopajı, SGK primleri */
export async function WithholdingTab({ month, canEdit }: TabProps) {
  const supabase = await createClient();
  const [{ data, error }, whRes] = await Promise.all([
    supabase.rpc("gl_payroll_report", { p_period: month }),
    supabase.rpc("gl_withholding_report", { p_period: month }),
  ]);
  if (error) return <RpcError message={error.message} file="20270208000000_gl_close.sql" />;
  const p = data as Pay;
  const wh = (whRes.data ?? { rent: 0, smm: 0 }) as { rent: number; smm: number };
  const rows: Array<[string, string, number, "tax" | "sgk"]> = [
    ["Ücret ödemeleri · gelir vergisi", "GVK 94/1", Number(p?.income_tax ?? 0), "tax"],
    ["Ücret ödemeleri · damga vergisi", "kod 302", Number(p?.stamp_tax ?? 0), "tax"],
    ["Kira ödemeleri · stopaj", "GVK 94/5-a", Number(wh.rent), "tax"],
    ["Serbest meslek ödemeleri · stopaj", "GVK 94/2-b", Number(wh.smm), "tax"],
    ["SGK primi · işçi payı + işsizlik", "", Number(p?.sgk_employee ?? 0) + Number(p?.unemployment_employee ?? 0), "sgk"],
    ["SGK primi · işveren payı", "teşvikler hariç", Number(p?.employer_share ?? 0), "sgk"],
  ];
  const tax = rows.filter((r) => r[3] === "tax").reduce((x, r) => x + r[2], 0);
  const sgk = rows.filter((r) => r[3] === "sgk").reduce((x, r) => x + r[2], 0);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Vergi dairesine (MUHSGK)" value={m(tax)} tone={tax > 0 ? "bad" : undefined} sub="izleyen ayın 26'sı" />
        <KPI label="SGK'ya" value={m(sgk)} />
        <KPI label="Personel / gün" value={p?.people ? `${p.people} / ${p.days}` : "—"} />
        <KPI label="Brüt ücret (matrah)" value={m(Number(p?.gross ?? 0))} />
      </div>
      <Card title="Tahakkuk özeti">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Kalem</th><th className={th}>Dayanak</th><th className={`${th} text-right`}>Tutar</th></tr></thead>
          <tbody>
            {rows.map(([l, ref, v]) => <tr key={l}><td className={td}>{l}</td><td className={`${td} text-xs text-muted`}>{ref}</td><td className={tdNum}>{m(v)}</td></tr>)}
            <tr className="font-semibold"><td className={td} colSpan={2}>Toplam (vergi + SGK)</td><td className={tdNum}>{m(tax + sgk)}</td></tr>
          </tbody>
        </table></div>
        <p className="text-xs text-muted">Ücret damga vergisi muhtasar ve prim hizmet beyannamesinde 302 koduyla beyan edilir; sözleşmelerin damga vergisi &quot;Damga vergisi&quot; sekmesindedir. Kira ve serbest meslek stopajı, masraf girerken &quot;Stopaj&quot; seçilen kayıtlardan gelir.</p>
      </Card>
      {!p?.people ? <Notice tone="info">{month} dönemi bordrosu hesaplanmamış.</Notice> : (
        <Card title="Bordro tahakkuku">
          <div className="grid gap-1 text-sm md:grid-cols-2">
            <span>Net ücret: <b className="num">{m(p.net)}</b></span><span>BES + icra kesintisi: <b className="num">{m(Number(p.bes) + Number(p.garnishment))}</b></span>
            <span>Bankaya ödenecek: <b className="num">{m(p.net_to_bank)}</b></span><span>İşveren maliyeti: <b className="num">{m(p.employer_cost)}</b></span>
          </div>
          {p.accrual ? <p className="text-sm">Tahakkuk fişi: <Link href={`/muhasebe/fisler/${p.accrual.id}`} className="font-semibold text-brand-700">{p.accrual.year}/{p.accrual.no}</Link></p>
            : canEdit && <form action={glPayrollAccrual} className="flex items-end gap-2"><input type="hidden" name="period" value={month} /><label className="flex flex-col gap-1 text-xs font-semibold text-muted">Gider hesabı<input name="expense" defaultValue="770" className={`${inputCls} w-28`} /></label><PendingSubmit className={btnPrimary}>Tahakkuk fişini oluştur</PendingSubmit></form>}
        </Card>
      )}
    </>
  );
}
