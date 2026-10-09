import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

export default async function Page() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İcra ve nafaka" />;
  const [{ data: garn }, { data: garnDed }] = await Promise.all([
    supabase.from("garnishment_files").select("id, kind, office, file_no, creditor, served_at, debt_amount, monthly_amount, seizable_ratio, status, closed_at").eq("employee_id", e.id).order("served_at", { ascending: false }),
    supabase.from("garnishment_deductions").select("file_id, period, amount").eq("employee_id", e.id).order("period", { ascending: false }).limit(60),
  ]);
  const KIND: Record<string, string> = { ALIMONY: "Nafaka", DEBT: "İcra", nafaka: "Nafaka", icra: "İcra" };
  const paid = (fileId: string) => (garnDed ?? []).filter((d) => d.file_id === fileId).reduce((a, d) => a + Number(d.amount), 0);
  const periods = (fileId: string) => (garnDed ?? []).filter((d) => d.file_id === fileId);

  return (
    <>
      <MyHeader title="İcra ve nafaka" subtitle="Maaşınızdan yapılan yasal kesintiler" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Dosyalarım">
          {(garn ?? []).length === 0 ? <p className="text-sm text-muted">İcra veya nafaka dosyanız yok.</p> : (garn ?? []).map((g) => (
            <div key={g.id} className="text-sm border-b border-[#EEF2F6] last:border-0 pb-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2"><b>{KIND[g.kind] ?? g.kind} · {g.creditor ?? "—"}</b><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${g.status === "closed" || g.closed_at ? "bg-[#EEF2F6] text-[#33414F]" : "bg-warn-bg text-warn"}`}>{g.status === "closed" || g.closed_at ? "Kapandı" : "Devam ediyor"}</span></div>
              <div className="text-xs text-muted">{g.office ?? ""} {g.file_no ? `· dosya ${g.file_no}` : ""} {g.served_at ? `· tebliğ ${formatDate(g.served_at)}` : ""}</div>
              <div className="grid grid-cols-3 gap-2 num text-xs mt-1">
                <div><div className="text-muted">Borç</div><div>{g.debt_amount ? formatTL(Number(g.debt_amount)) : "—"}</div></div>
                <div><div className="text-muted">Aylık kesinti</div><div>{g.monthly_amount ? formatTL(Number(g.monthly_amount)) : g.seizable_ratio ? `maaşın 1/${Math.round(1 / Number(g.seizable_ratio))}` : "—"}</div></div>
                <div><div className="text-muted">Kesilen toplam</div><div className="font-semibold">{formatTL(paid(g.id))}</div></div>
              </div>
              {periods(g.id).length > 0 && <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-xs num mt-1">{periods(g.id).map((d, i) => <li key={i} className="flex justify-between"><span className="text-muted">{periodLabel(d.period)}</span><span>{formatTL(Number(d.amount))}</span></li>)}</ul>}
            </div>
          ))}
        </Card>

      </div>
    </>
  );
}
