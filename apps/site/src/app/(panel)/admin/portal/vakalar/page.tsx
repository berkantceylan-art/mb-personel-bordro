import Link from "next/link";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { CASE_STATUSES, PORTAL_UI, STATUS_CLS, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal vakaları" };

export default async function LabCases({ searchParams }: { searchParams: Promise<{ durum?: string; q?: string }> }) {
  const { durum = "acik", q = "" } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: accs }] = await Promise.all([
    supabase.from("portal_cases").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("portal_accounts").select("id, name, company"),
  ]);
  const accounts = Object.fromEntries(((accs ?? []) as { id: string; name: string; company: string | null }[]).map((a) => [a.id, a.company || a.name]));
  const all = (data ?? []) as PortalCase[];
  const term = q.trim().toLocaleLowerCase("tr");
  const rows = all.filter((c) => {
    if (durum === "acik" && ["delivered", "cancelled"].includes(c.status)) return false;
    if (durum !== "acik" && durum !== "hepsi" && c.status !== durum) return false;
    if (term && !`${c.no} ${c.patient_ref} ${accounts[c.account_id] ?? ""}`.toLocaleLowerCase("tr").includes(term)) return false;
    return true;
  });
  const ui = PORTAL_UI.tr;
  const tabs: [string, string][] = [["acik", "Açık"], ...CASE_STATUSES.map((s) => [s, ui.statuses[s]] as [string, string]), ["hepsi", "Tümü"]];

  return (
    <>
      <PageHead title="Portal vakaları" lead="Hekim, klinik ve aracı kuruluşlardan gelen vakalar." />
      <Flash hata={error ? "Portal tabloları henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Durum" className="flex flex-wrap gap-1.5 text-xs">
          {tabs.map(([k, label]) => (
            <Link
              key={k}
              href={`/admin/portal/vakalar?durum=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={durum === k ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${durum === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/admin/portal/vakalar" className="flex gap-2">
          <input type="hidden" name="durum" value={durum} />
          <input name="q" defaultValue={q} placeholder="No, hasta kodu, hekim" aria-label="Ara" className="field w-56" />
          <button type="submit" className="rounded-full border border-gypsum bg-white px-4 text-sm font-semibold text-navy hover:border-navy">
            Ara
          </button>
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Vaka yok.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gypsum bg-white">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-gypsum text-xs uppercase tracking-wide text-slate">
              <tr>
                <th className="px-4 py-3">No</th>
                <th className="px-4 py-3">Hekim / kurum</th>
                <th className="px-4 py-3">Hasta</th>
                <th className="px-4 py-3">Dişler</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">İstenen</th>
                <th className="px-4 py-3">Geldi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gypsum">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-porcelain">
                  <td className="px-4 py-3">
                    <Link href={`/admin/portal/vaka/${c.id}`} className="num font-semibold text-navy hover:underline">
                      #{c.no}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-3">{accounts[c.account_id] ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold">{c.patient_ref}</td>
                  <td className="num px-4 py-3 text-slate">{c.teeth?.join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLS[c.status]}`}>{ui.statuses[c.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate">{c.due_date ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate">{formatTr(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
