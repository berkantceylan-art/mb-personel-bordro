import Link from "next/link";
import { formatTL } from "@mb/core";
import { PageHeader, PrimaryLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession } from "@/lib/session";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ bolum?: string; q?: string }>;
}) {
  const { bolum, q } = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  const period = currentPeriod();

  let query = supabase
    .from("employees")
    .select("id, card_no, first_name, last_name, hire_date, status, department_id, departments(name), branches(name)")
    .order("first_name");
  if (bolum) query = query.eq("department_id", bolum);
  const term = (q ?? "").replace(/[,()%*\\]/g, "").trim();
  if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,card_no.ilike.%${term}%`);

  const [{ data: employees }, { data: departments }, { data: balances }] = await Promise.all([
    query,
    supabase.from("departments").select("id, name").order("name"),
    canManagePay(s.role)
      ? supabase.from("ledger_period_summary").select("employee_id, balance").eq("period", period)
      : Promise.resolve({ data: [] as Array<{ employee_id: string; balance: number }> }),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.employee_id, Number(b.balance ?? 0)]));

  return (
    <>
      <PageHeader
        title="Personel"
        subtitle={`${employees?.length ?? 0} kişi`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/ice-aktar" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Excel&apos;den aktar</Link>
            <PrimaryLink href="/personel/yeni">+ Yeni personel</PrimaryLink>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-4 max-w-[1240px]">
        <form className="flex flex-wrap gap-3">
          <input name="q" defaultValue={q} placeholder="Ad, soyad veya sicil ara" aria-label="Personel ara" className="h-11 flex-1 min-w-56 rounded-[10px] border border-[#D5DEE8] bg-white px-3.5" />
          <select name="bolum" defaultValue={bolum ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
            <option value="">Tüm bölümler</option>
            {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
        </form>

        <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-3 px-4 font-semibold border-b border-line">Ad soyad</th>
                <th className="py-3 px-4 font-semibold border-b border-line">Sicil</th>
                <th className="py-3 px-4 font-semibold border-b border-line">Bölüm</th>
                <th className="py-3 px-4 font-semibold border-b border-line">Şube</th>
                <th className="py-3 px-4 font-semibold border-b border-line">İşe giriş</th>
                {canManagePay(s.role) && <th className="py-3 px-4 font-semibold border-b border-line text-right">Bu ay kalan</th>}
              </tr>
            </thead>
            <tbody>
              {(employees ?? []).map((e) => (
                <tr key={e.id} className="hover:bg-[#F7F9FB]">
                  <td className="py-3 px-4 border-b border-[#EEF2F6]">
                    <Link href={`/personel/${e.id}`} className="font-semibold text-brand-700">{e.first_name} {e.last_name}</Link>
                    {e.status !== "active" && <span className="ml-2 text-xs text-muted">({e.status === "terminated" ? "ayrıldı" : "izinde"})</span>}
                  </td>
                  <td className="num py-3 px-4 border-b border-[#EEF2F6] text-muted">{e.card_no ?? "—"}</td>
                  <td className="py-3 px-4 border-b border-[#EEF2F6]">{(e.departments as unknown as { name: string } | null)?.name ?? "—"}</td>
                  <td className="py-3 px-4 border-b border-[#EEF2F6]">{(e.branches as unknown as { name: string } | null)?.name ?? "—"}</td>
                  <td className="num py-3 px-4 border-b border-[#EEF2F6]">{formatDate(e.hire_date)}</td>
                  {canManagePay(s.role) && <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right font-semibold">{bal.has(e.id) ? formatTL(bal.get(e.id)!) : "—"}</td>}
                </tr>
              ))}
              {(employees ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-muted">Personel bulunamadı.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
