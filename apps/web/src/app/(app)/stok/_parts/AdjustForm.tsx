import { adjustStock } from "@/lib/stock-actions";
import { today } from "@/lib/fin";
import type { Item, Warehouse } from "@/lib/stock";
import { Field, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Açılış stoğu / düzeltme / fire / tüketim */
export function AdjustForm({ item, warehouses }: { item: Item; warehouses: Warehouse[] }) {
  return (
    <form action={adjustStock} className="grid gap-3 md:grid-cols-4 items-end">
      <input type="hidden" name="item_id" value={item.id} />
      <Field label="Hareket">
        <select name="kind" className={selectCls}>
          <option value="opening">Açılış / giriş (+)</option>
          <option value="adjust">Düzeltme (+ / −)</option>
          <option value="waste">Fire / kırık (−)</option>
          <option value="consume">Üretimde tüketim (−)</option>
        </select>
      </Field>
      <Field label="Depo">
        <select name="warehouse_id" defaultValue={item.default_warehouse_id ?? warehouses.find((w) => w.is_default)?.id ?? ""} className={selectCls}>
          {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label={`Miktar (${item.unit})`} hint="düzeltmede eksi olabilir"><input name="qty" required inputMode="decimal" className={inputCls} /></Field>
      <Field label="Birim maliyet (₺)" hint="girişte"><input name="unit_cost" inputMode="decimal" className={inputCls} /></Field>
      {item.track_lot && <Field label="Lot no"><input name="lot_no" maxLength={60} className={inputCls} /></Field>}
      {item.track_expiry && <Field label="Son kullanma"><input type="date" name="expiry_date" className={inputCls} /></Field>}
      <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
      <Field label="Not"><input name="note" maxLength={300} className={inputCls} /></Field>
      <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
    </form>
  );
}
