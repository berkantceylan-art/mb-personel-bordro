import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, KPI, Table, page, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCategories, loadStock, loadWarehouses } from "@/lib/stock-data";
import { ITEM_KIND, MOVE_KIND, qty, type Item } from "@/lib/stock";
import { fmt } from "@/lib/fin";
import { ItemForm } from "../../_parts/ItemForm";
import { AdjustForm } from "../../_parts/AdjustForm";

export const dynamic = "force-dynamic";

/** Kart detayı: depo / lot bazında stok, hareketler, reçete kullanımı */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("stk_items").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const item = data as Item;
  const [stock, warehouses, categories, { data: moves }, { data: tot }, { data: boms }, { data: sup }, { data: prods }] = await Promise.all([
    loadStock({ item: id }), loadWarehouses(), loadCategories(),
    supabase.from("stk_moves").select("id, move_date, qty, unit_cost, kind, warehouse_id, lot_no, expiry_date, note, job_id, doc_type, doc_id").eq("item_id", id).order("move_date", { ascending: false }).order("id", { ascending: false }).limit(300),
    supabase.from("stk_item_totals").select("qty, avg_cost, value").eq("item_id", id).maybeSingle(),
    supabase.from("stk_boms").select("id, qty, lab_products(name)").eq("item_id", id),
    supabase.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).eq("is_active", true).order("name"),
    supabase.from("lab_products").select("id, name").eq("is_active", true).order("name"),
  ]);
  const wname = new Map(warehouses.map((w) => [w.id, w.name]));
  const canEdit = (s.modules.stock ?? 0) >= 2;
  const total = Number(tot?.qty ?? 0);
  return (
    <>
      <PageHeader title={item.name} subtitle={`${item.code} · ${ITEM_KIND[item.kind]} · ${item.unit}${item.barcode ? ` · ${item.barcode}` : ""}`} actions={<span className="flex gap-4"><Link href={`/yazdir/stok-etiket?ids=${item.id}`} className="text-sm font-semibold text-brand-700">Etiket</Link><Link href="/stok/urunler" className="text-sm font-semibold text-brand-700">← Kartlar</Link></span>} />
      <div className={page}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Toplam stok" value={`${qty(total)} ${item.unit}`} tone={total < 0 || (item.min_qty !== null && total < Number(item.min_qty)) ? "bad" : undefined} sub={item.min_qty !== null ? `asgari ${qty(item.min_qty)}` : undefined} />
          <KPI label="Ortalama maliyet" value={fmt(Number(tot?.avg_cost ?? 0))} />
          <KPI label="Stok değeri" value={fmt(Number(tot?.value ?? 0))} />
          <KPI label="Satış fiyatı" value={item.sale_price ? fmt(item.sale_price, item.sale_currency) : "—"} sub={`KDV %${item.vat_rate}`} />
        </div>
        <Card title="Depo ve lot bazında stok">
          <Table head={["Depo", "Lot", "Son kullanma", "Miktar"]} min={520}>
            {stock.map((r, n) => (
              <tr key={n}><td className={td}>{wname.get(r.warehouse_id)}</td><td className={`${td} num`}>{r.lot_no ?? "—"}</td><td className={td}>{r.expiry_date ? formatDate(r.expiry_date) : "—"}</td><td className={`${tdNum} ${r.qty < 0 ? "text-bad" : ""}`}>{qty(r.qty)} {item.unit}</td></tr>
            ))}
            {stock.length === 0 && <EmptyRow cols={4} text="Stok yok." />}
          </Table>
        </Card>
        {canEdit && <Card title="Stok girişi / düzeltme"><AdjustForm item={item} warehouses={warehouses} /></Card>}
        <Card title="Hareketler (son 300)">
          <Table head={["Tarih", "Hareket", "Depo", "Lot", "Miktar", "Birim maliyet", "Not"]} min={860}>
            {(moves ?? []).map((m) => (
              <tr key={m.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDate(m.move_date)}</td>
                <td className={td}><Chip tone={MOVE_KIND[m.kind]?.[1]}>{MOVE_KIND[m.kind]?.[0] ?? m.kind}</Chip></td>
                <td className={td}>{wname.get(m.warehouse_id)}</td>
                <td className={`${td} num`}>{m.lot_no ?? "—"}{m.expiry_date && <span className="block text-xs text-muted">SKT {formatDate(m.expiry_date)}</span>}</td>
                <td className={`${tdNum} ${Number(m.qty) < 0 ? "text-bad" : "text-ok"}`}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)}</td>
                <td className={tdNum}>{m.unit_cost ? fmt(m.unit_cost) : "—"}</td>
                <td className={td}>{m.job_id ? <Link href={`/isler/${m.job_id}`} className="text-brand-700">İş kaydı</Link> : m.doc_type === "transfer" ? <Link href={`/stok/transfer/${m.doc_id}`} className="text-brand-700">Transfer</Link> : m.doc_type === "count" ? <Link href={`/stok/sayim/${m.doc_id}`} className="text-brand-700">Sayım</Link> : m.note ?? ""}</td>
              </tr>
            ))}
            {(moves ?? []).length === 0 && <EmptyRow cols={7} />}
          </Table>
        </Card>
        {(boms ?? []).length > 0 && (
          <Card title="Kullanıldığı reçeteler">
            <ul className="text-sm">{(boms ?? []).map((b) => <li key={b.id}>{(b.lab_products as unknown as { name: string } | null)?.name}: birim başına {qty(b.qty)} {item.unit}</li>)}</ul>
          </Card>
        )}
        {canEdit && <Card title="Kart bilgileri"><ItemForm item={item} categories={categories} warehouses={warehouses} suppliers={sup ?? []} products={prods ?? []} /></Card>}
      </div>
    </>
  );
}
