import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

export default async function Page() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="BES" />;
  const [{ data: bes }, { data: besDed }] = await Promise.all([
    supabase.from("bes_enrollments").select("enrolled_on, rate, status, status_date, policy_no, note").eq("employee_id", e.id).order("enrolled_on", { ascending: false }),
    supabase.from("ledger_entries").select("period, amount").eq("employee_id", e.id).eq("type", "BES").is("voided_at", null).order("period", { ascending: false }).limit(24),
  ]);
  const besTotal = (besDed ?? []).reduce((a, d) => a + Number(d.amount), 0);

  return (
    <>
      <MyHeader title="BES" subtitle="Otomatik katılım bireysel emeklilik" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Kaydım">
          {(bes ?? []).length === 0 ? <p className="text-sm text-muted">BES kaydınız yok.</p> : (bes ?? []).map((b, i) => (
            <div key={i} className="text-sm flex flex-col gap-0.5">
              <div><b>%{Math.round(Number(b.rate) * 100)}</b> kesinti · {b.enrolled_on ? `giriş ${formatDate(b.enrolled_on)}` : ""} · durum: {String(b.status ?? "aktif")}{b.status_date ? ` (${formatDate(b.status_date)})` : ""}</div>
              {b.policy_no && <div className="text-xs text-muted">Poliçe no {b.policy_no}</div>}
              {b.note && <div className="text-xs text-muted">{b.note}</div>}
            </div>
          ))}
          {(besDed ?? []).length > 0 && (
            <div className="text-sm">
              <div className="text-xs text-muted mb-1">Kesintiler · toplam {formatTL(besTotal)}</div>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">{(besDed ?? []).map((d, i) => <li key={i} className="flex justify-between num"><span className="text-muted">{periodLabel(d.period)}</span><span>{formatTL(Number(d.amount))}</span></li>)}</ul>
            </div>
          )}
        </Card>

        <p className="text-xs text-muted">Cayma veya ara verme için İK&apos;ya yazılı başvurun; ilk 2 ay içinde cayarsanız kesintiler emeklilik şirketince iade edilir.</p>
      </div>
    </>
  );
}
