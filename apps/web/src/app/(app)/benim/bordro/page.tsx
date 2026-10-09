import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked, td, th } from "../_shared";

export default async function MyPayrollPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Bordrolarım" />;
  const { data: payroll } = await supabase.from("payroll_lines").select("period, days, official_gross, official_net, net_to_bank, bes, garnishment").eq("employee_id", e.id).order("period", { ascending: false }).limit(24);
  return (
    <>
      <MyHeader title="Bordrolarım" subtitle="Resmi bordro özetleri" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[480px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Dönem</th><th className={`${th} text-right`}>Gün</th><th className={`${th} text-right`}>Brüt</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>BES</th><th className={`${th} text-right`}>İcra</th><th className={`${th} text-right`}>Bankaya</th></tr></thead>
              <tbody>
                {(payroll ?? []).map((p) => (
                  <tr key={p.period}>
                    <td className={td}>{periodLabel(p.period)}</td>
                    <td className={`${td} text-right num`}>{p.days}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.official_gross))}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.official_net))}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.bes ?? 0))}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.garnishment ?? 0))}</td>
                    <td className={`${td} text-right num font-semibold`}>{formatTL(Number(p.net_to_bank))}</td>
                  </tr>
                ))}
                {(payroll ?? []).length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Henüz bordro yok.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Bordro, ay kapandığında muhasebe tarafından oluşturulur. İmzalı bordro için İK&apos;ya başvurun.</p>
        </Card>
      </div>
    </>
  );
}
