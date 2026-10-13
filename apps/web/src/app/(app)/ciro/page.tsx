import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";
import { setRevenueViewer } from "@/lib/revenue-actions";
import { RevenueView, type RevParams } from "./RevenueView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Müşteri ciroları" };

/** Hekim, klinik, hastane, aracı kurum: günlük / aylık / iki tarih arası ciro */
export default async function RevenuePage({ searchParams }: { searchParams: Promise<RevParams> }) {
  const s = await getSession();
  if ((s.modules.revenue ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const owner = s.role === "owner";
  const [{ data: members }, { data: viewers }] = owner
    ? await Promise.all([
        supabase.from("memberships").select("user_id, display_name, role, is_boss").eq("company_id", s.companyId).order("display_name"),
        supabase.from("rev_viewers").select("user_id"),
      ])
    : [{ data: [] }, { data: [] }];
  const on = new Set(((viewers ?? []) as { user_id: string }[]).map((v) => v.user_id));
  const people = ((members ?? []) as { user_id: string; display_name: string | null; role: string; is_boss: boolean }[]).filter((m) => m.user_id !== s.userId && m.role !== "owner");
  return (
    <>
      <PageHeader title="Müşteri ciroları" subtitle="Hekim, klinik, hastane ve aracı kurumların günlük, aylık ya da iki tarih arası cirosu" />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1320px]">
        <RevenueView sb={supabase} today={todayIso()} p={sp} base="/ciro" />
        {owner && (
          <details className="bg-white border border-line rounded-[16px] p-4">
            <summary className="font-display font-semibold text-brand-800 cursor-pointer">🔐 Bu ekranı kimler görebilir? ({on.size} kişi + siz{people.some((p) => p.is_boss) ? " + patron ekranı yetkilileri" : ""})</summary>
            <p className="text-xs text-muted mt-2">Şirket sahibi ve patron ekranı yetkilileri her zaman görür. Aşağıdan istediğiniz kullanıcıya ayrıca açabilirsiniz; menüde &quot;Müşteri ciroları&quot; olarak görünür.</p>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {people.map((p) => (
                <li key={p.user_id}>
                  <form action={setRevenueViewer} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <input type="hidden" name="user" value={p.user_id} />
                    <input type="hidden" name="on" value={on.has(p.user_id) ? "0" : "1"} />
                    <span className="flex-1 truncate">{p.display_name || "—"}{p.is_boss && <span className="ml-1 text-[11px] text-muted">(patron)</span>}</span>
                    {p.is_boss ? <span className="text-xs text-ok font-semibold">görüyor</span> : <PendingSubmit className={`h-8 px-3 rounded-lg text-xs font-semibold ${on.has(p.user_id) ? "bg-ok text-white" : "border border-[#D5DEE8]"}`}>{on.has(p.user_id) ? "Açık ✓" : "Aç"}</PendingSubmit>}
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
