import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Notice, Table, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCategories, loadItems, loadWarehouses } from "@/lib/stock-data";
import { saveStockCategory } from "@/lib/stock-actions";
import { ITEM_KIND, qty } from "@/lib/stock";
import { fmt } from "@/lib/fin";
import { ItemForm } from "../_parts/ItemForm";

export const dynamic = "force-dynamic";

/** Ürün / malzeme kartları */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string; kat?: string; durum?: string }> }) {
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
  return (
    <>
      <PageHeader title="Ürün / malzeme kartları" subtitle={`${rows.length} kart`} actions={<Link href={`/yazdir/stok-etiket?ids=${shown.slice(0, 60).map((i) => i.id).join(",")}`} className="text-sm font-semibold text-brand-700">Etiket yazdır</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Ad, kod, barkod, marka" className={`${inputCls} w-64`} />
          <select name="tur" defaultValue={sp.tur ?? ""} className={`${selectCls} w-44`}><option value="">Tüm türler</option>{Object.entries(ITEM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="kat" defaultValue={sp.kat ?? ""} className={`${selectCls} w-44`}><option value="">Tüm kategoriler</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="durum" defaultValue={sp.durum ?? ""} className={`${selectCls} w-44`}><option value="">Aktif kartlar</option><option value="az">Asgari stok altı</option><option value="eksi">Eksi stok</option><option value="pasif">Pasif kartlar</option></select>
          <button className={btnSecondary}>Filtrele</button>
        </form>
        <Table head={["Kod", "Ad", "Tür", "Kategori", "Stok", "Ort. maliyet", "Değer"]} min={900}>
          {shown.map((i) => {
            const low = i.min_qty !== null && i.qty < Number(i.min_qty);
            return (
              <tr key={i.id}>
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
          {shown.length === 0 && <EmptyRow cols={7} />}
        </Table>
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
