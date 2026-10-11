import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Money, Notice, btnPrimary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { deleteBom, saveBom } from "@/lib/stock-actions";
import { qty } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Ürün reçeteleri (malzeme ihtiyacı): her laboratuvar ürünü için birim başına tüketilen malzeme. Üretimde otomatik stok düşümü buradan yapılır. */
export default async function BomPage({ searchParams }: { searchParams: Promise<{ urun?: string }> }) {
  const s = await getSession();
  const level = s.modules.stock ?? 0;
  if (level < 1) redirect("/");
  const { urun } = await searchParams;
  const supabase = await createClient();
  const [{ data: products }, { data: boms, error }, { data: items }, { data: tot }] = await Promise.all([
    supabase.from("lab_products").select("id, code, name, material, per_unit, price_try, is_active").order("sort").order("name"),
    supabase.from("stk_boms").select("id, lab_product_id, item_id, qty, waste_pct, note"),
    supabase.from("stk_items").select("id, code, name, unit, kind").eq("is_active", true).neq("kind", "service").order("name").limit(5000),
    supabase.from("stk_item_totals").select("item_id, avg_cost").limit(5000),
  ]);
  type P = { id: string; code: string | null; name: string; material: string | null; per_unit: boolean; price_try: number | null; is_active: boolean };
  type B = { id: string; lab_product_id: string; item_id: string; qty: number; waste_pct: number; note: string | null };
  type I = { id: string; code: string; name: string; unit: string };
  const ps = (products ?? []) as P[];
  const bs = (boms ?? []) as B[];
  const is = (items ?? []) as I[];
  const imap = new Map(is.map((i) => [i.id, i]));
  const cost = new Map((tot ?? []).map((t) => [t.item_id as string, Number(t.avg_cost ?? 0)]));
  const byProduct = new Map<string, B[]>();
  for (const b of bs) byProduct.set(b.lab_product_id, [...(byProduct.get(b.lab_product_id) ?? []), b]);
  const lineCost = (b: B) => Math.round(Number(b.qty) * (1 + Number(b.waste_pct) / 100) * (cost.get(b.item_id) ?? 0));
  const shown = urun ? ps.filter((p) => p.id === urun) : ps;

  return (
    <>
      <PageHeader title="Ürün reçeteleri" subtitle="Hangi üründe birim (diş / adet) başına hangi malzemeden ne kadar harcanır? Üretim modülü stok düşümünü ve maliyeti buradan hesaplar." />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        {ps.length === 0 && <Notice>Önce Laboratuvar &gt; Ürün / fiyat listesinden ürün tanımlayın.</Notice>}
        {is.length === 0 && <Notice tone="info">Reçeteye eklemek için önce <Link href="/stok/urunler" className="font-semibold underline">malzeme kartı</Link> açın.</Notice>}
        {urun && <Link href="/stok/receteler" className="text-sm font-semibold text-brand-700">← Tüm ürünler</Link>}
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((p) => {
            const rows = byProduct.get(p.id) ?? [];
            const total = rows.reduce((t, b) => t + lineCost(b), 0);
            const price = Number(p.price_try ?? 0);
            return (
              <section key={p.id} className={`bg-white border border-line rounded-[14px] overflow-hidden ${p.is_active ? "" : "opacity-60"}`}>
                <header className="px-4 py-3 border-b border-line flex flex-wrap items-baseline gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  <span className="text-xs text-muted">{p.code ?? ""} {p.material ?? ""} · {p.per_unit ? "diş başına" : "iş başına"}</span>
                  <span className="ml-auto text-sm">Malzeme maliyeti <b><Money v={total} /></b>{price > 0 && total > 0 && <span className="text-muted"> · fiyatın %{Math.round((total / price) * 100)}&apos;i</span>}</span>
                </header>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted"><th className={th}>Malzeme</th><th className={`${th} text-right`}>Miktar</th><th className={`${th} text-right`}>Fire</th><th className={`${th} text-right`}>Maliyet</th><th className={th} /></tr></thead>
                  <tbody>
                    {rows.map((b) => {
                      const it = imap.get(b.item_id);
                      return (
                        <tr key={b.id}>
                          <td className={td}>{it?.name ?? "?"}<span className="block text-xs text-muted num">{it?.code}{b.note ? ` · ${b.note}` : ""}</span></td>
                          <td className={tdNum}>{qty(b.qty)} {it?.unit}</td>
                          <td className={tdNum}>%{qty(b.waste_pct)}</td>
                          <td className={tdNum}><Money v={lineCost(b)} /></td>
                          <td className={`${td} text-right`}>{level >= 2 && <form action={deleteBom}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit label="Sil" /></form>}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={5} className="py-4 px-3 text-muted">Reçete yok.</td></tr>}
                  </tbody>
                </table>
                {level >= 2 && is.length > 0 && (
                  <form action={saveBom} className="p-3 bg-[#F8FAFC] border-t border-line grid gap-2 grid-cols-[1fr_90px_70px_auto] items-center">
                    <input type="hidden" name="lab_product_id" value={p.id} />
                    <select name="item_id" required className={`${selectCls} h-10`} aria-label="Malzeme">
                      <option value="">Malzeme seçin</option>
                      {is.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                    </select>
                    <input name="qty" required inputMode="decimal" placeholder="Miktar" className={`${inputCls} h-10 text-right`} />
                    <input name="waste_pct" inputMode="decimal" placeholder="Fire %" className={`${inputCls} h-10 text-right`} />
                    <PendingSubmit className={`${btnPrimary} h-10`}>Ekle</PendingSubmit>
                    <input name="note" maxLength={200} placeholder="Not (isteğe bağlı)" className={`${inputCls} h-9 col-span-4`} />
                  </form>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
