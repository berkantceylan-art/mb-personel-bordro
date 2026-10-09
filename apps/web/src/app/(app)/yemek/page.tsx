import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { decideMeal, deleteMeal, requestMeal } from "./actions";

const STATUS: Record<string, [string, string]> = { pending: ["Onay bekliyor", "bg-warn-bg text-warn"], approved: ["Onaylandı", "bg-ok-bg text-ok"], rejected: ["Reddedildi", "bg-bad-bg text-bad"] };

/** Mesai yemeği: şef bölümü için kişi sayısı/isim girer, yönetim onaylar; mutfağa günlük toplam çıkar */
export default async function MealPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  const chief = ["owner", "hr", "branch_manager"].includes(s.role);
  const admin = ["owner", "hr"].includes(s.role);
  if (!chief && s.role !== "accountant") redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: reqs, error }, { data: emps }, { data: depts }, { data: myDepts }] = await Promise.all([
    supabase.from("meal_requests").select("id, department_id, on_date, head_count, employee_ids, note, status, decision_note, requested_by, created_at, departments(name)").gte("on_date", from).order("on_date", { ascending: false }).order("created_at"),
    supabase.from("employees").select("id, first_name, last_name, department_id").eq("status", "active").order("first_name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("membership_departments").select("department_id").eq("user_id", s.userId),
  ]);
  const myDeptIds = new Set((myDepts ?? []).map((d) => d.department_id as string));
  const deptList = (depts ?? []).filter((d) => myDeptIds.size === 0 || myDeptIds.has(d.id));
  const empName = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim()]));
  const selDate = sp.gun && /^\d{4}-\d{2}-\d{2}$/.test(sp.gun) ? sp.gun : today;
  // Günlük toplamlar (onaylı)
  const byDay = new Map<string, { approved: number; pending: number }>();
  for (const r of reqs ?? []) { const g = byDay.get(r.on_date) ?? { approved: 0, pending: 0 }; if (r.status === "approved") g.approved += r.head_count; if (r.status === "pending") g.pending += r.head_count; byDay.set(r.on_date, g); }
  const todayTot = byDay.get(today) ?? { approved: 0, pending: 0 };
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";
  const th = "py-2.5 px-3 font-semibold border-b border-line text-left";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";

  return (
    <>
      <PageHeader title="Mesai yemeği" subtitle={`Bugün onaylı ${todayTot.approved} kişi${todayTot.pending ? ` · ${todayTot.pending} kişi onay bekliyor` : ""}`} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        {error && <p className="text-sm text-bad bg-[#FDECEA] rounded-lg p-3">Mesai yemeği tablosu yok: Supabase&apos;de 20261102000000_chief_meal.sql çalıştırın.</p>}
        {chief && (
          <Card title="Yemek talebi gir" action={<span className="text-xs text-muted">Şef bölümü için girer, yönetim onaylar</span>}>
            <form action={requestMeal} className="flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-sm text-muted">Gün<input type="date" name="on_date" required defaultValue={selDate} className={input} /></label>
                <label className="flex flex-col gap-1 text-sm text-muted">Bölüm
                  <select name="department_id" required className={input}>{deptList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">Kişi sayısı<input type="number" name="head_count" min={1} placeholder="isim seçilirse otomatik" className={`${input} num`} /></label>
                <label className="flex flex-col gap-1 text-sm text-muted">Not<input name="note" placeholder="ör. 19:00'a kadar mesai" className={input} /></label>
              </div>
              <details>
                <summary className="text-sm font-semibold text-brand-700 cursor-pointer">Kimler yiyecek (isteğe bağlı isim seçimi)</summary>
                <div className="grid gap-1.5 grid-cols-2 md:grid-cols-4 mt-2 max-h-72 overflow-y-auto">
                  {(emps ?? []).filter((e) => myDeptIds.size === 0 || (e.department_id && myDeptIds.has(e.department_id))).map((e) => (
                    <label key={e.id} className="flex gap-2 items-center text-sm"><input type="checkbox" name="employee_id" value={e.id} className="w-4 h-4" />{empName.get(e.id)}</label>
                  ))}
                </div>
              </details>
              <div className="flex flex-wrap gap-3 items-center">
                <PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Talebi gönder</PendingSubmit>
                {admin && <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="approve" className="w-5 h-5" />Hemen onayla</label>}
              </div>
            </form>
          </Card>
        )}

        <Card title="Günlük toplamlar (mutfak için)">
          <div className="flex flex-wrap gap-2">
            {[...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([d, g]) => (
              <div key={d} className={`rounded-xl border px-3 py-2 text-sm ${d === today ? "border-brand-700 bg-[#F2F6FB]" : "border-[#D5DEE8]"}`}>
                <div className="text-xs text-muted">{formatDate(d)}{d === today ? " · bugün" : ""}</div>
                <div className="num"><b>{g.approved}</b> onaylı{g.pending ? <span className="text-warn"> · {g.pending} bekliyor</span> : null}</div>
              </div>
            ))}
            {byDay.size === 0 && <span className="text-sm text-muted">Son 14 günde talep yok.</span>}
          </div>
        </Card>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Gün</th><th className={th}>Bölüm</th><th className={`${th} text-right`}>Kişi</th><th className={th}>İsimler / not</th><th className={th}>Durum</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {(reqs ?? []).map((r) => {
                const [label, cls] = STATUS[r.status] ?? STATUS.pending!;
                const names = (r.employee_ids as string[]).map((i) => empName.get(i)).filter(Boolean).join(", ");
                return (
                  <tr key={r.id}>
                    <td className={`${td} num whitespace-nowrap`}>{formatDate(r.on_date)}</td>
                    <td className={td}>{(r.departments as unknown as { name: string } | null)?.name ?? "—"}</td>
                    <td className={`${td} num text-right font-semibold`}>{r.head_count}</td>
                    <td className={td}>{names || <span className="text-muted">isim girilmedi</span>}{r.note && <div className="text-xs text-muted">{r.note}</div>}{r.decision_note && <div className="text-xs text-muted">Karar: {r.decision_note}</div>}</td>
                    <td className={td}><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span></td>
                    <td className={`${td} text-right`}>
                      {r.status === "pending" && admin && (
                        <form action={decideMeal.bind(null, "approved")} className="flex gap-1 justify-end items-center">
                          <input type="hidden" name="id" value={r.id} />
                          <input name="note" placeholder="not" className="h-8 w-24 rounded-md border border-[#D5DEE8] px-2 text-xs" />
                          <button className="h-8 px-2.5 rounded-md bg-brand-700 text-white text-xs font-semibold">Onayla</button>
                          <button formAction={decideMeal.bind(null, "rejected")} className="h-8 px-2.5 rounded-md border border-[#D5DEE8] text-xs font-semibold text-bad">Reddet</button>
                        </form>
                      )}
                      {r.status === "pending" && !admin && r.requested_by === s.userId && (
                        <form action={deleteMeal}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Geri al" question="Talep silinsin mi?" /></form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(reqs ?? []).length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Talep yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
