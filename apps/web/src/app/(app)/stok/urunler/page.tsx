import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Notice, Table, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCategories, loadItems, loadWarehouses } from "@/lib/stock-data";
import { saveStockCategory } from "@/lib/stock-actions";
import { ITEM_KIND, qty, stockImageUrl } from "@/lib/stock";
import { ItemImage } from "@/components/stock/ItemImage";
import { fmt } from "@/lib/fin";
import { ItemForm } from "../_parts/ItemForm";
import { syncProductStockCards } from "@/lib/product-stock-actions";

export const dynamic = "force-dynamic";

/** Ürün / malzeme kartları */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string; kat?: string; durum?: string; gorunum?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ rows, error }, categories, warehouses, { data: sup }, { data: prods }] = await Promise.all([
    loadItems(), loadCategories(), loadWarehouses(),
    supabase.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).eq("is_active", true).order("name"),
    supabase.from("lab_products").select("id, name").eq("is_active", true).order("name"),
  ]);
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const shown = rows.filter((i) =>
    (!sp.tur || i.kind === sp.tur) && (!sp.kat || i.category_id === sp.kat) &&
    (sp.durum !== "az" || (i.min_qty !== null && i.qty < Number(i.min_qty))) && (sp.durum !== "eksi" || i.qty < 0) && (sp.durum !== "pasif" ? i.is_active : !i.is_active) &&
    (!q || `${i.name} ${i.code} ${i.barcode ?? ""} ${i.brand ?? ""}`.toLocaleLowerCase("tr").includes(q)));
  const canEdit = (s.modules.stock ?? 0) >= 2;
  const gallery = sp.gorunum === "galeri";
  const qs = (g: boolean) => {
    const u = new URLSearchParams();
    for (const k of ["q", "tur", "kat", "durum"] as const) if (sp[k]) u.set(k, sp[k]!);
    if (g) u.set("gorunum", "galeri");
    const t = u.toString();
    return t ? `/stok/urunler?${t}` : "/stok/urunler";
  };
  const noImg = shown.filter((i) => !i.image_path).length;
  return (
    <>
      <PageHeader title="Ürün / malzeme kartları" subtitle={`${rows.length} kart`} actions={<span className="flex flex-wrap items-center gap-3">{canEdit && <form action={syncProductStockCards}><PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Protezleri stok kartına aktar</PendingSubmit></form>}<Link href="/isler/urunler" className="text-sm font-semibold text-brand-700">Protez ürünleri (Türkçe adlar)</Link><Link href={`/yazdir/stok-etiket?ids=${shown.slice(0, 60).map((i) => i.id).join(",")}`} className="text-sm font-semibold text-brand-700">Etiket yazdır</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Ad, kod, barkod, marka" className={`${inputCls} w-64`} />
          <select name="tur" defaultValue={sp.tur ?? ""} className={`${selectCls} w-44`}><option value="">Tüm türler</option>{Object.entries(ITEM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="kat" defaultValue={sp.kat ?? ""} className={`${selectCls} w-44`}><option value="">Tüm kategoriler</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="durum" defaultValue={sp.durum ?? ""} className={`${selectCls} w-44`}><option value="">Aktif kartlar</option><option value="az">Asgari stok altı</option><option value="eksi">Eksi stok</option><option value="pasif">Pasif kartlar</option></select>
          {gallery && <input type="hidden" name="gorunum" value="galeri" />}
          <button className={btnSecondary}>Filtrele</button>
          <span className="ml-auto inline-flex rounded-[10px] border border-line overflow-hidden text-sm font-semibold">
            <Link href={qs(false)} className={`px-3 py-2 ${gallery ? "bg-white text-muted" : "bg-brand-700 text-white"}`}>Liste</Link>
            <Link href={qs(true)} className={`px-3 py-2 ${gallery ? "bg-brand-700 text-white" : "bg-white text-muted"}`}>Resimli</Link>
          </span>
        </form>
        {gallery ? (
          <>
            <p className="text-sm text-muted">{shown.length} kart{noImg ? ` · ${noImg} kartın resmi yok` : ""}{canEdit ? " · Resim eklemek / değiştirmek için kutuya tıklayın (telefonda kamera da açılır)." : ""}</p>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {shown.slice(0, 400).map((i) => (
                <div key={i.id} className="bg-white border border-line rounded-[14px] p-2.5 flex flex-col gap-2">
                  <ItemImage itemId={i.id} url={stockImageUrl(i.image_path)} name={i.name} canEdit={canEdit} size="sm" />
                  <Link href={`/stok/urunler/${i.id}`} className="text-sm font-semibold text-brand-700 leading-snug line-clamp-2">{i.name}</Link>
                  <span className="text-xs text-muted num">{i.code}{i.sale_price ? ` · ${fmt(i.sale_price, i.sale_currency)}` : ""}</span>
                </div>
              ))}
            </div>
            {shown.length > 400 && <Notice tone="info">İlk 400 kart gösteriliyor; aramayı ya da tür / kategori filtresini daraltın.</Notice>}
          </>
        ) : (
        <Table head={["", "Kod", "Ad", "Tür", "Kategori", "Stok", "Ort. maliyet", "Değer"]} min={940}>
          {shown.map((i) => {
            const low = i.min_qty !== null && i.qty < Number(i.min_qty);
            return (
              <tr key={i.id}>
                <td className={`${td} w-12`}>{i.image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={stockImageUrl(i.image_path)!} alt="" loading="lazy" className="w-10 h-10 rounded-[8px] object-cover border border-line bg-white" />
                ) : <span className="block w-10 h-10 rounded-[8px] bg-[#F1F4F8]" />}</td>
                <td className={`${td} num text-muted`}>{i.code}</td>
                <td className={td}><Link href={`/stok/urunler/${i.id}`} className="font-semibold text-brand-700">{i.name}</Link>{i.brand && <span className="block text-xs text-muted">{i.brand}</span>}</td>
                <td className={td}>{ITEM_KIND[i.kind]}{i.track_lot && <span className="ml-1.5"><Chip tone="blue">lot</Chip></span>}</td>
                <td className={td}>{i.category ?? "—"}</td>
                <td className={`${tdNum} ${i.qty < 0 || low ? "text-bad font-semibold" : ""}`}>{i.kind === "service" ? "—" : `${qty(i.qty)} ${i.unit}`}</td>
                <td className={tdNum}>{i.avg_cost ? fmt(i.avg_cost) : "—"}</td>
                <td className={tdNum}>{i.value ? fmt(i.value) : "—"}</td>
              </tr>
            );
          })}
          {shown.length === 0 && <EmptyRow cols={8} />}
        </Table>
        )}
        {canEdit && (
          <>
            <div id="yeni"><Card title="Yeni kart"><ItemForm categories={categories} warehouses={warehouses} suppliers={sup ?? []} products={prods ?? []} /></Card></div>
            <Card title="Yeni kategori">
              <form action={saveStockCategory} className="grid gap-3 sm:grid-cols-[1fr_auto] items-end max-w-xl">
                <Field label="Kategori adı"><input name="name" required maxLength={80} placeholder="Zirkon, porselen tozu, implant parçası…" className={inputCls} /></Field>
                <PendingSubmit className={btnPrimary}>Ekle</PendingSubmit>
              </form>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
