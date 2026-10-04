import Link from "next/link";
import { isoWeekday, nextPeriod, previousPeriod } from "@mb/core";
import { PageHeader, PrimaryLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { fmtMin, loadMonth, type DayCell } from "@/lib/timekeeping";
import { MissingDaysButton } from "./PunchForms";

const DAYS = ["", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
const KIND: Record<string, string> = { MISSING_OUT: "Çıkış yok", MISSING_IN: "Giriş yok", FREQUENT_EXITS: "Sık çıkış" };

function cellView(c: DayCell): { text: string; cls: string; title: string } {
  if (!c.employed) return { text: "", cls: "bg-white", title: "Kadro dışı" };
  if (c.leaveCode) {
    const t = c.leaveCode === "RAPOR" ? "R" : c.leaveCode === "UCRETSIZ" ? "Üİ" : "İ";
    return { text: t, cls: c.leaveCode === "RAPOR" ? "bg-bad-bg text-bad" : "bg-[#E6F4EC] text-ok", title: `İzin: ${c.leaveCode}` };
  }
  switch (c.status) {
    case "WORKED":
      return {
        text: fmtMin(c.workedMin),
        cls: c.lateMin || c.earlyLeaveMin ? "bg-warn-bg text-warn" : c.overtimeMin ? "bg-[#E0F5FB] text-accent-ink" : "bg-ok-bg text-ok",
        title: `${fmtMin(c.workedMin)} saat${c.lateMin ? ` · ${c.lateMin} dk geç` : ""}${c.earlyLeaveMin ? ` · ${c.earlyLeaveMin} dk erken` : ""}${c.overtimeMin ? ` · vardiya aşımı ${c.overtimeMin} dk` : ""}`,
      };
    case "INCOMPLETE":
      return { text: "?", cls: "bg-bad-bg text-bad font-bold", title: "Eksik giriş/çıkış" };
    case "ABSENT":
      return { text: "—", cls: "bg-bad-bg text-bad", title: "Devamsız" };
    case "HOLIDAY":
      return { text: c.workedMin ? fmtMin(c.workedMin) : "RT", cls: c.workedMin ? "bg-[#E0F5FB] text-accent-ink" : "bg-[#EEF2F6] text-[#5A6878]", title: c.holidayName ?? "Resmi tatil" };
    case "WEEKLY_OFF":
      return { text: c.workedMin ? fmtMin(c.workedMin) : "HT", cls: c.workedMin ? "bg-[#E0F5FB] text-accent-ink" : "bg-[#EEF2F6] text-[#5A6878]", title: "Hafta tatili" };
    default:
      return { text: c.punchCount ? "•" : "", cls: "bg-white text-muted", title: "Vardiya atanmamış" };
  }
}

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ donem?: string; bolum?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const supabase = await createClient();
  const [m, { data: departments }, { count: unlinked }, { data: lastImport }] = await Promise.all([
    loadMonth(supabase, period, { department: sp.bolum }),
    supabase.from("departments").select("name").order("name"),
    supabase.from("attendance_punches").select("id", { count: "exact", head: true }).is("employee_id", null),
    supabase.from("attendance_imports").select("file_name, imported_at, punch_count, duplicate_count").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const name = new Map(m.employees.map((e) => [e.id, e.name]));
  const q = (p: string) => `/puantaj?donem=${p}${sp.bolum ? `&bolum=${encodeURIComponent(sp.bolum)}` : ""}`;
  let lastDept = "";

  return (
    <>
      <PageHeader
        title="Puantaj"
        subtitle={`${periodLabel(period)}${lastImport ? ` · son yükleme ${formatDate(lastImport.imported_at)} (${lastImport.file_name})` : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href={q(previousPeriod(period))} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">←</Link>
            <Link href={q(nextPeriod(period))} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">→</Link>
            <PrimaryLink href="/puantaj/yukle">Cihaz dosyası yükle</PrimaryLink>
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap gap-3 items-start">
          <form className="flex gap-3">
            <input type="hidden" name="donem" value={period} />
            <select name="bolum" defaultValue={sp.bolum ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
              <option value="">Tüm bölümler</option>
              {(departments ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
            <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
          </form>
          {canManagePay(s.role) && <MissingDaysButton period={period} />}
        </div>
        {(unlinked ?? 0) > 0 && (
          <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">
            {unlinked} okutma hiçbir personele bağlı değil. Personel düzenleme ekranında PDKS numaralarını girdiğinizde kayıtlar otomatik bağlanır.
          </p>
        )}

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left py-2 px-3 font-semibold text-muted border-b border-line min-w-44">Personel</th>
                {m.days.map((d) => {
                  const wd = isoWeekday(d);
                  return (
                    <th key={d} className={`py-2 px-0.5 font-semibold border-b border-line text-center min-w-9 ${wd === 7 || m.holidays.has(d) ? "text-warn" : "text-[#33414F]"}`} title={m.holidays.get(d)?.name}>
                      <span className="block num">{Number(d.slice(8))}</span>
                      <span className="font-normal">{DAYS[wd]}</span>
                    </th>
                  );
                })}
                <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Gün</th>
                <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Saat</th>
                <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Devams.</th>
                <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted">Geç</th>
                <th className="py-2 px-2 font-semibold border-b border-line text-right text-muted" title="Vardiya süresini aşan çalışma. Ödenecek fazla mesai (haftalık 45 saat esası) Fazla mesai sayfasında hesaplanır.">Aşım sa</th>
              </tr>
            </thead>
            <tbody>
              {m.employees.map((e) => {
                const row = m.cells.get(e.id)!;
                const cs = [...row.values()];
                const worked = cs.filter((c) => c.status === "WORKED" || ((c.status === "WEEKLY_OFF" || c.status === "HOLIDAY") && c.workedMin > 0)).length;
                const minutes = cs.reduce((a, c) => a + c.workedMin, 0);
                const absent = cs.filter((c) => c.employed && c.status === "ABSENT").length;
                const late = cs.filter((c) => c.lateMin > 0).length;
                const ot = cs.reduce((a, c) => a + c.overtimeMin, 0);
                const header = e.dept !== lastDept;
                lastDept = e.dept;
                return [
                  header && (
                    <tr key={`h-${e.dept}`}><td colSpan={m.days.length + 6} className="sticky left-0 py-1.5 px-3 bg-[#F3F6F9] font-bold uppercase tracking-wider text-[#33414F]">{e.dept}</td></tr>
                  ),
                  <tr key={e.id}>
                    <td className="sticky left-0 z-10 bg-white py-1 px-3 border-b border-[#EEF2F6]">
                      <Link href={`/personel/${e.id}`} className="font-semibold text-brand-700 text-[13px]">{e.name}</Link>
                      <span className="block num text-muted">{e.cardNo ?? "PDKS no yok"}</span>
                    </td>
                    {m.days.map((d) => {
                      const v = cellView(row.get(d)!);
                      return (
                        <td key={d} className="p-0.5 border-b border-[#EEF2F6]">
                          <Link href={`/puantaj/${e.id}/${d}`} title={v.title} className={`num flex items-center justify-center h-8 rounded ${v.cls}`}>{v.text}</Link>
                        </td>
                      );
                    })}
                    <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{worked}</td>
                    <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{fmtMin(minutes)}</td>
                    <td className={`num py-1 px-2 border-b border-[#EEF2F6] text-right ${absent ? "text-bad font-semibold" : ""}`}>{absent}</td>
                    <td className={`num py-1 px-2 border-b border-[#EEF2F6] text-right ${late ? "text-warn font-semibold" : ""}`}>{late}</td>
                    <td className="num py-1 px-2 border-b border-[#EEF2F6] text-right">{fmtMin(ot)}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </section>

        <div className="flex flex-wrap gap-4 text-xs text-[#33414F]">
          {[["bg-ok-bg", "Tam gün (saat)"], ["bg-warn-bg", "Geç / erken"], ["bg-[#E0F5FB]", "Fazla mesai / tatil çalışması"], ["bg-bad-bg", "Devamsız (—) / eksik okutma (?) / rapor (R)"], ["bg-[#E6F4EC]", "İzinli (İ)"], ["bg-[#EEF2F6]", "Hafta tatili (HT) / resmi tatil (RT)"]].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${c}`} />{l}</span>
          ))}
        </div>

        <section className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">Anomaliler ({m.anomalies.length})</h2>
          {m.anomalies.length === 0 && <p className="text-sm text-muted">Eksik giriş/çıkış yok.</p>}
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))]">
            {m.anomalies.slice(0, 60).map((a, i) => (
              <Link key={i} href={`/puantaj/${a.employeeId}/${a.at.slice(0, 10)}`} className="flex gap-3 items-start p-3 rounded-lg bg-[#F7F9FB] hover:bg-[#EEF2F6]">
                <span className={`text-[11px] font-bold px-2 py-1 rounded-md ${a.kind === "FREQUENT_EXITS" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"}`}>{KIND[a.kind] ?? a.kind}</span>
                <span className="flex flex-col text-[13px]"><b>{name.get(a.employeeId) ?? "—"}</b><span className="num text-xs text-muted">{a.detail.replace(/T/g, " ")}</span></span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
