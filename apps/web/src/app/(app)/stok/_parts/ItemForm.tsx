import { saveItem } from "@/lib/stock-actions";
import { CURRENCIES } from "@/lib/fin";
import { ITEM_KIND, UNITS, type Item, type Warehouse } from "@/lib/stock";
import { Field, btnPrimary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Ürün / malzeme kartı */
export function ItemForm({ item, categories, warehouses, suppliers, products }: { item?: Item; categories: { id: string; name: string }[]; warehouses: Warehouse[]; suppliers: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const i = item;
  const m = (v: number | null | undefined) => (v ? String(Number(v) / 100).replace(".", ",") : "");
  return (
    <form action={saveItem} className="grid gap-4 md:grid-cols-4">
      {i && <input type="hidden" name="id" value={i.id} />}
      <Field label="Ad" className="md:col-span-2"><input name="name" required maxLength={200} defaultValue={i?.name ?? ""} className={inputCls} /></Field>
      <Field label="Kod" hint="boşsa otomatik"><input name="code" maxLength={40} defaultValue={i?.code ?? ""} className={`${inputCls} num`} /></Field>
      <Field label="Barkod"><input name="barcode" maxLength={64} defaultValue={i?.barcode ?? ""} className={`${inputCls} num`} /></Field>
      <Field label="Tür">
        <select name="kind" defaultValue={i?.kind ?? "material"} className={selectCls}>{Object.entries(ITEM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
      <Field label="Birim">
        <select name="unit" defaultValue={i?.unit ?? "adet"} className={selectCls}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
      </Field>
      <Field label="Kategori">
        <select name="category_id" defaultValue={i?.category_id ?? ""} className={selectCls}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </Field>
      <Field label="Marka"><input name="brand" maxLength={80} defaultValue={i?.brand ?? ""} className={inputCls} /></Field>
      <Field label="Alış fiyatı"><input name="purchase_price" inputMode="decimal" defaultValue={m(i?.purchase_price)} className={inputCls} /></Field>
      <Field label="Alış para birimi"><select name="purchase_currency" defaultValue={i?.purchase_currency ?? "TRY"} className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Satış fiyatı"><input name="sale_price" inputMode="decimal" defaultValue={m(i?.sale_price)} className={inputCls} /></Field>
      <Field label="Satış para birimi"><select name="sale_currency" defaultValue={i?.sale_currency ?? "TRY"} className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="KDV"><select name="vat_rate" defaultValue={String(i?.vat_rate ?? 20)} className={selectCls}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
      <Field label="Asgari stok" hint="altına inince uyarır"><input name="min_qty" inputMode="decimal" defaultValue={i?.min_qty ?? ""} className={inputCls} /></Field>
      <Field label="Azami stok"><input name="max_qty" inputMode="decimal" defaultValue={i?.max_qty ?? ""} className={inputCls} /></Field>
      <Field label="Sipariş miktarı"><input name="reorder_qty" inputMode="decimal" defaultValue={i?.reorder_qty ?? ""} className={inputCls} /></Field>
      <Field label="Varsayılan tedarikçi">
        <select name="supplier_party_id" defaultValue={i?.supplier_party_id ?? ""} className={selectCls}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <Field label="Varsayılan depo">
        <select name="default_warehouse_id" defaultValue={i?.default_warehouse_id ?? ""} className={selectCls}><option value="">—</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </Field>
      <Field label="Raf / yer"><input name="shelf" maxLength={40} defaultValue={i?.shelf ?? ""} className={inputCls} /></Field>
      <Field label="Satılan protez ürünü" hint="mamul ise">
        <select name="lab_product_id" defaultValue={i?.lab_product_id ?? ""} className={selectCls}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      <div className="flex flex-col justify-end gap-2 text-sm md:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="track_lot" defaultChecked={i?.track_lot} /> Lot / seri takibi (MDR izlenebilirlik)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="track_expiry" defaultChecked={i?.track_expiry} /> Son kullanma tarihi takibi</label>
      </div>
      <fieldset className="grid gap-3 rounded-[12px] border border-line p-3 md:col-span-4 md:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">ÜTS (Ürün Takip Sistemi)</legend>
        <input type="hidden" name="uts_was" value={i?.uts_tracked || i?.uts_product_no ? "1" : ""} />
        <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" name="uts_tracked" defaultChecked={i?.uts_tracked} /> Bu ürün ÜTS&apos;de takip ediliyor (alma / kullanım / verme bildirimi otomatik hazırlanır)</label>
        <Field label="ÜTS ürün numarası (UNO)" hint="karekoddaki (01) GTIN; ilk okutmada kendiliğinden dolar"><input name="uts_product_no" maxLength={25} defaultValue={i?.uts_product_no ?? ""} className={`${inputCls} num`} /></Field>
        <Field label="Takip türü"><select name="uts_kind" defaultValue={i?.uts_kind ?? "lot"} className={selectCls}><option value="lot">Lot / parti</option><option value="serial">Seri no (tekil, ör. implant parçası)</option></select></Field>
        <Field label="İşte ne olur?" className="md:col-span-2"><select name="uts_flow" defaultValue={i?.uts_flow ?? "use"} className={selectCls}><option value="use">Protezde kullanılır → kullanım bildirimi</option><option value="transfer">İşle birlikte kliniğe gider → teslimde verme bildirimi</option></select></Field>
      </fieldset>
      {i && (
        <Field label="Durum"><select name="is_active" defaultValue={i.is_active ? "on" : "off"} className={selectCls}><option value="on">Aktif</option><option value="off">Pasif</option></select></Field>
      )}
      <Field label="Not" className="md:col-span-4"><textarea name="note" rows={2} maxLength={2000} defaultValue={i?.note ?? ""} className={textareaCls} /></Field>
      <div className="md:col-span-4"><PendingSubmit className={btnPrimary}>{i ? "Kaydet" : "Kartı aç"}</PendingSubmit></div>
    </form>
  );
}
