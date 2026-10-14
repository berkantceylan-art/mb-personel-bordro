import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { TaskAssign, type Person } from "@/components/admin/Tasks";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ACTION, LINK, ROLE, ago, clock } from "@/lib/admin-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kullanıcı 360°" };

type U360 = {
  user: string; name: string; role: string; is_boss: boolean; all_branches: boolean; site_access: boolean; logistics_access: boolean; member_since: string;
  user_type: string | null; email: string | null; last_sign_in: string | null; banned: boolean | null;
  employee: { id: string; name: string; status: string; title: string | null } | null;
  modules: Record<string, number>; n7: number; n30: number;
  by_group: Array<{ group: string; ins: number; upd: number; del: number }>;
  days: number[]; hours: number[];
  recent: Array<{ at: string; table: string; label: string; action: string; row: string | null; title: string | null }>;
  tasks: Array<{ id: string; title: string; due: string | null }>;
};
const MOD: Record<string, string> = { hr: "İK / personel", attendance: "Puantaj", payroll: "Bordro", safety: "İSG", lab: "Laboratuvar", finance: "Finans", sales: "Satış", purchases: "Satın alma", stock: "Stok", production: "Üretim", assets: "Demirbaş", expenses: "Masraf", users: "Kullanıcılar", ledger: "Genel muhasebe" };
const LVL = ["—", "Görür", "Kayıt girer", "Yönetir"];

/** Kullanıcı 360°: kimlik, yetkiler, etkinlik, son işlemler, açık görevler */
export default async function User360({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!(s.role === "owner" || (s.modules.users ?? 0) >= 3)) redirect("/yonetim");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data, error }, { data: ppl }] = await Promise.all([supabase.rpc("admin_user_360", { p_user: id }), supabase.rpc("audit_actor_names")]);
  if (error) {
    if (/not_member/.test(error.message)) notFound();
    return (<><PageHeader title="Kullanıcı 360°" /><div className="p-4 md:p-8"><p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/admin_user_360|does not exist/.test(error.message) ? "Supabase'de 20270127000000_admin_pulse.sql çalıştırılmalı." : error.message}</p></div></>);
  }
  const u = data as U360;
  const dmax = Math.max(1, ...u.days);
  const hmax = Math.max(1, ...u.hours);
  const night = u.hours.slice(0, 6).reduce((a, b) => a + b, 0) + u.hours.slice(22).reduce((a, b) => a + b, 0);
  const total = u.by_group.reduce((a, g) => a + g.ins + g.upd + g.del, 0);
  const del = u.by_group.reduce((a, g) => a + g.del, 0);
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr");

  return (
    <>
      <PageHeader title="Kullanıcı 360°" actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/yonetim/nabiz" className="text-brand-700">← Sistem nabzı</Link><Link href={`/yonetim/hareketler?kim=${u.user}`} className="text-brand-700">İşlem geçmişi</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1200px]">
        <section className="rounded-[20px] p-5 md:p-6 text-white bg-[radial-gradient(circle_at_100%_0%,rgba(59,130,246,.4),transparent_45%),linear-gradient(135deg,#0B1222,#16213E)] flex flex-wrap gap-5 items-center">
          <span className="w-16 h-16 rounded-2xl bg-white/10 grid place-items-center font-display text-2xl font-bold">{initials}</span>
          <div className="flex-1 min-w-[220px]">
            <b className="font-display text-2xl">{u.name}</b>
            <p className="text-sm text-white/70">{u.email} · {ROLE[u.role] ?? u.role}{u.user_type ? ` · ${u.user_type}` : ""}{u.is_boss ? " · Patron ekranı" : ""}</p>
            <p className="text-xs text-white/50 mt-1">Son giriş {ago(u.last_sign_in)} · üye {clock(u.member_since).slice(0, 5)}{u.employee ? ` · personel: ${u.employee.name}${u.employee.title ? ` (${u.employee.title})` : ""}` : ""}{u.banned ? " · 🔒 erişimi kapalı" : ""}</p>
          </div>
          {[["7 gün", u.n7], ["30 gün", u.n30], ["Silme", del], ["Mesai dışı", night]].map(([l, v]) => <div key={String(l)} className="text-center"><b className="font-display text-3xl num">{v}</b><span className="block text-[11px] text-white/60">{l}</span></div>)}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-3">
            <h2 className="font-display font-semibold text-brand-800">Son 30 gün etkinlik</h2>
            <div className="flex items-end gap-[3px] h-20">{u.days.map((v, i) => <span key={i} title={`${v} işlem`} className="flex-1 rounded-t bg-brand-600/80" style={{ height: `${Math.max(3, (v / dmax) * 100)}%`, opacity: v ? 1 : 0.15 }} />)}</div>
            <h3 className="text-xs text-muted">Saatlere göre (İstanbul)</h3>
            <div className="flex items-end gap-[2px] h-12">{u.hours.map((v, h) => <span key={h} title={`${h}:00 · ${v}`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (v / hmax) * 100)}%`, background: h < 6 || h >= 22 ? "#F59E0B" : "#6366F1", opacity: v ? 1 : 0.15 }} />)}</div>
            <div className="flex justify-between text-[10px] text-muted"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          </section>
          <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
            <h2 className="font-display font-semibold text-brand-800">Modüllere göre işlem <span className="text-xs font-normal text-muted">· {total}</span></h2>
            {u.by_group.map((g) => {
              const t = g.ins + g.upd + g.del;
              return (
                <div key={g.group} className="text-sm">
                  <div className="flex justify-between"><span>{g.group}</span><span className="text-xs text-muted">+{g.ins} · ✎{g.upd} · <span className={g.del ? "text-bad" : ""}>✕{g.del}</span></span></div>
                  <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden flex" style={{ width: `${Math.max(8, (t / Math.max(1, total)) * 100)}%` }}>
                    <span className="bg-[#10B981]" style={{ width: `${(g.ins / t) * 100}%` }} /><span className="bg-[#3B82F6]" style={{ width: `${(g.upd / t) * 100}%` }} /><span className="bg-[#EF4444]" style={{ width: `${(g.del / t) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {!u.by_group.length && <p className="text-sm text-muted">Son 30 günde işlem yok.</p>}
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <section className="bg-white border border-line rounded-[18px] overflow-hidden">
            <h2 className="px-4 py-3 border-b border-line font-display font-semibold text-brand-800">Son işlemler</h2>
            <ul className="divide-y divide-[#F1F5F9]">
              {u.recent.map((r, i) => {
                const [verb, col] = ACTION[r.action] ?? [r.action, "#94A3B8"];
                const href = r.row && r.action !== "DELETE" ? LINK[r.table]?.(r.row) : undefined;
                return (
                  <li key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                    <span className="flex-1 min-w-0 truncate"><span className="text-muted">{r.label} {verb}</span> {r.title && (href ? <Link href={href} className="text-brand-700 hover:underline">{r.title}</Link> : r.title)}</span>
                    <span className="text-xs text-muted shrink-0">{clock(r.at)}</span>
                  </li>
                );
              })}
              {!u.recent.length && <li className="px-4 py-8 text-center text-muted">Kayıtlı işlem yok.</li>}
            </ul>
          </section>
          <aside className="flex flex-col gap-5">
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">Yetkiler</h2>
              {u.role === "owner" ? <p className="text-sm text-muted">Şirket sahibi: tüm modüllerde tam yetki.</p> : (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {Object.entries(MOD).map(([k, l]) => { const v = u.modules[k] ?? 0; return <li key={k} className="flex justify-between"><span className={v ? "" : "text-muted"}>{l}</span><span className={`text-xs ${v >= 3 ? "text-brand-700 font-bold" : v ? "" : "text-muted"}`}>{LVL[v] ?? v}</span></li>; })}
                </ul>
              )}
              <p className="text-xs text-muted">{u.all_branches ? "Tüm şubeler" : "Kendi şubesi"}{u.site_access ? " · Site yönetimi" : ""}{u.logistics_access ? " · Lojistik" : ""}</p>
              <span className="flex gap-3 text-sm font-semibold"><Link href="/yonetim" className="text-brand-700">Yetkileri düzenle →</Link><Link href="/yonetim/goruntule" className="text-brand-700">👁 Onun gözünden</Link></span>
            </section>
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">Açık görevleri ({u.tasks.length})</h2>
              <ul className="text-sm flex flex-col gap-1">{u.tasks.map((t) => <li key={t.id}>📌 {t.title}{t.due ? <span className="text-xs text-muted"> · {t.due.split("-").reverse().join(".")}</span> : null}</li>)}</ul>
              <TaskAssign title="" people={((ppl ?? []) as Person[]).filter((p) => p.user_id === u.user)} />
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
