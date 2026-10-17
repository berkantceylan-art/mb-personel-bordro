import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { saveCostSettings, seedNoritake } from "@/lib/costing-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ürün maliyetleri" };

type Row = { id: string; code: string | null; name: string; material: string | null; lines: number; steps: number; minutes: number | null; material_cost: number | null; labor: number | null; production: number | null; total: number | null; price_try: number | null; price_eur: number | null; price_eur_try: number | null; margin_try: number | null; margin_eur: number | null; missing_prices: number };
type Set = { labor_rate_min: number; overhead_per_unit: number; remake_pct: number; marketing_pct: number; admin_pct: number; finance_pct: number; note: string | null; updated_at?: string };

const tl = (v: number | null | undefined) => money(Number(v ?? 0), "TRY");
const kur = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tone = (m: number | null) => (m == null ? "text-muted" : m < 10 ? "text-bad" : m < 25 ? "text-warn" : "text-ok");

/** Ürün maliyetleri: reçete (malzeme) + işçilik + genel giderler → tam maliyet, fiyat ve kâr marjı */
export default async function CostingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const sb = await createClient();
  const [{ data, error }, { data: set }, { data: prods }, { data: svc }] = await Promise.all([
    sb.rpc("prd_cost_list"),
    sb.from("prd_cost_settings").select("labor_rate_min, overhead_per_unit, remake_pct, marketing_pct, admin_pct, finance_pct, note, updated_at").maybeSingle(),
    sb.from("lab_products").select("id, name").eq("is_active", true).order("sort").order("name"),
    sb.from("prd_recipe_plan").select("product_id").eq("tpl", "hizmet"),
  ]);
  const service = new Set(((svc ?? []) as { product_id: string }[]).map((x) => x.product_id));
  const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  const terms = norm(q ?? "").split(/\s+/).filter(Boolean);
  const rows = ((data ?? []) as Row[]).filter((r) => !terms.length || terms.every((t) => norm(`${r.name} ${r.code ?? ""} ${r.material ?? ""}`).includes(t)));
  const withRecipe = rows.filter((r) => r.lines > 0 || r.steps > 0);
  const without = rows.filter((r) => r.lines === 0 && r.steps === 0 && !service.has(r.id));
  const nService = rows.filter((r) => r.lines === 0 && r.steps === 0 && service.has(r.id)).length;
  const cfg: Set = (set as Set | null) ?? { labor_rate_min: 600, overhead_per_unit: 20000, remake_pct: 4, marketing_pct: 7, admin_pct: 10, finance_pct: 2, note: null };
  const canSet = (s.modules.production ?? 0) >= 3 || (s.modules.finance ?? 0) >= 3;
  const canSeed = (s.modules.production ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  const pfm = ((prods ?? []) as { id: string; name: string }[]).find((p) => /metal/i.test(p.name) && /porselen|seramik/i.test(p.name));

  return (
    <>
      <PageHeader title="Ürün maliyetleri" subtitle="Üretim reçetesi: saf malzeme + işçilik + üretim genel gideri + tekrar payı + pazarlama + genel yönetim + finansman → tam maliyet ve kâr marjı"
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={`/yazdir/uretim-recete${q ? `?q=${encodeURIComponent(q)}` : ""}`} target="_blank" rel="noreferrer" className="text-brand-700">🖨 Reçeteleri yazdır</a><Link href="/uretim/recete-sihirbazi" className="text-brand-700">Reçete sihirbazı</Link><Link href="/stok/receteler" className="text-brand-700">Malzeme reçeteleri</Link><Link href="/uretim/ayarlar" className="text-brand-700">Üretim rotaları</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/prd_cost|schema cache|does not exist/.test(error.message) ? "Supabase'de mbdental-urun-maliyeti.sql çalıştırılmalı." : error.message}</p>}

        {canSeed && (
          <form action={seedNoritake} className="rounded-[20px] p-5 text-white bg-gradient-to-br from-[#06213f] via-[#0a3d73] to-[#13649f] flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <div className="text-xs font-semibold tracking-wider text-white/60">HAZIR REÇETE</div>
              <div className="font-display text-xl font-bold">Metal destekli porselen · Noritake EX-3 · Cr-Co döküm · 1 üye</div>
              <div className="text-sm text-white/75">19 malzeme (alçı, mum, revetman, Cr-Co, Noritake opak / body / enamel / glaze, sarflar) ve 8 üretim adımı (model → mum → döküm → tesviye → porselen → bitirme → QC → paket). Eksik malzeme kartları tahmini fiyatla açılır.</div>
            </div>
            <select name="product_id" defaultValue={pfm?.id ?? ""} required className="h-11 rounded-xl px-3 text-ink min-w-[240px]">
              <option value="">Hangi ürüne yüklensin?</option>
              {((prods ?? []) as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <PendingSubmit className="h-11 px-5 rounded-xl bg-white text-brand-800 font-semibold">Reçeteyi yükle</PendingSubmit>
          </form>
        )}

        <form className="flex flex-wrap items-center gap-2">
          <input name="q" type="search" defaultValue={q} placeholder="Ürün ara: ad, kod, malzeme" className="h-10 flex-1 min-w-[240px] max-w-xl rounded-[10px] border border-[#D5DEE8] px-3" />
          <button className="h-10 px-4 rounded-[10px] border border-line bg-white font-semibold text-sm">Ara</button>
          {q && <Link href="/uretim/maliyet" className="text-sm font-semibold text-muted">Temizle</Link>}
        </form>
        <section className="rounded-[20px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Ürün</th><th className="p-3 text-right">Süre</th><th className="p-3 text-right">Malzeme</th><th className="p-3 text-right">İşçilik</th><th className="p-3 text-right">Üretim maliyeti</th><th className="p-3 text-right">Tam maliyet</th><th className="p-3 text-right">Fiyat (TL)</th><th className="p-3 text-right">Marj</th><th className="p-3 text-right">Fiyat (€)</th><th className="p-3 text-right">Marj</th></tr></thead>
            <tbody>
              {withRecipe.map((r) => (
                <tr key={r.id} className="border-t border-[#EEF2F6] hover:bg-[#F8FAFC]">
                  <td className="p-3"><Link href={`/uretim/maliyet/${r.id}`} className="font-semibold text-brand-700">{r.name}</Link><span className="block text-xs text-muted">{r.lines} malzeme · {r.steps} adım{r.missing_prices ? <b className="text-warn"> · {r.missing_prices} malzemenin fiyatı yok</b> : ""}</span></td>
                  <td className="p-3 text-right">{r.minutes ? `${r.minutes} dk` : "—"}</td>
                  <td className="p-3 text-right tabular-nums">{tl(r.material_cost)}</td>
                  <td className="p-3 text-right tabular-nums">{tl(r.labor)}</td>
                  <td className="p-3 text-right tabular-nums">{tl(r.production)}</td>
                  <td className="p-3 text-right tabular-nums font-bold">{tl(r.total)}</td>
                  <td className="p-3 text-right tabular-nums">{r.price_try ? tl(r.price_try) : "—"}</td>
                  <td className={`p-3 text-right font-bold ${tone(r.margin_try)}`}>{r.margin_try != null ? `%${Number(r.margin_try)}` : "—"}</td>
                  <td className="p-3 text-right tabular-nums">{r.price_eur ? money(r.price_eur, "EUR") : "—"}</td>
                  <td className={`p-3 text-right font-bold ${tone(r.margin_eur)}`}>{r.margin_eur != null ? `%${Number(r.margin_eur)}` : "—"}</td>
                </tr>
              ))}
              {!withRecipe.length && !error && <tr><td colSpan={10} className="p-8 text-center text-muted">Henüz reçetesi olan ürün yok. Yukarıdan hazır reçeteyi yükleyin ya da Malzeme reçeteleri ekranından girin.</td></tr>}
            </tbody>
          </table>
        </section>
        {nService > 0 && <p className="text-xs text-muted">{nService} kalem hizmet (malzemesiz) olarak işaretli; reçetesiz listesinde gösterilmez.</p>}
        {without.length > 0 && (
          <details className="rounded-[16px] border border-line bg-white p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-brand-800">Reçetesi olmayan ürünler ({without.length}) <Link href="/uretim/recete-sihirbazi?f=eksik" className="ml-2 text-xs text-brand-700 underline">Reçete sihirbazında tamamla</Link></summary>
            <div className="flex flex-wrap gap-2 mt-3">{without.map((r) => <Link key={r.id} href={`/uretim/maliyet/${r.id}`} className="rounded-full border border-line px-3 py-1 hover:border-brand-600">{r.name}</Link>)}</div>
          </details>
        )}

        <form action={saveCostSettings} className="rounded-[20px] border border-line bg-white p-5 flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-display font-bold text-brand-800">Maliyet oranları</h2>
            <span className="text-xs text-muted">Başlangıç değerleri — gerçek aylık giderler netleştikçe güncelleyin{cfg.updated_at ? ` · son güncelleme ${new Date(cfg.updated_at).toLocaleDateString("tr-TR")}` : ""}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field name="labor_rate_min" label="İşçilik (TL / dakika)" hint="İstasyon ücreti yoksa" value={kur(cfg.labor_rate_min)} disabled={!canSet} />
            <Field name="overhead_per_unit" label="Üretim genel gideri (TL / üye)" hint="Kira, elektrik, cihaz amortismanı" value={kur(cfg.overhead_per_unit)} disabled={!canSet} />
            <Field name="remake_pct" label="Tekrar / fire payı (%)" hint="Malzeme + işçilik üzerinden" value={String(Number(cfg.remake_pct))} disabled={!canSet} />
            <Field name="marketing_pct" label="Pazarlama ve satış (%)" hint="Kurye, kargo, temsilci, reklam" value={String(Number(cfg.marketing_pct))} disabled={!canSet} />
            <Field name="admin_pct" label="Genel yönetim (%)" hint="Yönetim, ofis, muhasebe, yazılım" value={String(Number(cfg.admin_pct))} disabled={!canSet} />
            <Field name="finance_pct" label="Finansman (%)" hint="Vade, kredi faizi" value={String(Number(cfg.finance_pct))} disabled={!canSet} />
          </div>
          <p className="text-xs text-muted">Yüzdeler üretim maliyeti (malzeme + işçilik + üretim genel gideri + tekrar payı) üzerinden eklenir. Dakika ücreti varsayılanı: ortalama teknikerin işverene maliyeti ≈ 58–60 bin TL / ay ÷ ~165 verimli saat ≈ 6 TL/dk. İstasyon bazında farklı ücret (ör. porselen ustası) ürün kartından girilir.</p>
          {canSet && <div className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 flex-1 min-w-[240px]">Not<input name="note" defaultValue={cfg.note ?? ""} maxLength={500} placeholder="ör. Ekim 2026 başlangıç değerleri" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label><PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet ve yeniden hesapla</PendingSubmit></div>}
        </form>
      </div>
    </>
  );
}

function Field({ name, label, hint, value, disabled }: { name: string; label: string; hint: string; value: string; disabled: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      <input name={name} defaultValue={value} disabled={disabled} inputMode="decimal" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-right tabular-nums" />
      <span className="text-[11px] text-muted">{hint}</span>
    </label>
  );
}
