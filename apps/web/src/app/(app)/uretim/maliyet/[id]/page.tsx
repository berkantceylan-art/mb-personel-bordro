import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { saveBomLine, saveItemPrice, saveStep, seedNoritake } from "@/lib/costing-actions";

export const dynamic = "force-dynamic";

type M = { bom_id: string; item_id: string; code: string; name: string; unit: string; qty: number; waste_pct: number; unit_cost: number; purchase_price: number | null; currency: string; cost: number; note: string | null };
type L = { step_id: string; station_id: string; station: string; minutes: number; rate: number; own_rate: boolean; cost: number };
type C = {
  product: { id: string; name: string; code: string | null; price_try: number | null; price_eur: number | null };
  settings: { labor_rate_min: number; overhead_per_unit: number; remake_pct: number; marketing_pct: number; admin_pct: number; finance_pct: number };
  materials: M[]; labor: L[]; minutes: number; material: number; labor_total: number; piece?: number; overhead: number; remake: number; production: number; marketing: number; admin: number; finance: number; total: number;
  price_try: number | null; price_eur_try: number | null; eur_rate: number | null; margin_try: number | null; margin_eur: number | null; missing_prices: number;
};

const tl = (v: number) => money(v, "TRY");
const kur = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: number) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const PARTS: [keyof C, string, string][] = [["material", "Saf malzeme", "#0f4c8a"], ["labor_total", "İşçilik", "#7C5CC4"], ["piece", "Parça başı", "#B05FB0"], ["overhead", "Üretim genel gideri", "#2E9C82"], ["remake", "Tekrar / fire", "#E08A2E"], ["marketing", "Pazarlama", "#D4A800"], ["admin", "Genel yönetim", "#C0453A"], ["finance", "Finansman", "#7A8699"]];

/** Ürün maliyet kartı: reçete satırları, işçilik adımları, gider dağılımı, fiyat ve marj */
export default async function ProductCostPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const { data, error } = await (await createClient()).rpc("prd_product_cost", { p_product: id });
  if (error) return <p className="m-6 text-sm text-bad bg-bad-bg rounded-lg p-3">{/prd_|schema cache|does not exist/.test(error.message) ? "Supabase'de mbdental-urun-maliyeti.sql çalıştırılmalı." : error.message}</p>;
  const c = data as C | null;
  if (!c) notFound();
  const canEdit = (s.modules.stock ?? 0) >= 2 || (s.modules.production ?? 0) >= 3;
  const canRate = (s.modules.production ?? 0) >= 3 || (s.modules.finance ?? 0) >= 3;
  const price = c.price_try ?? c.price_eur_try ?? 0;
  const profit = price ? price - c.total : null;
  const suggest = (m: number) => Math.round(c.total / (1 - m / 100));
  const matShare = [...c.materials].sort((a, b) => b.cost - a.cost);

  return (
    <>
      <PageHeader title={c.product.name} subtitle={`Maliyet kartı · 1 ${"üye"} · ${c.minutes} dk standart süre`}
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={`/yazdir/uretim-recete/${id}`} target="_blank" rel="noreferrer" className="text-brand-700">🖨 Reçeteyi yazdır</a><Link href={`/stok/receteler?urun=${id}`} className="text-brand-700">Malzeme ekle / çıkar</Link><Link href="/uretim/ayarlar" className="text-brand-700">Rota</Link><Link href="/uretim/maliyet" className="text-brand-700">← Tüm ürünler</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1300px]">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[20px] p-5 text-white bg-gradient-to-br from-[#06213f] via-[#0a3d73] to-[#13649f] md:col-span-2">
            <div className="text-xs font-semibold tracking-wider text-white/60">TAM MALİYET (1 ÜYE)</div>
            <div className="font-display text-4xl font-bold tabular-nums">{tl(c.total)}</div>
            <div className="text-sm text-white/75">Üretim maliyeti {tl(c.production)} + pazarlama, genel yönetim, finansman {tl(c.marketing + c.admin + c.finance)}</div>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mt-4 bg-white/10">{PARTS.map(([k, l, col]) => Number(c[k]) > 0 && <div key={k} title={`${l}: ${tl(Number(c[k]))}`} style={{ width: `${(Number(c[k]) / c.total) * 100}%`, background: col }} />)}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-white/80">{PARTS.filter(([k]) => k !== "piece" || Number(c.piece ?? 0) > 0).map(([k, l, col]) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: col }} />{l} %{c.total ? Math.round((Number(c[k]) / c.total) * 100) : 0}</span>)}</div>
          </div>
          <div className="rounded-[20px] border border-line bg-white p-5">
            <div className="text-xs font-semibold text-muted">Satış fiyatı</div>
            <div className="font-display text-2xl font-bold tabular-nums">{c.price_try ? tl(c.price_try) : "—"}</div>
            {c.product.price_eur ? <div className="text-sm text-muted">{money(c.product.price_eur, "EUR")}{c.price_eur_try ? ` ≈ ${tl(c.price_eur_try)}` : c.eur_rate == null ? " · kur yok" : ""}</div> : null}
            <div className={`mt-2 text-sm font-bold ${profit == null ? "text-muted" : profit < 0 ? "text-bad" : "text-ok"}`}>{profit == null ? "Fiyat listesinde fiyat yok" : `${profit < 0 ? "Zarar" : "Kâr"} ${tl(Math.abs(profit))} · %${c.margin_try ?? c.margin_eur}`}</div>
          </div>
          <div className="rounded-[20px] border border-line bg-white p-5 text-sm">
            <div className="text-xs font-semibold text-muted mb-1">Hedef marja göre fiyat</div>
            {[20, 30, 40].map((m) => <div key={m} className="flex justify-between py-0.5"><span>%{m} marj</span><b className="tabular-nums">{tl(suggest(m))}{c.eur_rate ? <span className="text-muted font-normal"> · {money(Math.round(suggest(m) / c.eur_rate), "EUR")}</span> : null}</b></div>)}
          </div>
        </section>

        {c.missing_prices > 0 && <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{c.missing_prices} malzemenin fiyatı yok; maliyet eksik görünür. Aşağıdan birim fiyatı girin ya da alış faturası işleyin (ortalama alış fiyatı kendiliğinden kullanılır).</p>}
        {!c.materials.length && !c.labor.length && canEdit && (
          <form action={seedNoritake} className="rounded-[16px] border border-dashed border-brand-600 bg-white p-4 flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="product_id" value={id} />
            <span className="flex-1">Bu ürünün reçetesi yok. Metal destekli porselen ise hazır Noritake / döküm reçetesini yükleyebilirsiniz.</span>
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Noritake reçetesini yükle</PendingSubmit>
          </form>
        )}

        <section className="rounded-[20px] border border-line bg-white overflow-x-auto">
          <div className="flex items-baseline gap-2 px-4 pt-4"><h2 className="font-display font-bold text-brand-800">Saf malzeme</h2><span className="text-sm text-muted">{tl(c.material)}</span></div>
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Malzeme</th><th className="p-3 text-right">Miktar / üye</th><th className="p-3 text-right">Fire %</th><th className="p-3 text-right">Birim fiyat</th><th className="p-3 text-right">Tutar</th><th className="p-3 w-40">Pay</th></tr></thead>
            <tbody>
              {c.materials.map((m) => (
                <tr key={m.bom_id} className="border-t border-[#EEF2F6]">
                  <td className="p-3"><span className="font-semibold">{m.name}</span><span className="block text-xs text-muted">{m.code}{m.note ? ` · ${m.note}` : ""}</span></td>
                  <td className="p-3 text-right" colSpan={canEdit ? 2 : 1}>
                    {canEdit ? (
                      <form action={saveBomLine} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="bom_id" value={m.bom_id} /><input type="hidden" name="product_id" value={id} />
                        <input name="qty" defaultValue={String(Number(m.qty)).replace(".", ",")} inputMode="decimal" className="h-8 w-20 rounded-md border border-[#D5DEE8] px-2 text-right" aria-label="Miktar" />
                        <span className="text-xs text-muted w-8">{m.unit}</span>
                        <input name="waste_pct" defaultValue={String(Number(m.waste_pct))} inputMode="decimal" className="h-8 w-14 rounded-md border border-[#D5DEE8] px-2 text-right" aria-label="Fire yüzdesi" />
                        <PendingSubmit className="h-8 px-2 rounded-md border border-line text-xs font-semibold">✓</PendingSubmit>
                      </form>
                    ) : `${num(m.qty)} ${m.unit}`}
                  </td>
                  {!canEdit && <td className="p-3 text-right">%{Number(m.waste_pct)}</td>}
                  <td className="p-3 text-right">
                    {canEdit ? (
                      <form action={saveItemPrice} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="item_id" value={m.item_id} /><input type="hidden" name="product_id" value={id} />
                        <input name="price" defaultValue={m.purchase_price != null ? kur(m.purchase_price) : ""} placeholder={kur(m.unit_cost)} inputMode="decimal" className="h-8 w-24 rounded-md border border-[#D5DEE8] px-2 text-right" aria-label="Birim fiyat" />
                        <select name="currency" defaultValue={m.currency || "TRY"} className="h-8 rounded-md border border-[#D5DEE8] px-1 text-xs">{["TRY", "EUR", "USD"].map((x) => <option key={x}>{x}</option>)}</select>
                        <PendingSubmit className="h-8 px-2 rounded-md border border-line text-xs font-semibold">✓</PendingSubmit>
                      </form>
                    ) : tl(m.unit_cost)}
                    <span className="block text-[11px] text-muted">kullanılan: {tl(m.unit_cost)} / {m.unit}</span>
                  </td>
                  <td className="p-3 text-right tabular-nums font-semibold">{tl(m.cost)}</td>
                  <td className="p-3"><div className="h-2 rounded-full bg-[#EEF2F6]"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${c.material ? (m.cost / c.material) * 100 : 0}%` }} /></div><span className="text-[11px] text-muted">%{c.material ? Math.round((m.cost / c.material) * 100) : 0}</span></td>
                </tr>
              ))}
              {!c.materials.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Malzeme satırı yok.</td></tr>}
            </tbody>
          </table>
          {matShare.length > 0 && <p className="px-4 pb-4 text-xs text-muted">En büyük kalemler: {matShare.slice(0, 3).map((m) => `${m.name} (${tl(m.cost)})`).join(", ")}. Kullanılan birim fiyat: stoktaki ortalama alış fiyatı; alış yoksa kartta yazan fiyat.</p>}
        </section>

        <section className="rounded-[20px] border border-line bg-white overflow-x-auto">
          <div className="flex items-baseline gap-2 px-4 pt-4"><h2 className="font-display font-bold text-brand-800">İşçilik</h2><span className="text-sm text-muted">{tl(c.labor_total)} · {c.minutes} dk</span></div>
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Adım / istasyon</th><th className="p-3 text-right">Süre (dk / üye)</th><th className="p-3 text-right">Dakika ücreti</th><th className="p-3 text-right">Tutar</th></tr></thead>
            <tbody>
              {c.labor.map((l) => (
                <tr key={l.step_id} className="border-t border-[#EEF2F6]">
                  <td className="p-3 font-semibold">{l.station}</td>
                  <td className="p-3 text-right" colSpan={canEdit ? 2 : 1}>
                    {canEdit ? (
                      <form action={saveStep} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="step_id" value={l.step_id} /><input type="hidden" name="station_id" value={l.station_id} /><input type="hidden" name="product_id" value={id} />
                        <input name="minutes" defaultValue={String(l.minutes)} inputMode="numeric" className="h-8 w-16 rounded-md border border-[#D5DEE8] px-2 text-right" aria-label="Dakika" />
                        <span className="text-xs text-muted">dk ·</span>
                        <input name="rate" defaultValue={l.own_rate ? kur(l.rate) : ""} placeholder={`${kur(l.rate)} (genel)`} disabled={!canRate} inputMode="decimal" className="h-8 w-28 rounded-md border border-[#D5DEE8] px-2 text-right" aria-label="Dakika ücreti" />
                        <span className="text-xs text-muted">TL/dk</span>
                        <PendingSubmit className="h-8 px-2 rounded-md border border-line text-xs font-semibold">✓</PendingSubmit>
                      </form>
                    ) : `${l.minutes} dk`}
                  </td>
                  {!canEdit && <td className="p-3 text-right">{kur(l.rate)} TL{l.own_rate ? "" : " (genel)"}</td>}
                  <td className="p-3 text-right tabular-nums font-semibold">{tl(l.cost)}</td>
                </tr>
              ))}
              {!c.labor.length && <tr><td colSpan={4} className="p-6 text-center text-muted">Üretim adımı yok. Rota ekranından istasyon ve dakika girin.</td></tr>}
            </tbody>
          </table>
          <p className="px-4 pb-4 text-xs text-muted">İstasyon ücreti boşsa genel dakika ücreti ({kur(c.settings.labor_rate_min)} TL) kullanılır. Süreler seri üretim içindir; tek tek çalışılan işlerde süre uzar.</p>
        </section>

        <section className="rounded-[20px] border border-line bg-white p-4">
          <h2 className="font-display font-bold text-brand-800 mb-2">Maliyet özeti</h2>
          <table className="w-full text-sm max-w-xl">
            <tbody>
              {([
                ["Saf malzeme", c.material, ""],
                ["İşçilik", c.labor_total, `${c.minutes} dk`],
                ...(Number(c.piece ?? 0) > 0 ? [["Parça başı işçilik payı", Number(c.piece), "son 90 gün, üye başına"] as [string, number, string]] : []),
                ["Üretim genel gideri", c.overhead, "üye başına sabit"],
                ["Tekrar / fire payı", c.remake, `%${Number(c.settings.remake_pct)} (malzeme + işçilik)`],
                ["Üretim maliyeti", c.production, ""],
                ["Pazarlama ve satış", c.marketing, `%${Number(c.settings.marketing_pct)}`],
                ["Genel yönetim", c.admin, `%${Number(c.settings.admin_pct)}`],
                ["Finansman", c.finance, `%${Number(c.settings.finance_pct)}`],
                ["Tam maliyet", c.total, ""],
              ] as [string, number, string][]).map(([l, v, n]) => (
                <tr key={l} className={`border-t border-[#EEF2F6] ${l === "Üretim maliyeti" || l === "Tam maliyet" ? "font-bold" : ""}`}>
                  <td className="py-2">{l}<span className="text-xs text-muted font-normal">{n ? ` · ${n}` : ""}</span></td><td className="py-2 text-right tabular-nums">{tl(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted mt-2">Oranlar <Link href="/uretim/maliyet" className="font-semibold text-brand-700">Ürün maliyetleri</Link> sayfasından değiştirilir ve tüm ürünlere uygulanır.</p>
        </section>
      </div>
    </>
  );
}
