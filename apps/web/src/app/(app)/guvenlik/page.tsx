import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { visNo } from "@/lib/visitor";
import { saveGuard } from "@/lib/visitor-actions";
import { GuardPanel, type V } from "./GuardPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Güvenlik paneli" };

/** Güvenlik görevlisi paneli: ziyaretçi giriş-çıkış, içeridekiler, beklenenler, günlük rapor */
export default async function GuardPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isGuard, error: e0 } = await supabase.rpc("vis_is_guard");
  if (!isGuard && !e0) redirect("/ziyaretci");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00+03:00`).toISOString(), to = new Date(`${day}T23:59:59+03:00`).toISOString();
  const [{ data, error }, { data: dir }, { data: guards }] = await Promise.all([
    supabase.from("vis_visits").select("id, year, no, visitor_name, visitor_company, host_user, purpose, status, expected_at, checked_in_at, checked_out_at, badge_no, plate, photo, token")
      .or(`status.eq.in,and(status.eq.expected,expected_at.lte.${to}),and(checked_in_at.gte.${from},checked_in_at.lte.${to}),and(status.eq.expected,expected_at.is.null)`).order("checked_in_at", { ascending: false, nullsFirst: false }).limit(300),
    supabase.rpc("company_directory"),
    supabase.from("vis_guards").select("user_id, is_active"),
  ]);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const visits: V[] = ((data ?? []) as (Omit<V, "no" | "host"> & { year: number; no: number; host_user: string | null })[]).map((v) => ({ ...v, no: visNo(v), host: v.host_user ? names.get(v.host_user) ?? null : null }));
  const isAdmin = ["owner", "hr"].includes(s.role);
  return (
    <>
      <PageHeader title="Güvenlik paneli" subtitle="Ziyaretçi giriş-çıkışı · QR davetiye, ziyaretçi kartı, fotoğraf · ev sahibine anında bildirim" actions={<PrintButton />} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1400px]">
        {(error || e0) && <Notice tone="bad">Supabase&apos;de 20270110000000_visitors.sql çalıştırılmalı.</Notice>}
        <GuardPanel visits={visits} hosts={(dir ?? []) as { user_id: string; display_name: string }[]} />
        {isAdmin && (
          <details className="rounded-[16px] border border-line bg-white p-4 print:hidden">
            <summary className="cursor-pointer font-semibold">Güvenlik görevlileri</summary>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {((guards ?? []) as { user_id: string }[]).map((g) => (
                <li key={g.user_id} className="flex items-center gap-3"><b className="flex-1">{names.get(g.user_id) ?? g.user_id}</b>
                  <form action={saveGuard}><input type="hidden" name="user_id" value={g.user_id} /><input type="hidden" name="remove" value="1" /><button className="text-xs font-semibold text-bad">Kaldır</button></form></li>
              ))}
            </ul>
            <form action={saveGuard} className="mt-3 flex gap-2">
              <select name="user_id" className="h-11 flex-1 rounded-[10px] border border-[#D5DEE8] px-2 text-sm"><option value="">Kullanıcı seçin</option>{((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}</select>
              <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Görevli ekle</button>
            </form>
            <p className="mt-2 text-xs text-muted">Sahip, İK ve şube müdürleri paneli her zaman kullanabilir. Güvenlik görevlisinin hesabı “personel” türündeyse menüde Güvenlik paneli görünür.</p>
          </details>
        )}
      </div>
    </>
  );
}
