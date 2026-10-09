import Link from "next/link";
import { nextPeriod, previousPeriod } from "@mb/core";
import { Card } from "@/components/ui";
import { deptLimit, type LeaveData } from "@/lib/annual-leave";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/session";

const COLOR: Record<string, string> = { YILLIK: "bg-[#2E9D6A]", UCRETSIZ: "bg-[#E8A33D]", RAPOR: "bg-[#D9534F]", DOGUM: "bg-[#D46BA3]" };
const LEGEND: Array<[string, string]> = [["bg-[#2E9D6A]", "Yıllık izin"], ["bg-[#9BD3B5] bg-stripes", "Onay bekliyor"], ["bg-[#E8A33D]", "Ücretsiz / yol izni"], ["bg-[#D9534F]", "Rapor"], ["bg-[#5B8DEF]", "Diğer izin"], ["border-2 border-dashed border-[#2E9D6A]", "Plan"]];

/** Bölüm bazında aylık izin çizelgesi; altta günlük izinli sayısı ve sınır aşımı */
export async function Takvim({ data, month, dept, today }: { data: LeaveData; month: string; dept?: string; today: string }) {
  const supabase = await createClient();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: dim }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const first = days[0]!, last = days[dim - 1]!;
  const { data: plans } = await supabase.from("leave_plans").select("employee_id, start_date, end_date, status").lte("start_date", last).gte("end_date", first);
  const planned = (plans ?? []).filter((p) => (p as { status?: string }).status !== "reddedildi" && (p as { status?: string }).status !== "talebe-donustu");
  const depts = data.depts.filter((d) => !dept || d.id === dept);
  const rows = data.rows.filter((r) => r.code !== "SAATLIK" && r.start_date <= last && r.end_date >= first);
  const wd = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
  const nav = (p: string) => `/yillik-izin?sekme=takvim&ay=${p}${dept ? `&bolum=${dept}` : ""}`;
  const groups = depts.map((d) => ({ d, emps: data.emps.filter((e) => e.department_id === d.id) })).filter((g) => g.emps.length);
  const none = data.emps.filter((e) => !e.department_id);
  if (!dept && none.length) groups.push({ d: { id: "", name: "Bölümsüz", leave_max_pct: null, leave_max_people: null }, emps: none });
  return (
    <Card title={`${periodLabel(month)} izin takvimi`} action={
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Link href={nav(previousPeriod(month))} className="h-9 px-3 rounded-lg border border-[#D5DEE8] grid place-items-center" aria-label="Önceki ay">‹</Link>
        <Link href={nav(nextPeriod(month))} className="h-9 px-3 rounded-lg border border-[#D5DEE8] grid place-items-center" aria-label="Sonraki ay">›</Link>
        <form className="flex gap-2"><input type="hidden" name="sekme" value="takvim" /><input type="hidden" name="ay" value={month} />
          <select name="bolum" defaultValue={dept ?? ""} className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2" aria-label="Bölüm"><option value="">Tüm bölümler</option>{data.depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <button className="h-9 px-3 rounded-lg border border-[#D5DEE8] font-semibold text-brand-700">Göster</button></form>
      </div>}>
      <style>{`.bg-stripes{background-image:repeating-linear-gradient(45deg,transparent 0 3px,rgba(255,255,255,.7) 3px 6px)}`}</style>
      <div className="flex flex-wrap gap-3 text-xs text-muted">{LEGEND.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className={`inline-block w-4 h-3 rounded-sm ${c}`} />{l}</span>)}</div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="text-[11px] border-separate border-spacing-0 min-w-max">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left px-2 py-1 min-w-[150px] font-semibold text-muted">Personel</th>
              {days.map((d) => <th key={d} className={`w-7 text-center font-semibold ${wd(d) === 0 || data.hol.get(d) === false ? "text-[#B8C2CE]" : d === today ? "text-white bg-brand-700 rounded" : "text-muted"}`}>{Number(d.slice(8))}<div className="font-normal">{"PzPtSaÇaPeCuCt".slice(wd(d) * 2, wd(d) * 2 + 2)}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ d, emps }) => {
              const limit = deptLimit(emps.length, d.leave_max_pct, d.leave_max_people);
              const count = days.map((day) => new Set(rows.filter((r) => r.code !== "RAPOR" && r.start_date <= day && r.end_date >= day && emps.some((e) => e.id === r.employee_id)).map((r) => r.employee_id)).size);
              return [
                <tr key={`h${d.id}`}><td colSpan={dim + 1} className="sticky left-0 bg-[#F2F6FB] px-2 py-1.5 font-semibold text-brand-800 text-xs">{d.name} <span className="font-normal text-muted">· {emps.length} kişi{limit !== null ? ` · sınır ${limit}` : ""}</span></td></tr>,
                ...emps.map((e) => (
                  <tr key={e.id}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-0.5 whitespace-nowrap border-b border-[#F1F4F8]"><Link href={`/yillik-izin/${e.id}`} className="text-brand-700">{e.first_name} {e.last_name}</Link></td>
                    {days.map((day) => {
                      const r = rows.find((x) => x.employee_id === e.id && x.start_date <= day && x.end_date >= day);
                      const p = !r && planned.some((x) => x.employee_id === e.id && x.start_date <= day && x.end_date >= day);
                      const off = wd(day) === 0 || data.hol.get(day) === false;
                      const cls = r ? (r.status === "pending" ? "bg-[#9BD3B5] bg-stripes" : COLOR[r.code] ?? "bg-[#5B8DEF]") : p ? "border-2 border-dashed border-[#2E9D6A]" : off ? "bg-[#F1F4F8]" : "";
                      return <td key={day} className="p-[1px] border-b border-[#F1F4F8]"><div title={r ? `${r.name}${r.status === "pending" ? " (onay bekliyor)" : ""}` : p ? "Plan" : undefined} className={`h-5 w-6 rounded-[3px] ${cls}`} /></td>;
                    })}
                  </tr>
                )),
                <tr key={`c${d.id}`}><td className="sticky left-0 z-10 bg-white px-2 py-1 text-muted border-b border-line">İzinli</td>{count.map((c, i) => <td key={i} className={`text-center border-b border-line num ${limit !== null && c > limit ? "text-white bg-bad font-bold rounded" : c ? "text-ink font-semibold" : "text-[#C5CED9]"}`}>{c || "·"}</td>)}</tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Kırmızı sayı: o gün bölüm sınırı aşılıyor. Rapor sınır hesabına katılmaz.</p>
    </Card>
  );
}
