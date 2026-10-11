"use client";
import { useMemo, useState } from "react";
import { savePurchaseOrder } from "@/lib/order-actions";

type Item = { id: string; code: string; name: string; unit: string; purchase_price: number | null; vat_rate: number | null };
type Line = { item_id: string; name: string; qty: string; unit: string; unit_price: string; vat_rate: string };
const fmt = (minor: number) => (minor / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;

/** Satın alma siparişi formu: stok kartından kalem seç, miktar / fiyat / KDV */
export function POForm({ initial, parties, items, warehouses }: {
  initial: { id?: string; party_id?: string; order_date?: string; expected_date?: string | null; currency?: string; warehouse_id?: string | null; note?: string | null; lines: Line[] };
  parties: { id: string; name: string }[]; items: Item[]; warehouses: { id: string; name: string }[];
}) {
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [{ item_id: "", name: "", qty: "1", unit: "adet", unit_price: "", vat_rate: "20" }]);
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.length < 2 ? [] : items.filter((i) => `${i.code} ${i.name}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))).slice(0, 8)), [q, items]);
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const add = (it: Item) => {
    const row = { item_id: it.id, name: it.name, qty: "1", unit: it.unit, unit_price: it.purchase_price ? fmt(it.purchase_price) : "", vat_rate: String(it.vat_rate ?? 20) };
    setLines(lines.length === 1 && !lines[0]!.name ? [row] : [...lines, row]);
    setQ("");
  };
  const net = lines.reduce((a, l) => a + num(l.qty) * num(l.unit_price), 0);
  const vat = lines.reduce((a, l) => a + (num(l.qty) * num(l.unit_price) * num(l.vat_rate)) / 100, 0);
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";

  return (
    <form action={savePurchaseOrder} className="flex flex-col gap-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <section className="rounded-[16px] border border-line bg-white p-4 grid gap-3 md:grid-cols-5">
        <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted">Tedarikçi
          <select name="party_id" required defaultValue={initial.party_id ?? ""} className={inp}><option value="">Seçin</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Sipariş tarihi<input type="date" name="order_date" defaultValue={initial.order_date} className={inp} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Beklenen teslim<input type="date" name="expected_date" defaultValue={initial.expected_date ?? ""} className={inp} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Para birimi<select name="currency" defaultValue={initial.currency ?? "TRY"} className={inp}><option>TRY</option><option>EUR</option><option>USD</option></select></label>
        {warehouses.length > 1 && <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted">Giriş deposu<select name="warehouse_id" defaultValue={initial.warehouse_id ?? ""} className={inp}><option value="">Varsayılan</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
        <label className="md:col-span-3 flex flex-col gap-1 text-xs font-semibold text-muted">Not<input name="note" defaultValue={initial.note ?? ""} className={inp} /></label>
      </section>

      <section className="rounded-[16px] border border-line bg-white overflow-hidden">
        <div className="relative p-3 border-b border-line">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Stok kartından kalem ekle: kod ya da ad yazın…" className={`${inp} w-full`} />
          {found.length > 0 && (
            <ul className="absolute z-10 left-3 right-3 mt-1 rounded-[10px] border border-line bg-white shadow-lg">
              {found.map((it) => <li key={it.id}><button type="button" onClick={() => add(it)} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F2F7FD]"><span className="font-mono text-xs text-muted mr-2">{it.code}</span>{it.name}</button></li>)}
            </ul>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-2">Kalem</th><th className="p-2 w-24">Miktar</th><th className="p-2 w-24">Birim</th><th className="p-2 w-32">Birim fiyat</th><th className="p-2 w-20">KDV %</th><th className="p-2 w-32 text-right">Tutar</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-[#EEF2F6]">
                  <td className="p-2"><input value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Kalem adı" className={`${inp} w-full`} />{l.item_id && <span className="text-[10px] text-ok font-semibold">stok kartına bağlı</span>}</td>
                  <td className="p-2"><input value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" className={`${inp} w-full`} /></td>
                  <td className="p-2"><input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} className={`${inp} w-full`} /></td>
                  <td className="p-2"><input value={l.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} inputMode="decimal" placeholder="0,00" className={`${inp} w-full num`} /></td>
                  <td className="p-2"><select value={l.vat_rate} onChange={(e) => set(i, { vat_rate: e.target.value })} className={`${inp} w-full`}>{["20", "10", "1", "0"].map((v) => <option key={v}>{v}</option>)}</select></td>
                  <td className="p-2 text-right num">{fmt(Math.round(num(l.qty) * num(l.unit_price) * 100))}</td>
                  <td className="p-2"><button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="text-bad text-lg" aria-label="Sil">×</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line"><td colSpan={7} className="p-2"><button type="button" onClick={() => setLines([...lines, { item_id: "", name: "", qty: "1", unit: "adet", unit_price: "", vat_rate: "20" }])} className="text-sm font-semibold text-brand-700">+ Boş satır</button></td></tr>
              <tr><td colSpan={5} className="p-2 text-right text-muted">Ara toplam</td><td className="p-2 text-right num">{fmt(Math.round(net * 100))}</td><td /></tr>
              <tr><td colSpan={5} className="p-2 text-right text-muted">KDV</td><td className="p-2 text-right num">{fmt(Math.round(vat * 100))}</td><td /></tr>
              <tr><td colSpan={5} className="p-2 text-right font-bold">Toplam</td><td className="p-2 text-right num font-bold">{fmt(Math.round((net + vat) * 100))}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button className="h-11 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold">Taslak kaydet</button>
        <button name="submit" value="1" className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet ve onaya gönder</button>
      </div>
    </form>
  );
}
