import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, previousPeriod } from "@mb/core";
import { BesForm } from "@/components/BesIcraForms";
import { Card, PageHeader, Stat } from "@/components/ui";
import { setBesStatus } from "@/lib/bes-icra-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";

const STATUS: Record<string, [string, string]> = {
  active: ["Aktif", "bg-ok-bg text-ok"],
  opted_out: ["Cayma", "bg-[#EEF2F6] text-[#33414F]"],
  paused: ["Ara verdi", "bg-warn-bg text-warn"],
  left: ["Ayrıldı", "bg-[#EEF2F6] text-[#33414F]"],
};
const addMonths = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export default async function BesPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const supabase = await createClient();
  const [{ data: emps }, { data: enr }, { data: lines }, { data: privs }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, departments(name)").eq("status", "active").order("first_name"),
    supabase.from("bes_enrollments").select("*").order("enrolled_on", { ascending: false }),
    supabase.from("payroll_lines").select("employee_id, bes, official_gross, posted").eq("period", period).gt("bes", 0),
    supabase.from("employee_private").select("employee_id, national_id"),
  ]);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const dept = new Map((emps ?? []).map((e) => [e.id, (e.departments as unknown as { name: string } | null)?.name ?? ""]));
  const tc = new Map((privs ?? []).map((p) => [p.employee_id, p.national_id as string | null]));
  const active = (enr ?? []).filter((e) => e.status === "active");
  const total = (lines ?? []).reduce((a, l) => a + Number(l.bes), 0);
  const today = new Date().toISOString().slice(0, 10);
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="BES (otomatik katılım)" subtitle={`${active.length} aktif üye`} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <section className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <Stat label="Aktif üye" value={String(active.length)} />
          <Stat label={`${periodLabel(period)} BES kesintisi`} value={formatTL(total)} sub={`${(lines ?? []).length} kişi · bordrodan`} />
          <Stat label="Cayma süresi devam eden" value={String(active.filter((e) => addMonths(e.enrolled_on, 2) >= today).length)} sub="ilk 2 ay içinde cayma hakkı" />
        </section>

        <Card title="Yeni BES kaydı"><BesForm employees={(emps ?? []).filter((e) => !active.some((a) => a.employee_id === e.id)).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} /></Card>

        <Card
          title={`${periodLabel(period)} BES ödeme listesi`}
          action={
            <div className="flex gap-2 items-center text-sm">
              <Link href={`/bes?donem=${previousPeriod(period)}`} className="font-semibold text-brand-700">←</Link>
              <Link href={`/bes?donem=${nextPeriod(period)}`} className="font-semibold text-brand-700">→</Link>
              <a href={`/bes/liste?donem=${period}`} className="h-9 px-3 inline-flex items-center rounded-lg border border-[#D5DEE8] font-semibold text-brand-700">Excel indir</a>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>TC</th><th className={th}>Bölüm</th><th className={`${th} text-right`}>Prime esas kazanç</th><th className={`${th} text-right`}>Kesinti</th></tr></thead>
              <tbody>
                {(lines ?? []).map((l) => (
                  <tr key={l.employee_id}><td className={`${td} font-semibold`}>{name.get(l.employee_id) ?? "—"}</td><td className={`num ${td}`}>{tc.get(l.employee_id) ?? "—"}</td><td className={td}>{dept.get(l.employee_id)}</td><td className={`num ${td} text-right`}>{formatTL(Number(l.official_gross))}</td><td className={`num ${td} text-right font-semibold`}>{formatTL(Number(l.bes))}</td></tr>
                ))}
                {(lines ?? []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Bu dönemin bordrosu henüz kaydedilmedi veya BES kesintisi yok.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Garanti BBVA Emeklilik&apos;in istediği dosya biçimi gelince bu liste o formata çevrilecek.</p>
        </Card>

        <Card title="Üyelikler">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Giriş</th><th className={`${th} text-right`}>Oran</th><th className={th}>Poliçe</th><th className={th}>Durum</th><th className={th}>Değiştir</th></tr></thead>
              <tbody>
                {(enr ?? []).map((e) => {
                  const [l, cls] = STATUS[e.status] ?? ["", ""];
                  const inOptOut = e.status === "active" && addMonths(e.enrolled_on, 2) >= today;
                  return (
                    <tr key={e.id}>
                      <td className={`${td} font-semibold`}><Link href={`/personel/${e.employee_id}`} className="text-brand-700">{name.get(e.employee_id) ?? "—"}</Link></td>
                      <td className={`num ${td}`}>{formatDate(e.enrolled_on)}{inOptOut && <span className="block text-xs text-warn">cayma hakkı {formatDate(addMonths(e.enrolled_on, 2))}&apos;e kadar</span>}</td>
                      <td className={`num ${td} text-right`}>%{(Number(e.rate) * 100).toLocaleString("tr-TR")}</td>
                      <td className={td}>{e.policy_no ?? "—"}</td>
                      <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span>{e.status_date && e.status !== "active" ? <span className="block text-xs text-muted">{formatDate(e.status_date)}</span> : null}</td>
                      <td className={td}>
                        <form action={setBesStatus} className="flex gap-1.5">
                          <input type="hidden" name="id" value={e.id} />
                          <select name="status" defaultValue={e.status} aria-label="Durum" className="h-9 rounded-md border border-[#D5DEE8] px-2 text-xs">
                            <option value="active">Aktif</option><option value="opted_out">Cayma</option><option value="paused">Ara verdi</option><option value="left">Ayrıldı</option>
                          </select>
                          <input type="date" name="status_date" aria-label="Tarih" className="h-9 rounded-md border border-[#D5DEE8] px-2 text-xs" />
                          <button className="h-9 px-2 rounded-md border border-[#D5DEE8] text-xs font-semibold text-brand-700">Kaydet</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Cayma ilk 2 ay içinde yapılırsa kesilen tutarlar emeklilik şirketi tarafından iade edilir. Cayma / ara verme tarihinden sonraki bordrolarda kesinti yapılmaz.</p>
        </Card>
      </div>
    </>
  );
}
