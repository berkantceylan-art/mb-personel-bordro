import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { visNo } from "@/lib/visitor";
import { saveGuard } from "@/lib/visitor-actions";
import { GuardPanel, type V } from "./GuardPanel";
import { DecideForm } from "../ziyaretci/DecideForm";
import Link from "next/link";

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
  const { data: wk } = await supabase.from("vis_visits").select("id, year, no, visitor_name, visitor_company, phone, purpose, visitor_type, visitor_count, plate, created_at, host_target, vis_hosts(label)")
    .eq("status", "requested").eq("source", "walkin").gte("created_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("created_at");
  const walkins = (wk ?? []) as unknown as Array<{ id: string; year: number; no: number; visitor_name: string; visitor_company: string | null; phone: string | null; purpose: string | null; visitor_type: string | null; visitor_count: number; plate: string | null; created_at: string; vis_hosts: { label: string } | null }>;
  const VT: Record<string, string> = { supplier: "📦 Tedarikçi", customer: "🤝 Müşteri", doctor: "🦷 Hekim / klinik", other: "👤 Diğer" };
  const nowLocal = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const visits: V[] = ((data ?? []) as (Omit<V, "no" | "host"> & { year: number; no: number; host_user: string | null })[]).map((v) => ({ ...v, no: visNo(v), host: v.host_user ? names.get(v.host_user) ?? null : null }));
  const isAdmin = ["owner", "hr"].includes(s.role);
  return (
    <>
      <PageHeader title="Güvenlik paneli" subtitle="Ziyaretçi giriş-çıkışı · QR davetiye, ziyaretçi kartı, fotoğraf · ev sahibine anında bildirim" actions={<span className="flex items-center gap-3"><Link href="/ziyaretci/kapi-afisi" className="text-sm font-semibold text-brand-700 print:hidden">🖨 Kapı QR afişi</Link><Link href="/z/kapi" target="_blank" className="text-sm font-semibold text-brand-700 print:hidden">📝 Kapıda kayıt formu</Link><PrintButton /></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1400px]">
        {(error || e0) && <Notice tone="bad">Supabase&apos;de 20270110000000_visitors.sql çalıştırılmalı.</Notice>}
        {walkins.length > 0 && (
          <section className="rounded-[16px] border-2 border-[#F59E0B] bg-[#FFFBEB] p-4 print:hidden">
            <h2 className="font-display text-lg font-bold text-[#92400E]">🚪 Kapıda onay bekleyen randevusuz ziyaretçi ({walkins.length})</h2>
            <p className="mb-3 text-xs text-[#92400E]">Ziyaretçi bilgilerini telefondan girdi. Görüşeceği kişiyi arayıp onaylayın; onaylanınca ziyaretçinin telefonunda QR çıkar, okutup içeri alın.</p>
            <ul className="flex flex-col gap-3">
              {walkins.map((w) => (
                <li key={w.id} className="rounded-[12px] border border-line bg-white p-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <b className="text-base">{w.visitor_name}</b>{w.visitor_company && <span className="text-sm text-muted">· {w.visitor_company}</span>}
                    {w.visitor_type && <span className="text-xs font-semibold rounded-full bg-[#EEF4FB] px-2 py-0.5">{VT[w.visitor_type] ?? w.visitor_type}</span>}
                    <span className="ml-auto font-mono text-xs text-muted">{visNo(w)} · {Math.max(0, Math.round((Date.now() - new Date(w.created_at).getTime()) / 60000))} dk önce</span>
                  </div>
                  <p className="text-sm text-muted">{[w.vis_hosts?.label ? `Görüşeceği: ${w.vis_hosts.label}` : "Kimi göreceği seçilmedi", w.purpose, w.visitor_count > 1 ? `${w.visitor_count} kişi` : null, w.plate ? `plaka ${w.plate}` : null].filter(Boolean).join(" · ")}{w.phone && <> · <a href={`tel:${w.phone.replace(/\s/g, "")}`} className="font-semibold text-brand-700">{w.phone}</a></>}</p>
                  <DecideForm id={w.id} at={nowLocal} />
                </li>
              ))}
            </ul>
          </section>
        )}
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
