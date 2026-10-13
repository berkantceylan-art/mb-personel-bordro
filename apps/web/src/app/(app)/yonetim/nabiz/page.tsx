import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ACTION, LINK, ROLE, ago, clock } from "@/lib/admin-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sistem nabzı" };

type Anomaly = { key: string; sev: "high" | "medium"; title: string; hint: string; count: number; rows: Array<{ actor?: string; name: string; count?: number; table?: string; action?: string; at?: string; last?: string; no?: string; row?: string }> };
type Pulse = {
  feed: Array<{ id: number; at: string; actor: string | null; name: string; table: string; label: string; group: string; action: string; row: string | null; title: string | null }>;
  today: number; active_today: number; anomalies: Anomaly[];
  heat: Array<{ d: number; h: number; n: number }>;
  modules: Array<{ group: string; n: number; users: number; days: number[] }>;
  users: Array<{ user: string; name: string; role: string; email: string; last_sign_in: string | null; n7: number; n30: number; last: string | null; deletes: number }>;
};
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Sistem nabzı: canlı işlem akışı, anomali uyarıları, kullanım ısı haritası, kullanıcı etkinliği */
export default async function Pulse() {
  const s = await getSession();
  if (!(s.role === "owner" || (s.modules.users ?? 0) >= 3)) redirect("/yonetim");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_pulse");
  if (error) return (<><PageHeader title="Sistem nabzı" /><div className="p-4 md:p-8"><p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/admin_pulse|does not exist/.test(error.message) ? "Supabase'de 20270127000000_admin_pulse.sql çalıştırılmalı." : error.message}</p></div></>);
  const p = data as Pulse;
  const heat = new Map(p.heat.map((x) => [`${x.d}-${x.h}`, x.n]));
  const hmax = Math.max(1, ...p.heat.map((x) => x.n));
  const mmax = Math.max(1, ...p.modules.map((m) => m.n));
  const idle = p.users.filter((u) => !u.last_sign_in || Date.now() - new Date(u.last_sign_in).getTime() > 30 * 86400000);

  return (
    <>
      <PageHeader title="Sistem nabzı" subtitle="Kim, ne zaman, ne yapıyor: canlı akış ve olağan dışı hareketler" actions={<Link href="/yonetim/kontrol" className="text-sm font-semibold text-brand-700">← Kontrol Merkezi</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1320px]">
        <section className="rounded-[20px] p-5 text-white bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,.35),transparent_40%),linear-gradient(135deg,#0B1222,#1E1B4B)] flex flex-wrap gap-6 items-center">
          {[["Bugünkü işlem", p.today], ["Bugün aktif kullanıcı", p.active_today], ["Anomali (24 sa)", p.anomalies.length], ["30+ gündür girmeyen", idle.length]].map(([l, v]) => (
            <div key={String(l)}><b className="font-display text-4xl num">{v}</b><span className="block text-xs text-white/60">{l}</span></div>
          ))}
          <span className="ml-auto"><AutoRefresh seconds={30} /></span>
        </section>

        {p.anomalies.length > 0 && (
          <section className="grid gap-3 md:grid-cols-2">
            {p.anomalies.map((a) => (
              <div key={a.key} className={`rounded-[16px] border p-4 ${a.sev === "high" ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#FCD34D] bg-[#FFFBEB]"}`}>
                <b className={`text-sm ${a.sev === "high" ? "text-[#B91C1C]" : "text-[#B45309]"}`}>{a.sev === "high" ? "🚨" : "⚠️"} {a.title}</b>
                <p className="text-xs text-muted">{a.hint}</p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {a.rows.slice(0, 6).map((r, i) => (
                    <li key={i} className="flex gap-2">
                      {r.actor ? <Link href={`/yonetim/kullanici/${r.actor}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link> : <b>{r.name}</b>}
                      <span className="flex-1 text-muted truncate">{r.count ? `${r.count} işlem` : ""}{r.table ? ` ${r.table}` : ""}{r.action ? ` ${ACTION[r.action]?.[0] ?? r.action}` : ""}{r.no ? ` #${r.no}` : ""}</span>
                      {(r.at || r.last) && <span className="text-xs text-muted">{clock((r.at ?? r.last)!)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <section className="bg-white border border-line rounded-[18px] overflow-hidden">
            <h2 className="px-4 py-3 border-b border-line font-display font-semibold text-brand-800 flex">Canlı işlem akışı<Link href="/yonetim/hareketler" className="ml-auto text-xs font-semibold text-brand-700">Tüm geçmiş →</Link></h2>
            <ol className="relative px-4 py-2">
              {p.feed.map((f) => {
                const [verb, col] = ACTION[f.action] ?? [f.action, "#94A3B8"];
                const href = f.row && f.action !== "DELETE" ? LINK[f.table]?.(f.row) : undefined;
                return (
                  <li key={f.id} className="flex gap-3 py-2 border-b border-[#F1F5F9] last:border-0">
                    <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: col, boxShadow: `0 0 0 3px ${col}22` }} />
                    <div className="flex-1 min-w-0 text-sm">
                      {f.actor ? <Link href={`/yonetim/kullanici/${f.actor}`} className="font-semibold text-brand-800 hover:underline">{f.name}</Link> : <b>Sistem</b>}{" "}
                      <span className="text-muted">{f.label.toLocaleLowerCase("tr")} {verb}</span>{" "}
                      {f.title && (href ? <Link href={href} className="text-brand-700 hover:underline">{f.title}</Link> : <span className="text-ink">{f.title}</span>)}
                      <span className="block text-[11px] text-muted">{f.group} · {ago(f.at)}</span>
                    </div>
                  </li>
                );
              })}
              {!p.feed.length && <li className="py-8 text-center text-muted text-sm">Henüz kayıtlı işlem yok.</li>}
            </ol>
          </section>

          <aside className="flex flex-col gap-5">
            <section className="bg-white border border-line rounded-[18px] p-4">
              <h2 className="font-display font-semibold text-brand-800 mb-2">Kullanım ısı haritası <span className="text-xs font-normal text-muted">· son 28 gün</span></h2>
              <div className="overflow-x-auto">
                <table className="text-[9px] text-muted border-separate border-spacing-[2px]">
                  <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="font-normal w-3">{h % 3 === 0 ? h : ""}</th>)}</tr></thead>
                  <tbody>
                    {DAYS.map((d, i) => (
                      <tr key={d}><th className="font-normal pr-1 text-left">{d}</th>
                        {Array.from({ length: 24 }, (_, h) => {
                          const n = heat.get(`${i + 1}-${h}`) ?? 0;
                          return <td key={h} title={`${d} ${h}:00 · ${n} işlem`} className="w-3 h-3 rounded-[3px]" style={{ background: n ? `rgba(79,70,229,${0.15 + (n / hmax) * 0.85})` : "#F1F5F9" }} />;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">Modül kullanımı <span className="text-xs font-normal text-muted">· 30 gün</span></h2>
              {p.modules.map((m) => {
                const dm = Math.max(1, ...m.days);
                return (
                  <div key={m.group} className="flex items-center gap-2 text-sm">
                    <span className="w-28 truncate">{m.group}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(m.n / mmax) * 100}%` }} /></div>
                    <svg viewBox="0 0 56 14" className="w-14 h-3.5" aria-hidden><polyline points={m.days.map((v, i) => `${i * 4.3},${13 - (v / dm) * 12}`).join(" ")} fill="none" stroke="#6366F1" strokeWidth="1.2" /></svg>
                    <b className="num w-10 text-right">{m.n}</b>
                  </div>
                );
              })}
              {!p.modules.length && <p className="text-sm text-muted">Veri yok.</p>}
            </section>
          </aside>
        </div>

        <section className="bg-white border border-line rounded-[18px] overflow-hidden">
          <h2 className="px-4 py-3 border-b border-line font-display font-semibold text-brand-800">Kullanıcılar <span className="text-sm font-normal text-muted">· {p.users.length}</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Kullanıcı</th><th className="p-3">Rol</th><th className="p-3">Son giriş</th><th className="p-3">Son işlem</th><th className="p-3 text-right">7 gün</th><th className="p-3 text-right">30 gün</th><th className="p-3 text-right">Silme</th></tr></thead>
              <tbody>
                {p.users.map((u) => {
                  const stale = !u.last_sign_in || Date.now() - new Date(u.last_sign_in).getTime() > 30 * 86400000;
                  return (
                    <tr key={u.user} className="border-t border-[#EEF2F6] hover:bg-[#FAFBFD]">
                      <td className="p-3"><Link href={`/yonetim/kullanici/${u.user}`} className="font-semibold text-brand-800 hover:underline">{u.name}</Link><span className="block text-xs text-muted">{u.email}</span></td>
                      <td className="p-3 text-xs">{ROLE[u.role] ?? u.role}</td>
                      <td className={`p-3 text-xs ${stale ? "text-bad font-semibold" : "text-muted"}`}>{ago(u.last_sign_in)}</td>
                      <td className="p-3 text-xs text-muted">{ago(u.last)}</td>
                      <td className="p-3 text-right num">{u.n7}</td>
                      <td className="p-3 text-right num">{u.n30}</td>
                      <td className={`p-3 text-right num ${u.deletes >= 10 ? "text-bad font-bold" : ""}`}>{u.deletes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
