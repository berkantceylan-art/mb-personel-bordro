import Link from "next/link";
import { redirect } from "next/navigation";
import { annualLeaveEntitlement } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { LeaveForm } from "@/components/LeaveOtForms";
import { addLeaveAdjustment, decideLeave } from "@/lib/leave-ot-actions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";

const STATUS: Record<string, [string, string]> = {
  pending: ["Onay bekliyor", "bg-warn-bg text-warn"],
  approved: ["Onaylandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ sekme?: string; personel?: string }> }) {
  await getSession();
  const sp = await searchParams;
  if (sp.sekme === "bakiye") redirect("/yillik-izin?sekme=bakiye");
  const tab = "talepler" as string;
  const supabase = await createClient();
  const [{ data: emps }, { data: types }, { data: requests }, { data: privs }, { data: adjs }, { data: usedRows }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, hire_date, departments(name)").eq("status", "active").order("first_name"),
    supabase.from("leave_types").select("id, code, name").order("sort_order"),
    supabase.from("leave_requests").select("id, employee_id, start_date, end_date, days, status, note, leave_types(name, code)").order("start_date", { ascending: false }).limit(200),
    supabase.from("employee_private").select("employee_id, birth_date"),
    supabase.from("leave_adjustments").select("employee_id, days"),
    supabase.from("leave_requests").select("employee_id, days, leave_types!inner(code)").eq("status", "approved").eq("leave_types.code", "YILLIK"),
  ]);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const birth = new Map((privs ?? []).map((p) => [p.employee_id, p.birth_date as string | null]));
  const adj = new Map<string, number>();
  for (const a of adjs ?? []) adj.set(a.employee_id, (adj.get(a.employee_id) ?? 0) + Number(a.days));
  const used = new Map<string, number>();
  for (const u of usedRows ?? []) used.set(u.employee_id, (used.get(u.employee_id) ?? 0) + Number(u.days));
  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const today = todayIso();
  const onLeaveToday = (requests ?? []).filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today);
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="İzin" subtitle={`${pending.length} onay bekleyen · bugün ${onLeaveToday.length} kişi izinli`} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <Card title="Yeni izin">
          <LeaveForm employees={(emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} types={types ?? []} defaultEmployee={sp.personel} />
        </Card>

        <div className="flex gap-1 border-b border-line" role="tablist">
          {[["talepler", "İzin kayıtları"], ["bakiye", "Yıllık izin bakiyeleri"]].map(([k, l]) => (
            <Link key={k} href={k === "bakiye" ? "/yillik-izin?sekme=bakiye" : `/izin?sekme=${k}`} role="tab" aria-selected={tab === k} className={`h-11 px-4 inline-flex items-center ${tab === k ? "font-bold text-brand-700 shadow-[inset_0_-3px_0_#00A6D6]" : "text-muted"}`}>{l}</Link>
          ))}
        </div>

        {tab === "talepler" ? (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tür</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Gün</th><th className={th}>Durum</th><th className={th}>Not</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {[...pending, ...(requests ?? []).filter((r) => r.status !== "pending")].map((r) => {
                  const [label, cls] = STATUS[r.status] ?? ["", ""];
                  return (
                    <tr key={r.id}>
                      <td className={`${td} font-semibold`}><Link href={`/personel/${r.employee_id}`} className="text-brand-700">{name.get(r.employee_id) ?? "—"}</Link></td>
                      <td className={td}>{(r.leave_types as unknown as { name: string } | null)?.name}</td>
                      <td className={`num ${td}`}>{formatDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}</td>
                      <td className={`num ${td} text-right`}>{Number(r.days).toLocaleString("tr-TR")}</td>
                      <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{label}</span></td>
                      <td className={`${td} text-muted`}>{r.note ?? ""}</td>
                      <td className={td}>
                        <div className="flex gap-2 justify-end">
                          {r.status === "pending" && (
                            <>
                              <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="approved" /><button className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Onayla</button></form>
                              <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="rejected" /><button className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-bad">Reddet</button></form>
                            </>
                          )}
                          {r.status === "approved" && (
                            <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="cancelled" /><button className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-muted">İptal et</button></form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(requests ?? []).length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">İzin kaydı yok.</td></tr>}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Bölüm</th><th className={th}>İşe giriş</th><th className={`${th} text-right`}>Kıdem</th><th className={`${th} text-right`}>Hak edilen</th><th className={`${th} text-right`}>Devreden / düzeltme</th><th className={`${th} text-right`}>Kullanılan</th><th className={`${th} text-right`}>Kalan</th><th className={th}>Sonraki hak</th><th className={th}>Devreden ekle</th></tr></thead>
              <tbody>
                {(emps ?? []).map((e) => {
                  const ent = annualLeaveEntitlement(e.hire_date, today, birth.get(e.id));
                  const a = adj.get(e.id) ?? 0;
                  const u = used.get(e.id) ?? 0;
                  const left = ent.earned + a - u;
                  return (
                    <tr key={e.id}>
                      <td className={`${td} font-semibold`}><Link href={`/personel/${e.id}`} className="text-brand-700">{e.first_name} {e.last_name}</Link></td>
                      <td className={td}>{(e.departments as unknown as { name: string } | null)?.name ?? "—"}</td>
                      <td className={`num ${td}`}>{formatDate(e.hire_date)}</td>
                      <td className={`num ${td} text-right`}>{ent.completedYears} yıl</td>
                      <td className={`num ${td} text-right`}>{ent.earned}</td>
                      <td className={`num ${td} text-right`}>{a ? a.toLocaleString("tr-TR") : "—"}</td>
                      <td className={`num ${td} text-right`}>{u.toLocaleString("tr-TR")}</td>
                      <td className={`num ${td} text-right font-bold ${left < 0 ? "text-bad" : ""}`}>{left.toLocaleString("tr-TR")}</td>
                      <td className={`num ${td} text-muted`}>{formatDate(ent.nextAnniversary)} · +{ent.nextYearDays}</td>
                      <td className={td}>
                        <form action={addLeaveAdjustment} className="flex gap-1.5">
                          <input type="hidden" name="employeeId" value={e.id} />
                          <input name="days" inputMode="decimal" placeholder="gün" aria-label={`${e.first_name} devreden gün`} className="h-9 w-16 rounded-md border border-[#D5DEE8] px-2" />
                          <button className="h-9 px-2 rounded-md border border-[#D5DEE8] text-xs font-semibold text-brand-700">Ekle</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted p-3">Hak edilen: işe girişten bugüne tamamlanan her kıdem yılı için 14 / 20 / 26 gün (18 yaş altı ve 50 yaş üstüne en az 20). Sistem öncesi kullanılmış veya devreden günleri &quot;Devreden ekle&quot; ile (eksi değer de girilebilir) düzeltin.</p>
          </section>
        )}
      </div>
    </>
  );
}
