import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { createClient } from "@/lib/supabase/server";
import { gscReport, type GscRow } from "@/lib/gsc";
import { COUNTRY_TR, TR_PROVINCES } from "@/lib/tr-provinces";

export const metadata = { title: "Site kontrol merkezi" };
export const dynamic = "force-dynamic";

type R = {
  views: number; visitors: number; sessions: number; avg_ms: number | null; prev_views: number; prev_visitors: number; bounce: number | null; live: number;
  events: Record<string, number>; series: Array<{ d: string; views: number; visitors: number; ai: number }>;
  pages: Array<{ path: string; views: number; visitors: number; avg_ms: number | null; conv: number }>;
  sources: Array<{ source: string; visitors: number; views: number }>; refs: Array<{ ref: string; n: number }>; campaigns: Array<{ utm: string; campaign: string | null; n: number }>;
  regions: Array<{ region: string | null; city: string | null; n: number }>; cities: Array<{ city: string; country: string; n: number }>; countries: Array<{ country: string; n: number }>;
  devices: Record<string, number>; browsers: Array<{ k: string; n: number }>; locales: Record<string, number>; hours: number[];
  bots: Array<{ bot: string; n: number; last: string; pages: number }>; bot_pages: Array<{ path: string; n: number; bots: string }>; ai_refs: Array<{ source: string; n: number; views: number }>;
  users: Array<{ user: string; name: string; kind: string; company: string | null; views: number; last: string; city: string | null; pages: string[]; last_sign_in: string | null }>;
  recent: Array<{ at: string; kind: string; name: string | null; path: string; city: string | null; country: string | null; device: string | null; source: string | null; user: boolean }>;
};

const SRC: Record<string, [string, string]> = {
  google: ["Google", "#4285F4"], bing: ["Bing", "#008373"], yandex: ["Yandex", "#FC3F1D"], duckduckgo: ["DuckDuckGo", "#DE5833"], direct: ["Doğrudan", "#64748B"],
  instagram: ["Instagram", "#E1306C"], facebook: ["Facebook", "#1877F2"], linkedin: ["LinkedIn", "#0A66C2"], youtube: ["YouTube", "#FF0000"], x: ["X", "#111827"], whatsapp: ["WhatsApp", "#25D366"],
  chatgpt: ["ChatGPT", "#10A37F"], perplexity: ["Perplexity", "#20808D"], gemini: ["Gemini", "#8E75B2"], copilot: ["Copilot", "#0078D4"], claude: ["Claude", "#D97757"],
  campaign: ["Kampanya", "#F59E0B"], other: ["Diğer siteler", "#94A3B8"],
};
const EV: Record<string, string> = {
  whatsapp: "WhatsApp tıklaması", phone: "Telefon araması", email: "E-posta tıklaması", contact_form: "İletişim formu", visit_request: "Ziyaret randevusu", chat_start: "Canlı destek başlatma",
  portal_signup: "Portal kaydı", login_portal: "Portal girişi", login_admin: "Yönetici girişi", login_staff: "Personel girişi", login_failed: "Hatalı giriş denemesi", download: "Dosya indirme", social: "Sosyal medya tıklaması",
};
const AI_BOT: Record<string, [string, string]> = {
  "ChatGPT-User": ["ChatGPT (kullanıcı sorusu)", "live"], "OAI-SearchBot": ["ChatGPT Arama dizini", "index"], GPTBot: ["OpenAI eğitim", "train"],
  "Perplexity-User": ["Perplexity (kullanıcı sorusu)", "live"], PerplexityBot: ["Perplexity dizini", "index"], "Claude-User": ["Claude (kullanıcı sorusu)", "live"],
  "Claude-SearchBot": ["Claude arama dizini", "index"], ClaudeBot: ["Anthropic eğitim", "train"], GoogleOther: ["Google yapay zekâ / Gemini", "index"], Gemini: ["Gemini", "live"],
  Copilot: ["Microsoft Copilot", "live"], Mistral: ["Mistral (kullanıcı sorusu)", "live"], "You.com": ["You.com", "live"], Meta: ["Meta AI / önizleme", "index"],
  Bytespider: ["ByteDance eğitim", "train"], CCBot: ["Common Crawl (eğitim)", "train"], Amazonbot: ["Amazon / Alexa", "index"],
  Googlebot: ["Google Arama", "search"], Bingbot: ["Bing Arama (Copilot)", "search"], Applebot: ["Apple / Siri", "search"], YandexBot: ["Yandex Arama", "search"], DuckDuckGo: ["DuckDuckGo", "search"],
};
const KIND: Record<string, string> = { doctor_tr: "Hekim", doctor_foreign: "Yurt dışı hekim", clinic: "Klinik", agency: "Aracı kurum", staff: "Personel / yönetici", user: "Kullanıcı" };
const n = (v: number) => v.toLocaleString("tr-TR");
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const dur = (ms: number | null) => (ms ? (ms >= 60000 ? `${Math.floor(ms / 60000)} dk ${Math.round((ms % 60000) / 1000)} sn` : `${Math.round(ms / 1000)} sn`) : "—");
const ago = (s: string) => { const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 1 ? "şimdi" : m < 60 ? `${m} dk` : m < 1440 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} gün`; };
const iso = (d: Date) => new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10);

function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${v >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{v >= 0 ? "▲" : "▼"} %{Math.abs(v)}</span>;
}
function Bars({ rows, color = "#2E86DE" }: { rows: Array<[string, number, string?]>; color?: string }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  if (!rows.length) return <p className="text-sm text-slate">Henüz veri yok.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map(([k, v, c]) => (
        <li key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-ink" title={k}>{k}</span>
          <span className="h-2.5 rounded-full bg-porcelain"><span className="block h-2.5 rounded-full" style={{ width: `${Math.max(3, (v / max) * 100)}%`, background: c ?? color }} /></span>
          <span className="num text-right font-semibold text-navy">{n(v)}</span>
        </li>
      ))}
    </ul>
  );
}
function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gypsum bg-white p-5 ${className}`}>
      <h2 className="display text-lg font-semibold text-navy">{title}{sub && <span className="ml-2 text-xs font-normal text-slate">{sub}</span>}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Line({ data, keys }: { data: Array<Record<string, number | string>>; keys: Array<[string, string]> }) {
  const max = Math.max(1, ...data.flatMap((d) => keys.map(([k]) => Number(d[k]) || 0)));
  const W = 600, H = 140;
  const pts = (k: string) => data.map((d, i) => `${data.length === 1 ? W / 2 : (i / (data.length - 1)) * W},${H - ((Number(d[k]) || 0) / max) * (H - 10) - 4}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label="Günlük grafik">
      {[0.25, 0.5, 0.75].map((y) => <line key={y} x1="0" x2={W} y1={H * y} y2={H * y} stroke="#EEF2F6" />)}
      {keys.map(([k, c]) => <polyline key={k} points={pts(k)} fill="none" stroke={c} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
    </svg>
  );
}

/** Site kontrol merkezi: ziyaretçi, il / şehir, kaynak, sayfa, dönüşüm, giriş yapanlar, Google arama ve yapay zekâ görünürlüğü */
export default async function SiteControl({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const sp = await searchParams;
  const days = [1, 7, 30, 90].includes(Number(sp.gun)) ? Number(sp.gun) : 30;
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86400000);
  const supabase = await createClient();
  // Search Console verisi 2-3 gün gecikmeli gelir
  const gTo = new Date(Date.now() - 2 * 86400000), gFrom = new Date(gTo.getTime() - (Math.max(days, 7) - 1) * 86400000);
  const gPrevTo = new Date(gFrom.getTime() - 86400000), gPrevFrom = new Date(gPrevTo.getTime() - (Math.max(days, 7) - 1) * 86400000);
  const [{ data, error }, gsc] = await Promise.all([
    supabase.rpc("site_report", { p_from: iso(from), p_to: iso(to) }),
    gscReport(iso(gFrom), iso(gTo), iso(gPrevFrom), iso(gPrevTo)),
  ]);
  if (error) {
    return (
      <div>
        <h1 className="display text-3xl font-semibold text-navy">Site kontrol merkezi</h1>
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{/site_report|does not exist/.test(error.message) ? "Supabase'de 20270131000000_site_analytics.sql çalıştırılmalı." : error.message}</p>
      </div>
    );
  }
  const r = data as R;
  const conv = ["contact_form", "visit_request", "chat_start", "portal_signup", "whatsapp", "phone"].reduce((a, k) => a + (r.events[k] ?? 0), 0);
  const aiLive = r.bots.filter((b) => AI_BOT[b.bot]?.[1] === "live").reduce((a, b) => a + b.n, 0);
  const aiIndex = r.bots.filter((b) => ["index", "train"].includes(AI_BOT[b.bot]?.[1] ?? "")).reduce((a, b) => a + b.n, 0);
  const aiRefs = r.ai_refs.reduce((a, x) => a + x.n, 0);
  const dev = r.devices;
  const devTot = Object.values(dev).reduce((a, b) => a + b, 0) || 1;
  const regionName = (x: { region: string | null; city: string | null }) => (x.region && TR_PROVINCES[x.region.padStart(2, "0")]) || x.city || x.region || "?";
  const hmax = Math.max(1, ...r.hours);
  const gscPct = (a?: number, b?: number) => (a !== undefined && b ? pct(a, b) : null);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh seconds={60} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold text-navy">Site kontrol merkezi</h1>
          <p className="mt-1 text-slate">Kim geldi, nereden geldi, ne yaptı · Google ve yapay zekâ görünürlüğü · çerezsiz, kişisel veri tutmadan</p>
        </div>
        <nav className="flex gap-1 rounded-full border border-gypsum bg-white p-1 text-sm font-semibold">
          {[[1, "Bugün"], [7, "7 gün"], [30, "30 gün"], [90, "90 gün"]].map(([d, l]) => (
            <Link key={d} href={`/admin/kontrol?gun=${d}`} className={`rounded-full px-3.5 py-1.5 ${days === d ? "bg-navy text-white" : "text-slate hover:text-navy"}`}>{l}</Link>
          ))}
        </nav>
      </div>

      <section className="relative overflow-hidden rounded-3xl p-6 text-white" style={{ background: "radial-gradient(circle at 95% 0%, rgba(46,134,222,.45), transparent 45%), radial-gradient(circle at 0% 100%, rgba(16,163,127,.35), transparent 45%), linear-gradient(135deg,#072A50,#0B1E3A)" }}>
        <div className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" /><b>{r.live}</b> kişi şu an sitede</div>
        <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
          {[
            ["Ziyaretçi", n(r.visitors), pct(r.visitors, r.prev_visitors)],
            ["Sayfa görüntüleme", n(r.views), pct(r.views, r.prev_views)],
            ["Ort. süre / sayfa", dur(r.avg_ms), null],
            ["Hemen çıkma", r.bounce === null ? "—" : `%${r.bounce}`, null],
            ["Dönüşüm", n(conv), null],
            ["Google görüntülenme", gsc.totals ? n(gsc.totals.impressions) : "—", gscPct(gsc.totals?.impressions, gsc.prev?.impressions)],
          ].map(([l, v, d]) => (
            <div key={String(l)}><span className="text-xs uppercase tracking-wider text-white/60">{l}</span><b className="mt-1 block text-3xl num">{v}</b>{d !== null && <span className={`text-xs font-bold ${Number(d) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(d) >= 0 ? "▲" : "▼"} %{Math.abs(Number(d))} önceki döneme göre</span>}</div>
          ))}
        </div>
        <div className="mt-5 rounded-2xl bg-white/5 p-3">
          <Line data={r.series} keys={[["visitors", "#60A5FA"], ["views", "#34D399"], ["ai", "#F59E0B"]]} />
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-white/70"><span><i className="mr-1 inline-block h-2 w-3 rounded bg-[#60A5FA]" />Ziyaretçi</span><span><i className="mr-1 inline-block h-2 w-3 rounded bg-[#34D399]" />Görüntüleme</span><span><i className="mr-1 inline-block h-2 w-3 rounded bg-[#F59E0B]" />Bot / yapay zekâ ziyareti</span></div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Nereden geliyorlar" sub="ziyaretçi">
          <Bars rows={r.sources.slice(0, 12).map((s) => [SRC[s.source]?.[0] ?? s.source, s.visitors, SRC[s.source]?.[1]])} />
          {r.refs.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate">Yönlendiren siteler</summary><ul className="mt-2 grid gap-1">{r.refs.map((x) => <li key={x.ref} className="flex justify-between"><span className="truncate">{x.ref}</span><b className="num">{x.n}</b></li>)}</ul></details>}
        </Card>
        <Card title="Hangi illerden" sub="Türkiye · ziyaretçi">
          <Bars rows={r.regions.slice(0, 12).map((x) => [regionName(x), x.n])} color="#10A37F" />
        </Card>
        <Card title="Ülke ve şehir" sub="ziyaretçi">
          <Bars rows={r.countries.slice(0, 8).map((x) => [COUNTRY_TR[x.country] ?? x.country, x.n])} color="#8B5CF6" />
          <p className="mt-3 text-xs text-slate">{r.cities.slice(0, 10).map((c) => `${c.city} (${c.n})`).join(" · ")}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="En çok bakılan sayfalar" sub="görüntüleme · ort. süre · dönüşüm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs text-slate"><th className="pb-2">Sayfa</th><th className="pb-2 text-right">Görüntüleme</th><th className="pb-2 text-right">Ziyaretçi</th><th className="pb-2 text-right">Süre</th><th className="pb-2 text-right">Dönüşüm</th></tr></thead>
              <tbody>{r.pages.map((p) => <tr key={p.path} className="border-t border-porcelain"><td className="py-1.5"><a href={p.path} target="_blank" rel="noreferrer" className="text-navy hover:underline">{p.path}</a></td><td className="py-1.5 text-right num">{n(p.views)}</td><td className="py-1.5 text-right num">{n(p.visitors)}</td><td className="py-1.5 text-right num text-slate">{dur(p.avg_ms)}</td><td className="py-1.5 text-right num">{p.conv || "—"}</td></tr>)}</tbody>
            </table>
            {!r.pages.length && <p className="text-sm text-slate">Henüz veri yok; birkaç dakika içinde ilk ziyaretler görünür.</p>}
          </div>
        </Card>
        <Card title="Sitede ne yaptılar" sub="olaylar">
          <Bars rows={Object.entries(r.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => [EV[k] ?? k, v, k === "login_failed" ? "#E11D48" : undefined])} color="#F59E0B" />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Cihaz">
          <div className="flex h-4 overflow-hidden rounded-full">{[["mobile", "#2E86DE"], ["desktop", "#072A50"], ["tablet", "#10A37F"]].map(([k, c]) => <span key={k} style={{ width: `${((dev[k!] ?? 0) / devTot) * 100}%`, background: c }} />)}</div>
          <ul className="mt-3 grid gap-1 text-sm">{[["mobile", "📱 Mobil"], ["desktop", "💻 Masaüstü"], ["tablet", "📲 Tablet"]].map(([k, l]) => <li key={k} className="flex justify-between"><span>{l}</span><b className="num">%{Math.round(((dev[k!] ?? 0) / devTot) * 100)}</b></li>)}</ul>
          <p className="mt-3 text-xs text-slate">{r.browsers.map((b) => `${b.k} ${b.n}`).join(" · ")}</p>
        </Card>
        <Card title="Saatlere göre">
          <div className="flex h-24 items-end gap-[3px]">{r.hours.map((v, h) => <span key={h} title={`${h}:00 · ${v}`} className="flex-1 rounded-t bg-smile" style={{ height: `${Math.max(3, (v / hmax) * 100)}%`, opacity: v ? 1 : 0.2 }} />)}</div>
          <div className="mt-1 flex justify-between text-[10px] text-slate"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </Card>
        <Card title="Dil ve kampanyalar">
          <ul className="grid gap-1 text-sm">{Object.entries(r.locales).map(([k, v]) => <li key={k} className="flex justify-between"><span>{({ tr: "🇹🇷 Türkçe", en: "🇬🇧 İngilizce", fr: "🇫🇷 Fransızca", portal: "Portal" } as Record<string, string>)[k] ?? k}</span><b className="num">{n(v)}</b></li>)}</ul>
          {r.campaigns.length > 0 && <ul className="mt-3 grid gap-1 border-t border-porcelain pt-2 text-xs">{r.campaigns.map((c, i) => <li key={i} className="flex justify-between"><span className="truncate">{c.utm}{c.campaign ? ` / ${c.campaign}` : ""}</span><b>{c.n}</b></li>)}</ul>}
        </Card>
      </div>

      <Card title="🔍 Google aramada görünürlük" sub={gsc.site ? `Search Console · ${gsc.site} · veriler 2 gün gecikmeli` : undefined}>
        {!gsc.configured ? (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
              <b>Bağlantı kurulmadı.</b> Google aramadaki görüntülenme, tıklama, sıra ve aranan kelimeler Search Console&apos;dan çekilir. Kurulum 5 dakika:
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Google Cloud&apos;da bir proje açın, <b>Search Console API</b>&apos;yi etkinleştirin.</li>
                <li>Bir <b>servis hesabı</b> oluşturup JSON anahtarını indirin.</li>
                <li>Search Console › Ayarlar › Kullanıcılar: servis hesabının e-postasını <b>Kısıtlı</b> kullanıcı olarak ekleyin.</li>
                <li>Vercel › mb-dental-site › Environment Variables: <code>GSC_SERVICE_ACCOUNT</code> = JSON içeriği, <code>GSC_SITE_URL</code> = <code>sc-domain:mbdentaire.com</code>; yeniden yayınlayın.</li>
              </ol>
            </div>
            <p className="text-slate">Anahtarı sohbete yapıştırmayın; doğrudan Vercel&apos;e girin. Bağlantı kurulunca burada en çok aranan kelimeler, hangi sayfanın kaçıncı sırada çıktığı, ülke ve cihaz kırılımı ile Google&apos;ın yapay zekâ özetleri dahil arama görünümleri görünür.</p>
          </div>
        ) : gsc.error ? (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">Search Console okunamadı: {gsc.error}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                {[["Görüntülenme", n(gsc.totals!.impressions), gscPct(gsc.totals!.impressions, gsc.prev!.impressions)], ["Tıklama", n(gsc.totals!.clicks), gscPct(gsc.totals!.clicks, gsc.prev!.clicks)],
                  ["Tıklama oranı", `%${(gsc.totals!.ctr * 100).toFixed(1)}`, null], ["Ort. sıra", gsc.totals!.position.toFixed(1), null]].map(([l, v, d]) => (
                  <div key={String(l)} className="rounded-xl bg-porcelain p-3"><span className="text-xs text-slate">{l}</span><b className="block text-2xl num text-navy">{v}<Delta v={d as number | null} /></b></div>
                ))}
              </div>
              <Line data={(gsc.days ?? []).map((d) => ({ d: d.keys[0]!, impressions: d.impressions, clicks: d.clicks * 10 }))} keys={[["impressions", "#4285F4"], ["clicks", "#34A853"]]} />
              <p className="text-xs text-slate">Mavi: görüntülenme · yeşil: tıklama (×10 ölçek)</p>
              <Bars rows={(gsc.countries ?? []).map((c: GscRow) => [c.keys[0]!.toUpperCase(), c.impressions])} color="#4285F4" />
              {(gsc.appearance ?? []).length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-navy">Arama görünümü</h3><Bars rows={(gsc.appearance ?? []).map((a) => [a.keys[0]!.replace(/_/g, " ").toLowerCase(), a.impressions])} color="#8E75B2" /></div>}
            </div>
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <h3 className="mb-2 text-sm font-semibold text-navy">En çok aranan kelimeler</h3>
                <table className="w-full min-w-[420px] text-sm"><thead><tr className="text-left text-xs text-slate"><th>Kelime</th><th className="text-right">Görüntülenme</th><th className="text-right">Tıklama</th><th className="text-right">Sıra</th></tr></thead>
                  <tbody>{(gsc.queries ?? []).map((q) => <tr key={q.keys[0]} className="border-t border-porcelain"><td className="py-1">{q.keys[0]}</td><td className="py-1 text-right num">{n(q.impressions)}</td><td className="py-1 text-right num">{n(q.clicks)}</td><td className={`py-1 text-right num ${q.position <= 3 ? "text-emerald-700 font-bold" : q.position <= 10 ? "" : "text-slate"}`}>{q.position.toFixed(1)}</td></tr>)}</tbody></table>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy">Google&apos;da en çok görünen sayfalar</h3>
                <ul className="grid gap-1 text-sm">{(gsc.pages ?? []).map((p) => <li key={p.keys[0]} className="flex gap-2"><span className="flex-1 truncate">{p.keys[0]!.replace(/^https?:\/\/[^/]+/, "")}</span><span className="num text-slate">{n(p.impressions)} gör.</span><b className="num">{n(p.clicks)} tık</b></li>)}</ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="🤖 Yapay zekâ aramalarında görünürlük" sub="ChatGPT, Perplexity, Claude, Gemini, Copilot">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="grid grid-cols-1 gap-3">
            {[["Yapay zekânın kullanıcı sorusu için siteyi okuması", aiLive, "Biri ChatGPT / Perplexity / Claude'a sorduğunda yapay zekâ sayfanızı açtı: cevapta kaynak olma ihtimaliniz yüksek."],
              ["Yapay zekâdan gelen ziyaretçi", aiRefs, "Yapay zekâ cevabındaki bağlantıya tıklayıp siteye gelen kişi."],
              ["Dizinleme / eğitim taraması", aiIndex, "Yapay zekâ arama dizinleri ve model eğitimi için yapılan taramalar."]].map(([l, v, d]) => (
              <div key={String(l)} className="rounded-xl bg-porcelain p-3"><b className="text-2xl num text-navy">{n(v as number)}</b><span className="block text-sm font-semibold text-ink">{l}</span><span className="block text-xs text-slate">{d}</span></div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy">Bot ziyaretleri</h3>
            <ul className="grid gap-1.5 text-sm">{r.bots.map((b) => {
              const [l, k] = AI_BOT[b.bot] ?? [b.bot, "index"];
              return <li key={b.bot} className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${k === "live" ? "bg-emerald-500" : k === "search" ? "bg-blue-500" : k === "train" ? "bg-slate-400" : "bg-amber-500"}`} /><span className="flex-1 truncate">{l}</span><span className="text-xs text-slate">{ago(b.last)} önce</span><b className="num">{n(b.n)}</b></li>;
            })}{!r.bots.length && <li className="text-slate">Henüz bot ziyareti kaydedilmedi.</li>}</ul>
            <p className="mt-2 text-[11px] text-slate"><span className="text-emerald-600">●</span> kullanıcı sorusu · <span className="text-blue-600">●</span> arama motoru · <span className="text-amber-600">●</span> yapay zekâ dizini · <span className="text-slate-500">●</span> eğitim</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy">Yapay zekânın en çok okuduğu sayfalar</h3>
            <ul className="grid gap-1 text-sm">{r.bot_pages.map((p) => <li key={p.path} className="flex gap-2"><span className="flex-1 truncate" title={p.bots}>{p.path}</span><b className="num">{p.n}</b></li>)}{!r.bot_pages.length && <li className="text-slate">Henüz yok.</li>}</ul>
            {r.ai_refs.length > 0 && <><h3 className="mb-2 mt-4 text-sm font-semibold text-navy">Yapay zekâdan gelen ziyaretçi</h3><Bars rows={r.ai_refs.map((x) => [SRC[x.source]?.[0] ?? x.source, x.n, SRC[x.source]?.[1]])} /></>}
          </div>
        </div>
        <p className="mt-4 text-xs text-slate">ChatGPT, Perplexity gibi servisler “kaç kez cevapta gösterildiniz” sayısını paylaşmıyor. En yakın ölçü, yapay zekânın bir kullanıcı sorusu için sayfanızı canlı açmasıdır (yeşil); bunlar ve yapay zekâdan gelen tıklamalar burada sayılır. Google&apos;ın yapay zekâ özetlerindeki görüntülenmeler Search Console toplamına dahildir.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card title="👤 Giriş yapanlar ve ne yaptılar" sub="portal hekimleri, klinikler, yöneticiler">
          <ul className="divide-y divide-porcelain">
            {r.users.map((u) => (
              <li key={u.user} className="flex flex-wrap items-start gap-2 py-2.5 text-sm">
                <div className="min-w-[180px] flex-1">
                  <b className="text-navy">{u.name}</b>{u.company && <span className="text-slate"> · {u.company}</span>}
                  <span className="ml-2 rounded-full bg-porcelain px-2 py-0.5 text-[11px] font-semibold text-slate">{KIND[u.kind] ?? u.kind}</span>
                  <span className="block truncate text-xs text-slate">{u.pages.join(" → ")}</span>
                </div>
                <div className="text-right text-xs text-slate"><b className="num text-navy">{u.views}</b> sayfa · {ago(u.last)} önce{u.city ? <span className="block">📍 {u.city}</span> : null}</div>
              </li>
            ))}
            {!r.users.length && <li className="py-3 text-sm text-slate">Bu dönemde giriş yapmış kullanıcı ziyareti yok.</li>}
          </ul>
        </Card>
        <Card title="⚡ Canlı akış" sub="son 24 saat">
          <ul className="grid gap-1.5 text-sm">
            {r.recent.map((x, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs text-slate">{ago(x.at)}</span>
                <span>{x.kind === "bot" ? "🤖" : x.kind === "event" ? "⭐" : x.device === "mobile" ? "📱" : "💻"}</span>
                <span className="flex-1 truncate">{x.kind === "event" ? <b>{EV[x.name ?? ""] ?? x.name}</b> : x.kind === "bot" ? <span className="text-slate">{AI_BOT[x.name ?? ""]?.[0] ?? x.name}</span> : null} <span className="text-slate">{x.path}</span></span>
                <span className="shrink-0 text-xs text-slate">{x.user ? "👤 " : ""}{x.city ?? (x.country ? COUNTRY_TR[x.country] ?? x.country : "")}{x.source && !["direct", "internal"].includes(x.source) ? ` · ${SRC[x.source]?.[0] ?? x.source}` : ""}</span>
              </li>
            ))}
            {!r.recent.length && <li className="text-slate">Henüz hareket yok.</li>}
          </ul>
        </Card>
      </div>
      <p className="text-xs text-slate">Gizlilik: IP adresi saklanmaz, çerez kullanılmaz; ziyaretçi her gün değişen anonim bir özetle sayılır. Konum, IP&apos;den il / şehir düzeyinde tahmin edilir. Kayıtlar 13 ay sonra silinir.</p>
    </div>
  );
}
