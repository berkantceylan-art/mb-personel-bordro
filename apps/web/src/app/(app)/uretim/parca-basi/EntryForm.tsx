"use client";
import { useMemo, useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";

type W = { id: string; name: string; kind: "internal" | "external" };
type P = { id: string; name: string };
type R = { lab_product_id: string | null; work_name: string; unit: string; price: number; worker_id: string | null };

const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 w-full";
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

/** Hızlı iş girişi: usta + ürün seçilince fiyat listesinden birim fiyat gelir, tutar canlı hesaplanır */
export function EntryForm({ action, workers, products, rates, today }: { action: (f: FormData) => Promise<void>; workers: W[]; products: P[]; rates: R[]; today: string }) {
  const [worker, setWorker] = useState("");
  const [prodText, setProdText] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const product = useMemo(() => products.find((p) => norm(p.name) === norm(prodText.trim())) ?? null, [products, prodText]);
  const workRates = useMemo(() => rates.filter((r) => !r.lab_product_id), [rates]);
  const rate = useMemo(() => {
    const match = (r: R) => (product ? r.lab_product_id === product.id : !r.lab_product_id && norm(r.work_name) === norm(prodText.trim()));
    return rates.find((r) => match(r) && r.worker_id === worker) ?? rates.find((r) => match(r) && !r.worker_id) ?? null;
  }, [rates, product, prodText, worker]);
  const unitPrice = price.trim() ? Math.round(Number(price.replace(/\./g, "").replace(",", ".")) * 100) : rate?.price ?? 0;
  const q = Number(qty.replace(",", ".")) || 0;
  const total = Math.round(q * (Number.isFinite(unitPrice) ? unitPrice : 0));
  const w = workers.find((x) => x.id === worker);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-6 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Usta / personel *
        <select name="worker_id" required value={worker} onChange={(e) => setWorker(e.target.value)} className={input}>
          <option value="">Seçin…</option>
          <optgroup label="Kendi personelimiz">{workers.filter((x) => x.kind === "internal").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
          <optgroup label="Dışarıdan usta">{workers.filter((x) => x.kind === "external").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih *<input type="date" name="work_date" required defaultValue={today} max={today} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İş no<input name="job_no" inputMode="numeric" placeholder="ör. 10452" className={`${input} num`} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Ürün / yapılan iş
        <input value={prodText} onChange={(e) => setProdText(e.target.value)} list="pc-products" autoComplete="off" placeholder="Yazın: zirkon, metal porselen, model…" className={input} />
        <datalist id="pc-products">
          {products.map((p) => <option key={p.id} value={p.name} />)}
          {workRates.map((r, i) => <option key={`w${i}`} value={r.work_name} />)}
        </datalist>
        <input type="hidden" name="lab_product_id" value={product?.id ?? ""} />
        <input type="hidden" name="work_name" value={product ? "" : prodText.trim()} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Adet / üye *<input name="qty" required value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={`${input} num`} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Birim fiyat (₺)
        <input name="unit_price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={rate ? (rate.price / 100).toLocaleString("tr-TR") : "listeden"} className={`${input} num`} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Not<input name="note" maxLength={500} className={input} /></label>
      <div className="md:col-span-2 flex items-center gap-3 rounded-[12px] bg-[#F3F6F9] px-4 h-11">
        <span className="text-xs text-muted">Tutar</span>
        <b className="num font-display text-lg text-brand-800">{tl(total)}</b>
        <span className="text-xs text-muted ml-auto truncate">
          {rate && !price ? `${rate.worker_id ? "ustaya özel" : "liste"} fiyatı · ${rate.unit}` : price ? "elle fiyat" : prodText ? "fiyat listede yok — elle yazın" : ""}
        </span>
      </div>
      <PendingSubmit className="h-11 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
      {w && <p className="md:col-span-6 text-xs text-muted">{w.kind === "internal" ? "Personel: onaylanıp aktarılınca o ayın maaş carisine ek ödeme olarak yazılır." : "Dış usta: onaylanıp aktarılınca gider + cari borç + ödeme planı oluşur."} İş no yazarsanız ürün o işten otomatik alınır ve maliyet o ürüne yansır.</p>}
    </form>
  );
}
