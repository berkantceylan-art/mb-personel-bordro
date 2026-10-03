import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, previousPeriod } from "@mb/core";
import { GarnishmentForm } from "@/components/BesIcraForms";
import { Card, PageHeader, Stat } from "@/components/ui";
import { setGarnishmentStatus } from "@/lib/bes-icra-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";

const STATUS: Record<string, [string, string]> = {
  active: ["Aktif", "bg-ok-bg text-ok"],
  suspended: ["Durduruldu", "bg-warn-bg text-warn"],
  closed: ["Kapandı", "bg-[#EEF2F6] text-[#33414F]"],
};

export default async function GarnishmentPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const supabase = await createClient();
  const [{ data: emps }, { data: files }, { data: deds }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name").order("first_name"),
    supabase.from("garnishment_balances").select("*").order("status").order("served_at"),
    supabase.from("garnishment_deductions").select("file_id, employee_id, amount").eq("period", period),
  ]);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const fileById = new Map((files ?? []).map((f) => [f.id, f]));
  const active = (files ?? []).filter((f) => f.status === "active");
  const monthTotal = (deds ?? []).reduce((a, d) => a + Number(d.amount), 0);
  const remaining = active.reduce((a, f) => a + Number(f.remaining ?? 0), 0);
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="İcra ve nafaka" subtitle={`${active.length} aktif dosya`} />
      <div className="p-6 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <section className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <Stat label="Aktif dosya" value={String(active.length)} sub={`${new Set(active.map((f) => f.employee_id)).size} personel`} />
          <Stat label="Kalan icra borcu" value={formatTL(remaining)} />
          <Stat label={`${periodLabel(period)} kesinti`} value={formatTL(monthTotal)} sub={`${(deds ?? []).length} dosya`} />
        </section>

        <Card title="Yeni dosya"><GarnishmentForm employees={(emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} /></Card>

        <Card title="Dosyalar">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tür</th><th className={th}>Daire / dosya</th><th className={th}>Tebliğ</th><th className={`${th} text-right`}>Borç / aylık</th><th className={`${th} text-right`}>Kesilen</th><th className={`${th} text-right`}>Kalan</th><th className={th}>Durum</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {(files ?? []).map((f) => {
                  const [l, cls] = STATUS[f.status] ?? ["", ""];
                  return (
                    <tr key={f.id}>
                      <td className={`${td} font-semibold`}><Link href={`/personel/${f.employee_id}`} className="text-brand-700">{name.get(f.employee_id) ?? "—"}</Link></td>
                      <td className={td}>{f.kind === "ALIMONY" ? "Nafaka" : "İcra"}</td>
                      <td className={td}>{f.office}<span className="block text-xs text-muted">{f.file_no}{f.creditor ? ` · ${f.creditor}` : ""}</span></td>
                      <td className={`num ${td}`}>{formatDate(f.served_at)}</td>
                      <td className={`num ${td} text-right`}>{f.kind === "ALIMONY" ? `${formatTL(Number(f.monthly_amount))}/ay` : formatTL(Number(f.debt_amount))}</td>
                      <td className={`num ${td} text-right`}>{formatTL(Number(f.paid))}</td>
                      <td className={`num ${td} text-right font-semibold`}>{f.kind === "ALIMONY" ? "—" : formatTL(Number(f.remaining))}</td>
                      <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span></td>
                      <td className={td}>
                        <div className="flex gap-2 justify-end">
                          {f.status !== "closed" && (
                            <form action={setGarnishmentStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="closed" /><button className="text-xs font-semibold text-muted">Kapat</button></form>
                          )}
                          <form action={setGarnishmentStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value={f.status === "active" ? "suspended" : "active"} /><button className="text-xs font-semibold text-brand-700">{f.status === "active" ? "Durdur" : "Aktif yap"}</button></form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(files ?? []).length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">Dosya yok.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Borcu biten icra dosyası bir sonraki bordroda kesilmez; sıradaki dosya kesinti almaya başlar.</p>
        </Card>

        <Card
          title={`${periodLabel(period)} icra dairelerine gönderilecek kesintiler`}
          action={<div className="flex gap-3 text-sm"><Link href={`/icra?donem=${previousPeriod(period)}`} className="font-semibold text-brand-700">←</Link><Link href={`/icra?donem=${nextPeriod(period)}`} className="font-semibold text-brand-700">→</Link></div>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Daire</th><th className={th}>Dosya no</th><th className={th}>Personel</th><th className={th}>Ödeme IBAN</th><th className={`${th} text-right`}>Tutar</th></tr></thead>
              <tbody>
                {(deds ?? []).map((d, i) => {
                  const f = fileById.get(d.file_id);
                  return (
                    <tr key={i}><td className={td}>{f?.office}</td><td className={td}>{f?.file_no}</td><td className={`${td} font-semibold`}>{name.get(d.employee_id)}</td><td className={`num ${td} text-xs`}>{f?.payment_iban ?? "—"}</td><td className={`num ${td} text-right font-semibold`}>{formatTL(Number(d.amount))}</td></tr>
                  );
                })}
                {(deds ?? []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Bu dönemde cariye yazılmış icra kesintisi yok (Bordro → &quot;BES ve icra kesintilerini cariye yaz&quot;).</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
