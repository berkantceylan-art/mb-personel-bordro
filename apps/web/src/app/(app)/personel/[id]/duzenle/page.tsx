import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { EmployeeForm } from "../../EmployeeForm";
import { reactivateEmployee, terminateEmployee } from "../../employee-actions";
import { DeleteEmployeeForm } from "./DeleteEmployeeForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect(`/personel/${id}`);
  const supabase = await createClient();
  const [{ data: e }, { data: p }, { data: branches }, { data: departments }] = await Promise.all([
    supabase.from("employees").select("*").eq("id", id).maybeSingle(),
    supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  if (!e) notFound();

  return (
    <>
      <PageHeader
        title={`${e.first_name} ${e.last_name} — düzenle`}
        actions={<Link href={`/personel/${id}`} className="text-sm font-semibold text-brand-700">← Profile dön</Link>}
      />
      <div className="p-6 md:p-8 max-w-5xl flex flex-col gap-6">
        <EmployeeForm values={{ ...(p ?? {}), ...e }} branches={branches ?? []} departments={departments ?? []} isNew={false} />

        <section className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">İşten çıkış</h2>
          {e.status === "terminated" ? (
            <form action={reactivateEmployee} className="flex flex-wrap gap-3 items-center text-sm">
              <input type="hidden" name="id" value={id} />
              <span>{e.termination_date ? formatDate(e.termination_date) : ""} tarihinde işten çıkarıldı{e.termination_reason ? ` (${e.termination_reason})` : ""}.</span>
              <button className="h-10 px-4 rounded-lg border border-[#D5DEE8] font-semibold text-brand-700">Yeniden aktif yap</button>
            </form>
          ) : (
            <form action={terminateEmployee} className="flex flex-wrap gap-3 items-end">
              <input type="hidden" name="id" value={id} />
              <label className="flex flex-col gap-1.5 text-sm text-muted">Çıkış tarihi<input type="date" name="termination_date" required defaultValue={todayIso()} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
              <label className="flex flex-col gap-1.5 text-sm text-muted flex-1 min-w-56">Çıkış nedeni<input name="termination_reason" placeholder="ör. İstifa" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
              <ConfirmSubmit label="İşten çıkar" question="Personel işten çıkarılsın mı?" className="h-11 px-5 rounded-[10px] border border-[#B42318] text-[#B42318] font-semibold" />
            </form>
          )}
          <p className="text-xs text-muted">İşten çıkarılan personelin geçmiş kayıtları korunur; çıkış ayında çalıştığı gün kadar hakediş yazılır.</p>
        </section>

        {s.role === "owner" && (
          <section className="bg-white border border-[#F3C9C5] rounded-2xl p-5 flex flex-col gap-3">
            <h2 className="font-display font-semibold text-bad">Personeli sil</h2>
            <p className="text-sm text-muted">Sadece yanlışlıkla açılmış, hiç cari hareketi olmayan kayıtlar silinebilir.</p>
            <DeleteEmployeeForm id={id} />
          </section>
        )}
      </div>
    </>
  );
}
