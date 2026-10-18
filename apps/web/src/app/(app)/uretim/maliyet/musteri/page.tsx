import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { loadCustomerMargin, MP, productSummary } from "@/lib/customer-margin";
import { CustomerTable } from "./CustomerTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Müşteri fiyatları ve kârlılık" };

const tl = (k: number | null) => (k == null ? "—" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ₺");

/** Tüm müşterilerin fiyat listesi + son dönem satışları, ürün maliyetine göre kâr / zarar */
export default async function CustomerMarginPage({ searchParams }: { searchParams: Promise<{ urun?: string; ay?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1 && !["owner", "accountant"].includes(s.role)) redirect("/");
  const months = [3, 6, 12, 24].includes(Number(sp.ay)) ? Number(sp.ay) : 12;
  const { rows, products, eur, error } = await loadCustomerMargin(await createClient(), months);
  const summary = productSummary(rows, products);
  // Varsayılan ürün: en çok satan metal porselen (CCM)
  const mp = summary.filter((p) => MP.test(p.name));
  const sel = sp.urun === "tumu" ? null : summary.find((p) => p.id === sp.urun) ?? mp[0] ?? summary[0] ?? null;
  const selRows = sel ? rows.filter((r) => r.productId === sel.id) : rows;
  const qs = (o: Record<string, string>) => new URLSearchParams({ ay: String(months), ...(sel ? { urun: sel.id } : { urun: "tumu" }), ...o }).toString();
  const missingSql = /prd_customer_margin|prd_cost_for|schema cache|does not exist/.test(error ?? "");

  const totQ = selRows.reduce((t, r) => t + r.qty, 0);
  const totR = selRows.reduce((t, r) => t + r.revTry, 0);
  const totP = selRows.reduce((t, r) => t + (r.profit ?? 0), 0);
  const losers = selRows.filter((r) => (r.unitMargin ?? 0) < 0);
  const lossQ = losers.reduce((t, r) => t + r.qty, 0);
  const lossP = losers.reduce((t, r) => t + Math.min(0, r.profit ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Müşteri fiyatları ve kârlılık"
        subtitle="Her müşterinin fiyat listesi (özel / liste fiyatı) ve son dönemde fiilen kaça sattığımız → ürün maliyetine göre üye başı ve toplam kâr / zarar"
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={`/uretim/maliyet/musteri/excel?${qs({})}`} className="text-brand-700">⬇ Excel</a><Link href="/uretim/maliyet" className="text-brand-700">← Ürün maliyetleri</Link></span>}
      />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {missingSql && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">Supabase&apos;de mbdental-maliyet-hiz.sql çalıştırılmalı.</p>}
        {!missingSql && error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{error}</p>}

        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">Ürün
            <select name="urun" defaultValue={sel?.id ?? "tumu"} className="h-10 w-[420px] max-w-full rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm">
              <option value="tumu">Tüm ürünler (müşteri × ürün)</option>
              {mp.length > 0 && <optgroup label="Metal porselen (CCM)">{mp.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
              <optgroup label="Diğer ürünler">{summary.filter((p) => !MP.test(p.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Satış dönemi
            <select name="ay" defaultValue={String(months)} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm">
              <option value="3">Son 3 ay</option><option value="6">Son 6 ay</option><option value="12">Son 12 ay</option><option value="24">Son 24 ay</option>
            </select>
          </label>
          <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Göster</button>
          {eur > 0 && <span className="text-xs text-muted ml-auto">€ kuru {eur.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} · € ve $ satışlar bugünkü kurla TL&apos;ye çevrildi</span>}
        </form>

        {sel && (
          <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <div className="col-span-2 lg:col-span-1 rounded-[16px] p-4 bg-gradient-to-br from-[#0A3D73] to-[#1565A8] text-white">
              <span className="text-xs opacity-80">Üye başı tam maliyet</span>
              <b className="num block font-display text-2xl">{sel.cost == null ? "Reçete yok" : tl(sel.cost)}</b>
              <span className="text-xs opacity-80">üretim maliyeti {tl(sel.production)}{sel.cost != null && <> · <Link href={`/uretim/maliyet/${sel.id}`} className="underline">detay</Link></>}</span>
            </div>
            <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Fiilî ortalama satış</span><b className="num block font-display text-xl text-brand-800">{tl(totQ ? Math.round(totR / totQ) : null)}</b><span className="text-xs text-muted">en düşük {tl(sel.min)} · en yüksek {tl(sel.max)}</span></div>
            <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Son {months} ay satış</span><b className="num block font-display text-xl text-brand-800">{totQ.toLocaleString("tr-TR")} üye</b><span className="text-xs text-muted">ciro {tl(totR)}</span></div>
            <div className={`rounded-[16px] p-4 ${losers.length ? "bg-bad-bg" : "bg-ok-bg"}`}><span className={`text-xs ${losers.length ? "text-bad" : "text-ok"}`}>Maliyetin altında satılan</span><b className={`num block font-display text-xl ${losers.length ? "text-bad" : "text-ok"}`}>{losers.length} müşteri</b><span className={`text-xs ${losers.length ? "text-bad" : "text-ok"}`}>{lossQ.toLocaleString("tr-TR")} üye · zarar {tl(Math.abs(lossP))}</span></div>
            <div className={`rounded-[16px] p-4 ${totP < 0 ? "bg-bad-bg" : "bg-ok-bg"}`}><span className={`text-xs ${totP < 0 ? "text-bad" : "text-ok"}`}>Dönem net sonuç</span><b className={`num block font-display text-xl ${totP < 0 ? "text-bad" : "text-ok"}`}>{totP < 0 ? "ZARAR " : "KÂR "}{tl(Math.abs(totP))}</b><span className={`text-xs ${totP < 0 ? "text-bad" : "text-ok"}`}>{totR ? `marj %${Math.round((1000 * totP) / totR) / 10}` : ""}</span></div>
          </section>
        )}

        {sel?.cost == null && sel && <p className="text-sm text-warn bg-warn-bg rounded-lg p-3">Bu ürünün üretim reçetesi yok; kâr / zarar hesaplanamaz. <Link href="/uretim/recete-sihirbazi" className="font-semibold underline">Reçete sihirbazı</Link> ile reçete oluşturun.</p>}

        <CustomerTable rows={selRows} showProduct={!sel} />

        <section className="bg-white border border-line rounded-[16px] overflow-x-auto">
          <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">Ürün bazında özet · son {months} ay</h2>
          <table className="w-full text-[13px] min-w-[900px]">
            <thead><tr className="text-left text-xs text-muted">
              {["Ürün", "Müşteri", "Adet", "Ort. satış", "En düşük – en yüksek", "Tam maliyet", "Zararda müşteri", "Kâr / zarar"].map((h, i) => <th key={h} className={`py-2 px-3 first:pl-5 font-semibold border-b border-line ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {summary.filter((p) => p.qty > 0).map((p) => (
                <tr key={p.id} className={p.id === sel?.id ? "bg-[#F3F8FD]" : ""}>
                  <td className="py-2 pl-5 pr-3 border-b border-[#EEF2F6]"><Link href={`?${new URLSearchParams({ ay: String(months), urun: p.id })}`} className="font-semibold text-brand-700">{p.name}</Link></td>
                  <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right">{p.customers}</td>
                  <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right">{p.qty.toLocaleString("tr-TR")}</td>
                  <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right font-semibold">{tl(p.avg)}</td>
                  <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right text-muted">{tl(p.min)} – {tl(p.max)}</td>
                  <td className="num py-2 px-3 border-b border-[#EEF2F6] text-right">{p.cost == null ? <span className="text-warn text-xs">reçete yok</span> : tl(p.cost)}</td>
                  <td className={`num py-2 px-3 border-b border-[#EEF2F6] text-right ${p.losers ? "text-bad font-semibold" : "text-muted"}`}>{p.cost == null ? "—" : p.losers}</td>
                  <td className={`num py-2 px-3 border-b border-[#EEF2F6] text-right font-bold ${p.profit == null ? "text-muted" : p.profit < 0 ? "text-bad" : "text-ok"}`}>{p.profit == null ? "—" : `${p.profit < 0 ? "▼ " : "▲ +"}${tl(Math.abs(p.profit))}`}</td>
                </tr>
              ))}
              {!summary.some((p) => p.qty > 0) && <tr><td colSpan={8} className="px-5 py-6 text-muted">Bu dönemde satış yok.</td></tr>}
            </tbody>
          </table>
        </section>

        <p className="text-xs text-muted leading-relaxed">
          <b>Hesap:</b> Fiyat listesi = hekime özel fiyat, yoksa ürün liste fiyatı. Fiilî ortalama = seçilen dönemde o müşteriye kesilen ücretli kalemlerin (prova / tekrar / ücretsiz hariç) toplamı ÷ üye sayısı.
          Tam maliyet = malzeme + işçilik + parça başı payı + üretim genel gideri + tekrar payı + pazarlama + genel yönetim + finansman (<Link href="/uretim/maliyet" className="text-brand-700 font-semibold">Ürün maliyetleri</Link> ayarlarından).
          Üye başı kâr = fiilî ortalama (satış yoksa liste fiyatı) − tam maliyet; dönem kâr / zarar = üye başı kâr × adet. Maliyet doğruluğu reçetedeki malzeme fiyatlarına bağlıdır.
        </p>
      </div>
    </>
  );
}
