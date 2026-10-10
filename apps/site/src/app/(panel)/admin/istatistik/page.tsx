import { PageHead } from "@/components/admin/ui";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "İstatistik" };
export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = { doctor_tr: "Yerli hekim", doctor_foreign: "Yabancı hekim", clinic: "Klinik", agency: "Aracı kuruluş" };
const STATUS: Record<string, string> = { received: "Alındı", design: "Tasarım", production: "Üretim", quality: "Kalite", shipped: "Kargoda", delivered: "Teslim", on_hold: "Beklemede", cancelled: "İptal" };

/** Haftanın pazartesisi (İstanbul) "YYYY-MM-DD" */
function weekOf(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function Bars({ title, rows, total }: { title: string; rows: [string, number][]; total?: number }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <section className="rounded-2xl border border-gypsum bg-white p-5">
      <h2 className="display text-lg font-semibold text-navy">{title}{total != null && <span className="ml-2 text-sm font-normal text-slate">toplam {total}</span>}</h2>
      {rows.length ? (
        <ul className="mt-4 grid gap-2">
          {rows.map(([k, v]) => (
            <li key={k} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="truncate text-slate">{k}</span>
              <span className="h-3 rounded-full bg-porcelain"><span className="block h-3 rounded-full bg-smile" style={{ width: `${(v / max) * 100}%` }} /></span>
              <span className="num text-right font-semibold text-navy">{v}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate">Veri yok.</p>
      )}
    </section>
  );
}

/** Son 12 hafta: mesaj, canlı destek, portal hesapları, vakalar; dağılımlar */
export default async function StatsPage() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 84 * 86400000).toISOString();
  const [{ data: msgs }, { data: chats }, { data: accs }, { data: cases }, products] = await Promise.all([
    supabase.from("cms_messages").select("created_at, topic").gte("created_at", since).limit(10000),
    supabase.from("cms_chats").select("created_at").gte("created_at", since).limit(10000),
    supabase.from("portal_accounts").select("created_at, type, country, status").limit(10000),
    supabase.from("portal_cases").select("created_at, status, product_slug").limit(20000),
    publicProducts(),
  ]);
  const weeks: string[] = [];
  for (let i = 11; i >= 0; i--) weeks.push(weekOf(new Date(Date.now() - i * 7 * 86400000).toISOString()));
  const byWeek = (rows: { created_at: string }[] | null) => {
    const m = new Map<string, number>(weeks.map((w) => [w, 0]));
    for (const r of rows ?? []) {
      const w = weekOf(r.created_at);
      if (m.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
    }
    return weeks.map((w) => [w.slice(8, 10) + "." + w.slice(5, 7), m.get(w) ?? 0] as [string, number]);
  };
  const count = <T,>(rows: T[] | null, key: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const names = new Map(products.map((p) => [p.slug, t(p.name, "tr")]));
  const recentCases = (cases ?? []).filter((c) => c.created_at >= since);
  const recentAccs = (accs ?? []).filter((a) => a.created_at >= since);

  return (
    <>
      <PageHead title="İstatistik" lead="Son 12 haftada siteden ve portaldan gelenler. Ziyaretçi sayıları için Vercel Analytics panelini kullanın." />
      <p className="mb-6 text-sm">
        <a href="https://vercel.com/berkantceylan/mb-dental-site/analytics" target="_blank" rel="noreferrer" className="font-semibold text-smile-ink hover:underline">Vercel Analytics: ziyaretçi, sayfa görüntüleme, ülke ↗</a>
        <span className="text-slate"> · Speed Insights ile sayfa hızı da oradan izlenir.</span>
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Bars title="Portal vakası / hafta" rows={byWeek(recentCases)} total={recentCases.length} />
        <Bars title="Yeni portal hesabı / hafta" rows={byWeek(recentAccs)} total={recentAccs.length} />
        <Bars title="İletişim formu / hafta" rows={byWeek(msgs)} total={(msgs ?? []).length} />
        <Bars title="Canlı destek konuşması / hafta" rows={byWeek(chats)} total={(chats ?? []).length} />
        <Bars title="Vakalarda en çok istenen ürün (tümü)" rows={count(cases, (c) => (c.product_slug ? names.get(c.product_slug) ?? c.product_slug : "Belirtilmemiş")).slice(0, 10)} />
        <Bars title="Vaka durumu (tümü)" rows={count(cases, (c) => STATUS[c.status as string] ?? (c.status as string))} total={(cases ?? []).length} />
        <Bars title="Portal hesabı türü (aktif)" rows={count((accs ?? []).filter((a) => a.status === "active"), (a) => TYPE[a.type as string] ?? (a.type as string))} />
        <Bars title="Portal hesabı ülkesi (tümü)" rows={count(accs, (a) => (a.country as string) || "—").slice(0, 10)} />
      </div>
    </>
  );
}
