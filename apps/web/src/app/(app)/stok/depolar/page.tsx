import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Table, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { loadItems, loadStock, loadWarehouses } from "@/lib/stock-data";
import { saveWarehouse } from "@/lib/stock-actions";
import { WH_KIND } from "@/lib/stock";
import { fmt } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Depolar */
export default async function WarehousesPage() {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const [warehouses, stock, { rows: items }] = await Promise.all([loadWarehouses(), loadStock(), loadItems()]);
  const cost = new Map(items.map((i) => [i.id, i.avg_cost]));
  return (
    <>
      <PageHeader title="Depolar" subtitle="Ana depo, üretim, karantina, konsinye, araç" actions={<Link href="/stok/transfer/yeni" className="text-sm font-semibold text-brand-700">+ Transfer</Link>} />
      <div className={page}>
        <Table head={["Depo", "Tür", "Sorumlu", "Kalem", "Değer"]} min={640}>
          {warehouses.map((w) => {
            const rows = stock.filter((r) => r.warehouse_id === w.id && r.qty !== 0);
            const val = rows.reduce((a, r) => a + r.qty * (cost.get(r.item_id) ?? 0), 0);
            return (
              <tr key={w.id} className={w.is_active ? "" : "opacity-60"}>
                <td className={td}><Link href={`/stok/depolar/${w.id}`} className="font-semibold text-brand-700">{w.name}</Link>{w.is_default && <span className="ml-2"><Chip tone="blue">varsayılan</Chip></span>}</td>
                <td className={td}>{WH_KIND[w.kind]}</td>
                <td className={td}>{w.responsible ?? "—"}</td>
                <td className={tdNum}>{new Set(rows.map((r) => r.item_id)).size}</td>
                <td className={tdNum}>{fmt(Math.round(val))}</td>
              </tr>
            );
          })}
          {warehouses.length === 0 && <EmptyRow cols={5} text="Depo yok: 20261203000000_stock.sql çalıştırın." />}
        </Table>
        {(s.modules.stock ?? 0) >= 3 && (
          <Card title="Yeni depo">
            <form action={saveWarehouse} className="grid gap-3 md:grid-cols-4 items-end">
              <Field label="Ad"><input name="name" required maxLength={80} className={inputCls} /></Field>
              <Field label="Kod"><input name="code" maxLength={20} className={inputCls} /></Field>
              <Field label="Tür"><select name="kind" className={selectCls}>{Object.entries(WH_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Sorumlu"><input name="responsible" maxLength={120} className={inputCls} /></Field>
              <Field label="Adres" className="md:col-span-3"><input name="address" maxLength={300} className={inputCls} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default" /> Varsayılan depo</label>
              <PendingSubmit className={btnPrimary}>Depoyu aç</PendingSubmit>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
