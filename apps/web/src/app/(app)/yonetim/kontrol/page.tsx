import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { MIGRATION_MANIFEST } from "@/lib/migration-manifest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontrol Merkezi" };

type Check = { key: string; area: string; sev: "high" | "medium" | "low"; title: string; hint: string; fix: string; count: number | null; error?: string; sample?: Array<{ id: string; label: string; link: string }> };
type Res = { score: number; issues: number; checks: Check[]; history: Array<{ day: string; score: number; issues: number }> };

const AREAS: Array<[string, string, string]> = [
  ["personel", "Personel / özlük", "👥"], ["bordro", "Bordro / ödeme", "💸"], ["puantaj", "Puantaj / izin", "⏱"], ["finans", "Finans", "🏦"],
  ["lab", "Laboratuvar", "🦷"], ["stok", "Stok", "📦"], ["guvenlik", "Güvenlik", "🛡"], ["veri", "Veri kalitesi", "🧬"], ["kurulum", "Kurulum", "⚙️"],
];
const SEV: Record<string, [string, string, string]> = { high: ["Kritik", "#DC2626", "bg-[#FEE2E2] text-[#B91C1C]"], medium: ["Önemli", "#F59E0B", "bg-[#FEF3C7] text-[#B45309]"], low: ["Bilgi", "#3B82F6", "bg-[#DBEAFE] text-[#1D4ED8]"] };

function grade(s: number): [string, string] {
  return s >= 90 ? ["Mükemmel", "#10B981"] : s >= 75 ? ["İyi", "#22C55E"] : s >= 50 ? ["Dikkat", "#F59E0B"] : ["Kritik", "#EF4444"];
}

/** Kontrol Merkezi: tüm sistemi tarayan denetimler, sağlık skoru, eksik SQL güncellemeleri, bağlantılar */
export default async function ControlCenter() {
  const s = await getSession();
  if (!(s.role === "owner" || (s.modules.users ?? 0) >= 3)) redirect("/yonetim");
  const supabase = await createClient();
  const [{ data, error }, { data: miss, error: missErr }] = await Promise.all([
    supabase.rpc("admin_checks"),
    supabase.rpc("admin_schema_missing", { p_objects: MIGRATION_MANIFEST.map(([, o]) => o) }),
  ]);
  if (error) {
    return (
      <>
        <PageHeader title="Kontrol Merkezi" />
        <div className="p-4 md:p-8"><p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/admin_checks|does not exist/.test(error.message) ? "Supabase'de 20270125000000_admin_center.sql çalıştırılmalı." : error.message}</p></div>
      </>
    );
  }
  const r = data as Res;
  const missingObjs = new Set((missErr ? [] : (miss as string[] | null)) ?? []);
  const missingFiles = MIGRATION_MANIFEST.filter(([, o]) => missingObjs.has(o)).map(([f]) => f);
  const env = (k: string) => !!process.env[k];
  const integrations: Array<[string, boolean, string]> = [
    ["Yapay zekâ (Anthropic)", env("ANTHROPIC_API_KEY"), "Özlük taraması, asistan, e-posta özetleri"],
    ["Gmail bağlantısı", env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"), "Posta, tedarikçiye sipariş e-postası"],
    ["WhatsApp Business", env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"), "WhatsApp İK, sipariş ve randevu bildirimleri"],
    ["WhatsApp onaylı şablon", env("WHATSAPP_TEMPLATE"), "24 saat dışında otomatik mesaj"],
    ["SGK robotu", env("SGK_CRED_KEY"), "İşe giriş / çıkış, vizite"],
    ["Otomatik görevler (cron)", env("CRON_SECRET"), "Sabah / akşam hatırlatmaları, sipariş gönderimi"],
    ["Sunucu anahtarı", env("SUPABASE_SERVICE_ROLE_KEY"), "Hesap açma, görüntüleme, dosya temizliği"],
    ["Telefon bildirimleri", env("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"), "Uygulama bildirimleri"],
    ["Site ↔ ERP adresleri", env("NEXT_PUBLIC_SITE_URL") && env("NEXT_PUBLIC_ERP_URL"), "Tek giriş, portal ve bağlantılar"],
  ];
  const setupIssues = (missingFiles.length ? 1 : 0) + integrations.filter(([, ok]) => !ok).length;
  const failing = r.checks.filter((c) => (c.count ?? 0) > 0);
  const [gl, gc] = grade(r.score);
  const R = 70, C = 2 * Math.PI * R;
  const hist = r.history;
  const hmax = 100;
  const spark = hist.map((h, i) => `${hist.length === 1 ? 50 : (i / (hist.length - 1)) * 100},${30 - (h.score / hmax) * 28}`).join(" ");
  const prev = hist.length > 1 ? hist[hist.length - 2]!.score : null;
  const byArea = (a: string) => r.checks.filter((c) => c.area === a);
  const tools: Array<[string, string, string]> = [
    ["/yonetim/is-akisi", "İş akışı denetimi", "🦷"], ["/yonetim", "Kullanıcılar ve hesaplar", "👤"], ["/yonetim/yetkiler", "Yetki haritası", "🗺"], ["/yonetim/hareketler", "İşlem geçmişi", "📜"],
    ["/yonetim/goruntule", "Kullanıcı olarak görüntüle", "👁"], ["/yonetim/onay-akislari", "Onay akışları", "✅"], ["/yonetim/sirket", "Şirket ayarları", "🏢"], ["/yonetim/temizle", "Sistemi temizle", "🧹"],
  ];

  return (
    <>
      <PageHeader title="Kontrol Merkezi" subtitle="Tüm sistem her açılışta taranır: eksik, hatalı, yapılması gereken işler tek ekranda" />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1280px]">
        <section className="relative overflow-hidden rounded-[22px] p-5 md:p-7 text-white bg-[radial-gradient(circle_at_90%_0%,rgba(99,102,241,.45),transparent_45%),radial-gradient(circle_at_0%_100%,rgba(16,185,129,.3),transparent_45%),linear-gradient(135deg,#0B1222,#16213E)]">
          <div className="flex flex-wrap items-center gap-6 md:gap-10">
            <div className="relative w-[170px] h-[170px] shrink-0">
              <svg viewBox="0 0 170 170" className="w-full h-full -rotate-90" role="img" aria-label={`Sağlık skoru ${r.score}`}>
                <circle cx="85" cy="85" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="14" />
                <circle cx="85" cy="85" r={R} fill="none" stroke={gc} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(r.score / 100) * C} ${C}`} style={{ filter: `drop-shadow(0 0 10px ${gc})` }} />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div><b className="font-display text-5xl num">{r.score}</b><span className="block text-xs uppercase tracking-widest" style={{ color: gc }}>{gl}</span></div>
              </div>
            </div>
            <div className="flex-1 min-w-[240px] flex flex-col gap-3">
              <p className="text-[11px] uppercase tracking-[.25em] text-white/50">Sistem sağlık skoru</p>
              <p className="text-2xl md:text-3xl font-display font-bold leading-tight">{failing.length === 0 && setupIssues === 0 ? "Her şey yolunda ✨" : `${failing.length} konuda ${failing.reduce((a, c) => a + (c.count ?? 0), 0)} kayıt dikkat istiyor`}</p>
              <p className="text-sm text-white/60">{failing.filter((c) => c.sev === "high").length} kritik · {failing.filter((c) => c.sev === "medium").length} önemli · {failing.filter((c) => c.sev === "low").length} bilgi{setupIssues ? ` · ${setupIssues} kurulum eksiği` : ""}{prev !== null ? ` · dünden ${r.score - prev >= 0 ? "+" : ""}${r.score - prev} puan` : ""}</p>
              {hist.length > 1 && (
                <div className="flex items-end gap-3">
                  <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-48 h-10" aria-hidden><polyline points={spark} fill="none" stroke="#A5B4FC" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
                  <span className="text-[11px] text-white/50">son {hist.length} gün</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {AREAS.map(([a, l, ic]) => {
              const list = a === "kurulum" ? [] : byArea(a);
              const bad = a === "kurulum" ? setupIssues : list.filter((c) => (c.count ?? 0) > 0).length;
              const worst = list.find((c) => (c.count ?? 0) > 0 && c.sev === "high") ? "high" : list.find((c) => (c.count ?? 0) > 0 && c.sev === "medium") ? "medium" : bad ? "low" : null;
              return (
                <a key={a} href={`#${a}`} className="rounded-2xl bg-white/[.06] hover:bg-white/[.12] border border-white/10 px-3 py-2.5 transition">
                  <span className="text-lg">{ic}</span>
                  <span className="block text-[12px] text-white/70 mt-0.5">{l}</span>
                  <b className="text-sm" style={{ color: worst ? SEV[worst]![1] : "#34D399" }}>{bad ? `${bad} sorun` : "✓ temiz"}</b>
                </a>
              );
            })}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-5">
            {AREAS.filter(([a]) => a !== "kurulum").map(([a, l, ic]) => {
              const list = byArea(a).sort((x, y) => (y.count ?? 0) > 0 === (x.count ?? 0) > 0 ? ["high", "medium", "low"].indexOf(x.sev) - ["high", "medium", "low"].indexOf(y.sev) : (y.count ?? 0) > 0 ? 1 : -1);
              return (
                <section key={a} id={a} className="bg-white border border-line rounded-[18px] overflow-hidden scroll-mt-20">
                  <h2 className="px-4 py-3 border-b border-line font-display font-semibold text-brand-800 flex items-center gap-2"><span>{ic}</span>{l}<span className="ml-auto text-xs font-normal text-muted">{list.filter((c) => (c.count ?? 0) > 0).length} / {list.length} kuralda bulgu</span></h2>
                  <ul className="divide-y divide-[#EEF2F6]">
                    {list.map((c) => {
                      const n = c.count ?? 0;
                      const [sl, sc, sb] = SEV[c.sev]!;
                      if (c.error) return <li key={c.key} className="px-4 py-2.5 text-sm text-muted flex gap-2"><span>⚪</span><span className="flex-1">{c.title}</span><span className="text-xs">bu modülün SQL güncellemesi eksik</span></li>;
                      if (!n) return <li key={c.key} className="px-4 py-2 text-sm text-muted flex gap-2"><span className="text-ok">✓</span><span className="flex-1">{c.title}</span></li>;
                      return (
                        <li key={c.key}>
                          <details className="group">
                            <summary className="px-4 py-3 flex flex-wrap items-center gap-3 cursor-pointer list-none hover:bg-[#FAFBFD]">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sc, boxShadow: `0 0 0 4px ${sc}22` }} />
                              <span className="flex-1 min-w-[200px]"><b className="text-sm">{c.title}</b><span className="block text-xs text-muted">{c.hint}</span></span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sb}`}>{sl}</span>
                              <span className="num text-lg font-bold text-ink min-w-[2.5rem] text-right">{n}</span>
                              <span className="text-muted text-xs group-open:rotate-90 transition">▶</span>
                            </summary>
                            <div className="px-4 pb-3 pl-10 flex flex-col gap-1.5">
                              <ul className="flex flex-col gap-1">
                                {(c.sample ?? []).map((x) => <li key={x.id}><Link href={x.link} className="text-sm text-brand-700 hover:underline">{x.label}</Link></li>)}
                              </ul>
                              {n > (c.sample?.length ?? 0) && <span className="text-xs text-muted">+{n - (c.sample?.length ?? 0)} kayıt daha</span>}
                              <Link href={c.fix} className="self-start mt-1 h-9 px-4 inline-flex items-center rounded-lg bg-brand-700 text-white text-sm font-semibold">Düzelt →</Link>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          <aside className="flex flex-col gap-5">
            <section id="kurulum" className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-3 scroll-mt-20">
              <h2 className="font-display font-semibold text-brand-800">⚙️ Kurulum ve bağlantılar</h2>
              <div className={`rounded-xl p-3 text-sm ${missingFiles.length ? "bg-[#FEF3C7] text-[#92400E]" : "bg-ok-bg text-ok"}`}>
                {missErr ? "SQL güncelleme kontrolü için 20270125000000_admin_center.sql çalıştırılmalı." : missingFiles.length ? (
                  <>
                    <b>{missingFiles.length} SQL güncellemesi Supabase&apos;de çalıştırılmamış:</b>
                    <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">{missingFiles.map((f) => <li key={f}>• {f}</li>)}</ul>
                    <p className="mt-2 text-xs">Bu dosyalar çalıştırılmadan ilgili ekranlar tam çalışmaz. İsterseniz hepsini tek dosyada birleştirip gönderebilirim.</p>
                  </>
                ) : <>✓ Tüm SQL güncellemeleri ({MIGRATION_MANIFEST.length}) çalıştırılmış.</>}
              </div>
              <ul className="flex flex-col gap-2">
                {integrations.map(([l, ok, d]) => (
                  <li key={l} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full grid place-items-center text-[11px] font-bold ${ok ? "bg-ok-bg text-ok" : "bg-[#F1F5F9] text-muted"}`}>{ok ? "✓" : "–"}</span>
                    <span className="flex-1"><b className={ok ? "" : "text-muted"}>{l}</b><span className="block text-xs text-muted">{d}</span></span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted">Anahtar değerleri burada gösterilmez; yalnız tanımlı olup olmadığı görünür (Vercel › Settings › Environment Variables).</p>
            </section>
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">🧰 Yönetim araçları</h2>
              <div className="grid grid-cols-2 gap-2">
                {tools.map(([h, l, ic]) => <Link key={h} href={h} className="rounded-xl border border-line px-3 py-2.5 hover:border-brand-600 hover:bg-[#F7FAFE] transition text-sm"><span className="text-base">{ic}</span><span className="block font-semibold text-brand-800 leading-tight mt-0.5">{l}</span></Link>)}
              </div>
            </section>
            <section className="rounded-[18px] p-4 bg-[#F5F3FF] border border-[#DDD6FE] text-sm text-[#4C1D95]">
              <b>🌅 Sabah kontrol raporu açık:</b> her sabah 07:30&apos;da sağlık skoru, dünden farkı ve yeni çıkan sorunlar size ve yönetim yetkililerine telefon bildirimi olarak gelir.
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
