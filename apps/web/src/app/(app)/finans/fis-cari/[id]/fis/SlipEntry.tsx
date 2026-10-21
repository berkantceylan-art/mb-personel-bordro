"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { PhotoPicker } from "@/components/PhotoPicker";
import { saveSlipEntry, type EntryResult } from "@/lib/supplier-group-actions";

export type Product = { supplier_name: string; unit: string | null; route: "slip" | "nodisc"; price: number | null; currency: string; item_id: string | null };
type Line = { key: number; name: string; qty: string; price: string; route: "slip" | "nodisc"; unit: string | null; currency: string; item_id: string | null };

const f2 = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => { const n = Number(String(s).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
let seq = 1;
const blank = (cur: string): Line => ({ key: seq++, name: "", qty: "", price: "", route: "slip", unit: null, currency: cur, item_id: null });

export function SlipEntry({ main, slipCurrency, discount, hasNodisc, products, warehouses }: {
  main: string; slipCurrency: string; discount: number; hasNodisc: boolean; products: Product[]; warehouses: { id: string; name: string; is_default: boolean }[];
}) {
  const router = useRouter();
  const byName = useMemo(() => new Map(products.map((p) => [p.supplier_name.toLocaleLowerCase("tr-TR"), p])), [products]);
  const [lines, setLines] = useState<Line[]>(() => [blank(slipCurrency), blank(slipCurrency), blank(slipCurrency)]);
  const [date, setDate] = useState(today());
  const [doc, setDoc] = useState("");
  const [note, setNote] = useState("");
  const [stock, setStock] = useState(true);
  const [wh, setWh] = useState(warehouses[0]?.id ?? "");
  const [pics, setPics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EntryResult | null>(null);

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => {
    const next = ls.map((l) => (l.key === key ? { ...l, ...patch } : l));
    return next[next.length - 1]!.name ? [...next, blank(slipCurrency)] : next;   // son satır dolunca yeni boş satır
  });
  const pick = (key: number, name: string) => {
    const p = byName.get(name.trim().toLocaleLowerCase("tr-TR"));
    if (p) set(key, { name: p.supplier_name, route: p.route, unit: p.unit, currency: p.currency, item_id: p.item_id, price: p.price !== null ? f2(p.price) : "" });
    else set(key, { name, item_id: null });
  };
  const filled = lines.filter((l) => l.name.trim() && num(l.qty) !== 0);
  const total = (r: "slip" | "nodisc") => filled.filter((l) => l.route === r).reduce((a, l) => a + Math.round(num(l.qty) * Math.round(num(l.price) * 100)), 0);
  const tSlip = total("slip"), tNodisc = total("nodisc");
  const unknown = filled.filter((l) => !byName.has(l.name.trim().toLocaleLowerCase("tr-TR")));

  async function submit() {
    setBusy(true); setRes(null);
    const r = await saveSlipEntry({
      party_id: main, slip_date: date, doc_no: doc, note, photo: pics[0] ?? null, add_stock: stock, warehouse_id: wh || null,
      lines: filled.map((l) => ({ item_id: l.item_id, name: l.name.trim(), qty: num(l.qty), unit: l.unit, price: l.price ? Math.round(num(l.price) * 100) : null, currency: l.currency, route: l.route })),
    });
    setRes(r); setBusy(false);
    if (r.ok) { setLines([blank(slipCurrency), blank(slipCurrency), blank(slipCurrency)]); setDoc(""); setNote(""); setPics([]); router.refresh(); }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[16px] border border-line bg-white p-4 md:p-5 grid gap-3 md:grid-cols-4">
        <Field label="Fiş tarihi"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Fiş no" hint="isteğe bağlı"><input value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={60} className={inputCls} /></Field>
        <Field label="Not" hint="isteğe bağlı" className="md:col-span-2"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold h-11"><input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} className="h-4 w-4" /> Mal kabul: stoğa ekle</label>
        {stock && <Field label="Depo"><select value={wh} onChange={(e) => setWh(e.target.value)} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
        <div className="flex items-end md:col-span-2"><PhotoPicker value={pics} onChange={setPics} max={1} label="📷 Fiş fotoğrafı" /></div>
      </section>

      <section className="overflow-x-auto rounded-[16px] border border-line bg-white">
        <datalist id="sup-products">{products.map((p) => <option key={p.supplier_name} value={p.supplier_name} />)}</datalist>
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-2.5 w-[44%]">Ürün</th><th className="p-2.5">Miktar</th><th className="p-2.5">Liste fiyatı</th><th className="p-2.5">Cari</th><th className="p-2.5 text-right">Tutar</th><th className="p-2.5" /></tr></thead>
          <tbody>
            {lines.map((l) => {
              const known = !l.name.trim() || byName.has(l.name.trim().toLocaleLowerCase("tr-TR"));
              return (
                <tr key={l.key} className="border-b border-[#EEF2F6]">
                  <td className="p-2"><input list="sup-products" value={l.name} onChange={(e) => pick(l.key, e.target.value)} placeholder="Ürün adı yazın / seçin" className={`${inputCls} ${known ? "" : "border-[#F59E0B]"}`} />{!known && <span className="text-[11px] text-[#B45309]">Listede yok: yeni ürün olarak eklenir</span>}</td>
                  <td className="p-2"><div className="flex items-center gap-1"><input value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} inputMode="decimal" className={`${inputCls} w-20 num text-right`} /><span className="text-xs text-muted">{l.unit ?? ""}</span></div></td>
                  <td className="p-2"><div className="flex items-center gap-1"><input value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} inputMode="decimal" className={`${inputCls} w-28 num text-right`} /><span className="text-xs text-muted">{l.currency}</span></div></td>
                  <td className="p-2">
                    <select value={l.route} onChange={(e) => set(l.key, { route: e.target.value as Line["route"] })} className={`h-11 rounded-[10px] border px-2 text-xs font-semibold ${l.route === "nodisc" ? "border-[#F59E0B] text-[#B45309]" : "border-[#D5DEE8]"}`}>
                      <option value="slip">Fişli{discount ? ` (−%${discount})` : ""}</option>
                      <option value="nodisc" disabled={!hasNodisc}>İskontosuz</option>
                    </select>
                  </td>
                  <td className="p-2 text-right num whitespace-nowrap">{l.name && num(l.qty) ? f2(Math.round(num(l.qty) * Math.round(num(l.price) * 100))) : ""}</td>
                  <td className="p-2 text-right"><button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="text-xs font-semibold text-bad">Sil</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3"><button type="button" onClick={() => setLines((ls) => [...ls, blank(slipCurrency)])} className={btnSecondary}>+ Satır</button></div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[14px] border border-[#FCD34D] bg-[#FFFBEB] p-4"><span className="text-xs text-muted">📄 Fişli cariye (liste fiyatı)</span><b className="block text-2xl num">{f2(tSlip)} {slipCurrency}</b>{discount > 0 && <span className="text-xs text-muted">İskonto ödemede düşülür (≈ {f2(Math.round(tSlip * discount / 100))})</span>}</div>
        <div className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">📄 İskontosuz fişli cariye</span><b className="block text-2xl num">{f2(tNodisc)} {slipCurrency}</b></div>
        <div className="flex flex-col justify-end gap-2">
          {!!unknown.length && <span className="text-xs text-[#B45309]">{unknown.length} kalem listede yok; fiyatını yazın, ürün listesine eklenir.</span>}
          <button onClick={submit} disabled={busy || !filled.length} className={btnPrimary}>{busy ? "…" : "Fişi kaydet"}</button>
        </div>
      </section>
      {res && (
        <Notice tone={res.ok ? "ok" : "bad"}>
          {res.message}
          {res.slips?.map((x) => <span key={x.slip_id} className="block">{x.party}: {f2(x.amount)} {x.currency} borç yazıldı.</span>)}
          {res.ok && <Link href={`/finans/fis-cari/${main}`} className="mt-1 block font-semibold text-brand-700">Firma ekstresine dön →</Link>}
        </Notice>
      )}
    </div>
  );
}
