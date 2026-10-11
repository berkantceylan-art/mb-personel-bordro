import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { EmptyRow, Field, KPI, Table, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { loadItems, loadStock, loadWarehouses } from "@/lib/stock-data";
import { saveWarehouse } from "@/lib/stock-actions";
import { WH_KIND, qty } from "@/lib/stock";
import { fmt } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Depo içeriği */
export default async function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const [warehouses, stock, { rows: items }] = await Promise.all([loadWarehouses(), loadStock({ warehouse: id }), loadItems()]);
  const w = warehouses.find((x) => x.id === id);
  if (!w) notFound();
  const imap = new Map(items.map((i) => [i.id, i]));
  const rows = stock.sort((a, b) => (imap.get(a.item_id)?.name ?? "").localeCompare(imap.get(b.item_id)?.name ?? "", "tr"));
  const value = rows.reduce((a, r) => a + r.qty * (imap.get(r.item_id)?.avg_cost ?? 0), 0);
  return (
    <>
      <PageHeader title={w.name} subtitle={WH_KIND[w.kind]} actions={<span className="flex gap-4"><Link href={`/stok/transfer/yeni?kaynak=${w.id}`} className="text-sm font-semibold text-brand-700">Transfer</Link><Link href="/stok/sayim" className="text-sm font-semibold text-brand-700">Sayım</Link></span>} />
      <div className={page}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPI label="Kalem" value={new Set(rows.map((r) => r.item_id)).size} />
          <KPI label="Değer" value={fmt(Math.round(value))} />
          <KPI label="Sorumlu" value={w.responsible ?? "—"} />
        </div>
        <Table head={["Kod", "Malzeme", "Lot", "SKT", "Miktar", "Değer"]} min={760}>
          {rows.map((r, n) => {
            const i = imap.get(r.item_id);
            return (
              <tr key={n}>
                <td className={`${td} num text-muted`}>{i?.code}</td>
                <td className={td}><Link href={`/stok/urunler/${r.item_id}`} className="text-brand-700">{i?.name}</Link></td>
                <td className={`${td} num`}>{r.lot_no ?? "—"}</td>
                <td className={td}>{r.expiry_date ? formatDate(r.expiry_date) : "—"}</td>
                <td className={`${tdNum} ${r.qty < 0 ? "text-bad" : ""}`}>{qty(r.qty)} {i?.unit}</td>
                <td className={tdNum}>{fmt(Math.round(r.qty * (i?.avg_cost ?? 0)))}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={6} text="Depo boş." />}
        </Table>
        {(s.modules.stock ?? 0) >= 3 && (
          <Card title="Depo bilgileri">
            <form action={saveWarehouse} className="grid gap-3 md:grid-cols-4 items-end">
              <input type="hidden" name="id" value={w.id} />
              <Field label="Ad"><input name="name" required maxLength={80} defaultValue={w.name} className={inputCls} /></Field>
              <Field label="Kod"><input name="code" maxLength={20} defaultValue={w.code ?? ""} className={inputCls} /></Field>
              <Field label="Tür"><select name="kind" defaultValue={w.kind} className={selectCls}>{Object.entries(WH_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Sorumlu"><input name="responsible" maxLength={120} defaultValue={w.responsible ?? ""} className={inputCls} /></Field>
              <Field label="Adres" className="md:col-span-2"><input name="address" maxLength={300} defaultValue={w.address ?? ""} className={inputCls} /></Field>
              <Field label="Durum"><select name="is_active" defaultValue={w.is_active ? "on" : "off"} className={selectCls}><option value="on">Aktif</option><option value="off">Pasif</option></select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default" defaultChecked={w.is_default} /> Varsayılan depo</label>
              <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
