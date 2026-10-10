import Link from "next/link";
import { Flash, PageHead } from "@/components/admin/ui";
import { importTeamFromHr } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bordrodan aktar" };

type Row = { id: string; first_name: string; last_name: string; department_name: string | null; position_name: string | null; hire_date: string; team_id: string | null; team_active: boolean | null };

export default async function HrImportPage({ searchParams }: { searchParams: Promise<{ hata?: string }> }) {
  const { hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("site_hr_employees");
  const rows = (data ?? []) as Row[];
  const groups = [...new Set(rows.map((r) => r.department_name ?? "Departmansız"))];

  return (
    <>
      <PageHead title="Bordrodan aktar" lead="Bordro / İK yazılımındaki aktif çalışanları “Ekibimiz” sayfasına ekleyin. Yalnız ad, görev ve departman aktarılır; kimlik, iletişim ve ücret bilgileri asla siteye çıkmaz." />
      <Flash hata={hata ?? (error ? `Personel listesi okunamadı (SQL dosyası çalıştırılmalı): ${error.message}` : undefined)} />
      <div className="mb-5 rounded-2xl border border-warn/30 bg-warn-bg p-4 text-sm text-ink">
        <strong>KVKK:</strong> Çalışanın adını ve fotoğrafını sitede yayınlamak için açık rızası gerekir. Yalnız onay veren çalışanları seçin.
        Aktarılan kayıtlar bordrodaki kartla bağlı kalır: ad ve görev değişince sitede de güncellenir, çalışan ayrılınca sitede otomatik gizlenir.
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Aktif çalışan bulunamadı.</p>
      ) : (
        <form action={importTeamFromHr} className="grid gap-6">
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate">{g}</h2>
              <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
                {rows
                  .filter((r) => (r.department_name ?? "Departmansız") === g)
                  .map((r) => (
                    <li key={r.id}>
                      <label className={`flex items-center gap-4 px-5 py-3 ${r.team_id ? "opacity-60" : "cursor-pointer hover:bg-porcelain"}`}>
                        <input type="checkbox" name="employee" value={r.id} disabled={!!r.team_id} className="h-5 w-5 accent-navy" />
                        <span className="flex-1">
                          <span className="font-semibold text-ink">
                            {r.first_name} {r.last_name}
                          </span>
                          {r.position_name && <span className="text-sm text-slate"> · {r.position_name}</span>}
                        </span>
                        {r.team_id && (
                          <Link href={`/admin/ekip/${r.team_id}`} className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok">
                            {r.team_active ? "Sitede" : "Sitede (gizli)"}
                          </Link>
                        )}
                      </label>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <div className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-2xl border border-gypsum bg-white/95 p-4 shadow-lg backdrop-blur">
            <label className="mr-auto flex items-center gap-2 text-sm text-navy">
              <input type="checkbox" name="create_departments" defaultChecked className="h-4 w-4 accent-navy" />
              Sitede olmayan departmanları da oluştur
            </label>
            <Link href="/admin/ekip" className="px-3 py-2 font-semibold text-slate hover:text-navy">
              Vazgeç
            </Link>
            <button type="submit" className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
              Seçilenleri siteye ekle
            </button>
          </div>
        </form>
      )}
    </>
  );
}
