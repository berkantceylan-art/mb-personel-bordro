"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ITEM_KIND,
  JOB_STATUS,
  LOWER,
  MATERIALS,
  METAL_BAND,
  RECEIVED,
  UPPER,
  lineAmount,
  money,
  parseMoney,
  teethByMaterial,
  type ItemKind,
  type Job,
  type JobItem,
  type JobStep,
} from "@/lib/jobs";
import { saveJob, type JobPayload } from "./actions";

export type CustomerOpt = { id: string; name: string; currency: string; discount_pct: number; doctors: string[]; prices?: Record<string, { try: number | null; eur: number | null }> };
export type ProductOpt = { id: string; name: string; material: string | null; price_try: number | null; price_eur: number | null };
export type Prefill = { doctor?: string; customer_id?: string; received?: string[]; shipment_id?: string; portal_case_id?: string; patient?: string; teeth?: Record<string, string>; shade?: string; description?: string; note?: string };

const SHADES = ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4", "BL1", "BL2", "BL3", "BL4", "OM1", "OM2", "OM3"];
const box = "rounded-[14px] bg-white border border-line p-4 md:p-5";
const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-[15px] w-full";
const lbl = "flex flex-col gap-1 text-xs font-semibold text-muted";
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

export function JobEditor({
  job,
  initialItems = [],
  initialSteps = [],
  customers,
  products,
  delivery,
  tryins,
  prefill,
  nextNo,
}: {
  job?: Job;
  initialItems?: JobItem[];
  initialSteps?: JobStep[];
  customers: CustomerOpt[];
  products: ProductOpt[];
  delivery: string[];
  tryins: string[];
  prefill?: Prefill;
  nextNo?: number;
}) {
  const router = useRouter();
  const [no, setNo] = useState<string>(job ? String(job.no) : "");
  const [slip, setSlip] = useState(job?.slip_no ?? "");
  const [customerId, setCustomerId] = useState(job?.customer_id ?? prefill?.customer_id ?? "");
  const [custQuery, setCustQuery] = useState(customers.find((c) => c.id === (job?.customer_id ?? prefill?.customer_id))?.name ?? "");
  const [doctor, setDoctor] = useState(job?.doctor_name ?? prefill?.doctor ?? "");
  const [patient, setPatient] = useState(job?.patient ?? prefill?.patient ?? "");
  const [shade, setShade] = useState(job?.shade ?? prefill?.shade ?? "");
  const [cervical, setCervical] = useState(job?.shade_cervical ?? "");
  const [incisal, setIncisal] = useState(job?.shade_incisal ?? "");
  const [desc, setDesc] = useState(job?.description ?? prefill?.description ?? "");
  const [invoiceNote, setInvoiceNote] = useState(job?.invoice_note ?? "");
  const [printNote, setPrintNote] = useState(job?.print_note ?? prefill?.note ?? "");
  const [band, setBand] = useState<string>(job?.metal_band ?? "");
  const [received, setReceived] = useState<string[]>(job?.received ?? prefill?.received ?? []);
  const [teeth, setTeeth] = useState<Record<string, string>>(job?.teeth ?? prefill?.teeth ?? {});
  const [brush, setBrush] = useState<string>("zirkon");
  const [inDate, setInDate] = useState(job?.in_date ?? today());
  const [dueDate, setDueDate] = useState(job?.due_date ?? "");
  const [delMethod, setDelMethod] = useState(job?.delivery_method ?? "");
  const [delTime, setDelTime] = useState(job?.delivery_time ?? "");
  const [status, setStatus] = useState<string>(job?.status ?? "open");
  const [items, setItems] = useState<JobItem[]>(initialItems);
  const [steps, setSteps] = useState<JobStep[]>(initialSteps);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const painting = useRef(false);

  const customer = customers.find((c) => c.id === customerId);
  const currency = customer?.currency ?? job?.currency ?? "TRY";
  const total = items.reduce((a, i) => a + i.amount, 0);
  const counts = useMemo(() => teethByMaterial(teeth), [teeth]);

  // ---- Diş şeması
  const paint = (t: number, toggle: boolean) => {
    setTeeth((prev) => {
      const k = String(t);
      const next = { ...prev };
      if (brush === "clear" || (toggle && prev[k] === brush)) delete next[k];
      else next[k] = brush;
      return next;
    });
  };

  // ---- Ürün satırı ekleme
  const [prodId, setProdId] = useState("");
  const [prodName, setProdName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<ItemKind>("paid");
  const priceFor = (p: ProductOpt | undefined) => {
    if (!p) return null;
    // Hekime özel fiyat varsa o (iskonto uygulanmaz), yoksa liste fiyatı - iskonto
    const special = customer?.prices?.[p.id];
    const sp = special ? (currency === "EUR" ? special.eur : special.try) : null;
    if (sp != null) return sp;
    const base = currency === "EUR" ? p.price_eur : p.price_try;
    if (base == null) return null;
    return Math.round(base * (1 - (customer?.discount_pct ?? 0) / 100));
  };
  const pickProduct = (id: string) => {
    setProdId(id);
    const p = products.find((x) => x.id === id);
    setProdName(p?.name ?? "");
    const pr = priceFor(p);
    setPrice(pr != null ? (pr / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "");
    if (p?.material && counts[p.material]) setQty(String(counts[p.material]));
  };
  const addItem = () => {
    const name = prodName.trim();
    if (!name) return setMsg({ ok: false, text: "Ürün seçin ya da adını yazın." });
    const q = Math.min(99, Math.max(1, Number(qty) || 1));
    const u = parseMoney(price) ?? 0;
    setItems((x) => [...x, { product_id: prodId || null, name, qty: q, unit_price: u, amount: lineAmount(q, u, kind), kind }]);
    setProdId("");
    setProdName("");
    setQty("1");
    setPrice("");
    setKind("paid");
    setMsg(null);
  };
  /** Şemadaki malzemelerden satır öner */
  const itemsFromChart = () => {
    const add: JobItem[] = [];
    for (const [mat, n] of Object.entries(counts)) {
      if (items.some((i) => products.find((p) => p.id === i.product_id)?.material === mat)) continue;
      const p = products.find((x) => x.material === mat);
      const u = priceFor(p) ?? 0;
      add.push({ product_id: p?.id ?? null, name: p?.name ?? MATERIALS[mat]![0], qty: n, unit_price: u, amount: lineAmount(n, u, "paid"), kind: "paid" });
    }
    if (!add.length) return setMsg({ ok: false, text: "Şemada satıra eklenecek yeni malzeme yok." });
    setItems((x) => [...x, ...add]);
  };

  // ---- Prova / teslim adımı
  const [stKind, setStKind] = useState(tryins[0] ?? "");
  const [stOut, setStOut] = useState("");
  const [stBack, setStBack] = useState("");
  const [stMethod, setStMethod] = useState("");
  const [stTime, setStTime] = useState("");
  const addStep = () => {
    if (!stKind) return;
    setSteps((x) => [...x, { kind: stKind, out_date: stOut || null, back_date: stBack || null, delivery_method: stMethod || null, delivery_time: stTime || null, done: false, note: null }]);
    setStOut("");
    setStBack("");
    setStTime("");
    if (status === "open") setStatus("tryin");
  };

  async function save(print: boolean) {
    setBusy(true);
    setMsg(null);
    const payload: JobPayload = {
      id: job?.id ?? null,
      no: job ? null : Number(no) || null,
      slip_no: slip,
      customer_id: customerId,
      doctor_name: doctor,
      patient,
      shade,
      shade_cervical: cervical,
      shade_incisal: incisal,
      description: desc,
      invoice_note: invoiceNote,
      print_note: printNote,
      metal_band: band,
      received,
      teeth,
      in_date: inDate,
      due_date: dueDate,
      delivery_method: delMethod,
      delivery_time: delTime,
      status,
      items: items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, unit_price: i.unit_price, kind: i.kind })),
      steps: steps.map((x) => ({ kind: x.kind, out_date: x.out_date ?? "", back_date: x.back_date ?? "", delivery_method: x.delivery_method ?? "", delivery_time: x.delivery_time ?? "", done: x.done, note: x.note ?? "" })),
      shipment_id: job ? null : prefill?.shipment_id ?? null,
      portal_case_id: job ? null : prefill?.portal_case_id ?? null,
    };
    const r = await saveJob(payload);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.message });
    if (!r.ok || !r.id) return;
    if (print) router.push(`/yazdir/is/${r.id}?yazdir=1`);
    else if (!job) router.replace(`/isler/${r.id}?tamam=${encodeURIComponent(r.message)}`);
    else router.refresh();
  }

  const toggleReceived = (k: string) => setReceived((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));

  return (
    <div className="flex flex-col gap-4 pb-28" onPointerUp={() => (painting.current = false)}>
      {/* Üst bilgiler */}
      <section className={`${box} grid gap-3 md:grid-cols-[170px_150px_1fr_1fr]`}>
        <label className={lbl}>
          Numara *
          <input value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} disabled={!!job} placeholder={nextNo ? `${nextNo} (otomatik)` : "otomatik"} className={`${inp} num font-bold disabled:bg-[#F3F6F9]`} />
        </label>
        <label className={lbl}>
          Fiş no
          <input value={slip} onChange={(e) => setSlip(e.target.value)} className={inp} />
        </label>
        <label className={lbl}>
          Hekim | Hastane *
          <input
            list="job-customers"
            value={custQuery}
            onChange={(e) => {
              setCustQuery(e.target.value);
              const c = customers.find((x) => x.name === e.target.value);
              setCustomerId(c?.id ?? "");
            }}
            placeholder="Yazarak arayın"
            className={`${inp} ${custQuery && !customerId ? "border-warn" : ""}`}
          />
          <datalist id="job-customers">
            {customers.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
          {custQuery && !customerId && <span className="text-warn font-normal">Listeden seçin ya da önce Hekim / hastane kartı açın.</span>}
        </label>
        <label className={lbl}>
          Doktor
          <input list="job-doctors" value={doctor} onChange={(e) => setDoctor(e.target.value)} className={inp} />
          <datalist id="job-doctors">
            {(customer?.doctors ?? []).map((d) => <option key={d} value={d} />)}
          </datalist>
        </label>
        <label className={`${lbl} md:col-span-2`}>
          Hasta
          <input value={patient} onChange={(e) => setPatient(e.target.value)} className={inp} />
        </label>
        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <label className={lbl}>Diş renk<input list="job-shades" value={shade} onChange={(e) => setShade(e.target.value)} className={inp} /></label>
          <label className={lbl}>Cervical<input list="job-shades" value={cervical} onChange={(e) => setCervical(e.target.value)} className={inp} /></label>
          <label className={lbl}>Incisal<input list="job-shades" value={incisal} onChange={(e) => setIncisal(e.target.value)} className={inp} /></label>
          <datalist id="job-shades">{SHADES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <label className={`${lbl} md:col-span-4`}>
          Açıklama
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className={`${inp} h-auto py-2`} />
        </label>
        <label className={`${lbl} md:col-span-3`}>
          Toplu fatura açıklama
          <input value={invoiceNote} onChange={(e) => setInvoiceNote(e.target.value)} className={inp} />
        </label>
        <label className={lbl}>
          Yazıcı (uyarı açıklaması)
          <input value={printNote} onChange={(e) => setPrintNote(e.target.value)} className={inp} />
        </label>
      </section>

      {/* Metal bant, gelen malzeme, diş şeması */}
      <section className={`${box} grid gap-5 lg:grid-cols-[220px_1fr]`}>
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold text-muted mb-1">Metal bant</legend>
            {Object.entries(METAL_BAND).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={band === k} onChange={() => setBand(band === k ? "" : k)} className="w-5 h-5" />
                {v}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold text-muted mb-1">Gelen</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(RECEIVED).map(([k, v]) => (
                <button key={k} type="button" onClick={() => toggleReceived(k)} className={`h-10 px-3 rounded-lg text-sm font-semibold border ${received.includes(k) ? "bg-brand-700 text-white border-brand-700" : "bg-white border-[#D5DEE8] text-ink"}`}>
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setBrush("clear")} className={`h-9 px-3 rounded-lg text-sm font-bold border-2 ${brush === "clear" ? "bg-ink text-white border-ink" : "bg-white border-[#D5DEE8]"}`}>Temizle</button>
            {Object.entries(MATERIALS).map(([k, [label, color]]) => (
              <button
                key={k}
                type="button"
                onClick={() => setBrush(k)}
                style={{ borderColor: color, ...(brush === k ? { background: color, color: "#fff" } : { color }) }}
                className="h-9 px-3 rounded-lg text-sm font-bold border-2 bg-white"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div className="inline-flex flex-col gap-1 rounded-xl border border-line bg-[#F8FAFC] p-2 select-none touch-none">
              {[UPPER, LOWER].map((row, ri) => (
                <div key={ri} className={`flex gap-1 ${ri === 0 ? "pb-1 border-b border-line" : "pt-1"}`}>
                  {row.map((t, i) => {
                    const mat = teeth[String(t)];
                    const color = mat ? MATERIALS[mat]?.[1] : undefined;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-label={`Diş ${t}${mat ? `: ${MATERIALS[mat]?.[0]}` : ""}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          painting.current = true;
                          paint(t, true);
                        }}
                        onPointerEnter={() => painting.current && paint(t, false)}
                        style={color ? { background: color, color: "#fff", borderColor: color } : undefined}
                        className={`w-9 h-11 md:w-10 md:h-12 rounded-md border text-sm font-bold num ${color ? "" : "bg-white border-[#D5DEE8] text-ink"} ${i === 7 ? "mr-2" : ""}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {Object.entries(counts).map(([m, n]) => (
              <span key={m} className="px-2 py-1 rounded-md font-semibold text-white" style={{ background: MATERIALS[m]?.[1] }}>{MATERIALS[m]?.[0]}: {n}</span>
            ))}
            {Object.keys(counts).length > 0 && (
              <button type="button" onClick={itemsFromChart} className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white font-semibold text-brand-700">Şemadan ürün satırı oluştur</button>
            )}
            {Object.keys(counts).length === 0 && <span className="text-muted">Malzeme seçip dişlere dokunun (sürükleyerek de boyayabilirsiniz).</span>}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Tarihler ve prova / teslim */}
        <section className={`${box} flex flex-col gap-3`}>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Giriş tarihi<input type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} className={inp} /></label>
            <label className={lbl}>Çıkış (teslim) tarihi<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inp} /></label>
            <label className={lbl}>
              Teslim şekli
              <select value={delMethod} onChange={(e) => setDelMethod(e.target.value)} className={inp}>
                <option value="">—</option>
                {delivery.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className={lbl}>Saat<input type="time" value={delTime} onChange={(e) => setDelTime(e.target.value)} className={inp} /></label>
          </div>
          <div className="rounded-xl bg-[#F3F6F9] p-3 flex flex-col gap-2">
            <p className="text-sm font-semibold text-brand-800">Prova / teslim adımı</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select value={stKind} onChange={(e) => setStKind(e.target.value)} className={`${inp} md:col-span-2`} aria-label="Prova türü">
                {tryins.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={stOut} onChange={(e) => setStOut(e.target.value)} className={inp} aria-label="Çıkış" title="Laboratuvardan çıkış" />
              <input type="date" value={stBack} onChange={(e) => setStBack(e.target.value)} className={inp} aria-label="Dönüş" title="Dönüş / giriş" />
              <input type="time" value={stTime} onChange={(e) => setStTime(e.target.value)} className={inp} aria-label="Saat" />
              <select value={stMethod} onChange={(e) => setStMethod(e.target.value)} className={`${inp} md:col-span-3`} aria-label="Teslim şekli">
                <option value="">Teslim şekli</option>
                {delivery.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button type="button" onClick={addStep} className="h-11 rounded-[10px] bg-brand-700 text-white font-semibold md:col-span-2">Adım ekle</button>
            </div>
            {steps.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {steps.map((x, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                    <input type="checkbox" checked={x.done} onChange={() => setSteps((s) => s.map((y, j) => (j === i ? { ...y, done: !y.done } : y)))} aria-label="Tamamlandı" className="w-5 h-5" />
                    <b className={x.done ? "line-through text-muted" : ""}>{x.kind}</b>
                    <span className="num text-muted">{x.out_date ? `çıkış ${x.out_date.split("-").reverse().join(".")}` : ""}{x.back_date ? ` · dönüş ${x.back_date.split("-").reverse().join(".")}` : ""}{x.delivery_time ? ` ${x.delivery_time}` : ""}</span>
                    {x.delivery_method && <span className="text-muted">· {x.delivery_method}</span>}
                    <button type="button" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} className="ml-auto text-bad font-semibold">Sil</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className={lbl}>
            Durum
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
              {Object.entries(JOB_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </section>

        {/* Protez / ürün */}
        <section className={`${box} flex flex-col gap-3`}>
          <label className={lbl}>
            Protez / ürün
            <input
              list="job-products"
              value={prodName}
              onChange={(e) => {
                const p = products.find((x) => x.name === e.target.value);
                if (p) pickProduct(p.id);
                else {
                  setProdId("");
                  setProdName(e.target.value);
                }
              }}
              placeholder="Yazarak arayın"
              className={inp}
            />
            <datalist id="job-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className={lbl}>Üye<input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} className={`${inp} num`} /></label>
            <label className={lbl}>Fiyat ({currency === "EUR" ? "€" : currency === "USD" ? "$" : "TL"})<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inp} num`} /></label>
            <div className={lbl}>Tutar<div className="h-11 rounded-[10px] bg-[#F3F6F9] px-3 grid items-center num font-semibold text-ink">{money(lineAmount(Number(qty) || 1, parseMoney(price) ?? 0, kind), currency)}</div></div>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(ITEM_KIND).map(([k, v]) => (
              <label key={k} className="flex items-center gap-1.5 text-sm font-semibold">
                <input type="checkbox" checked={kind === k} onChange={() => setKind(k as ItemKind)} className="w-5 h-5" />
                {v}
              </label>
            ))}
          </div>
          <button type="button" onClick={addItem} className="h-11 rounded-[10px] bg-brand-700 text-white font-semibold">Satır ekle</button>
          {items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted text-left"><th className="py-1.5">Ürün</th><th className="py-1.5 text-right">Üye</th><th className="py-1.5 text-right">Fiyat</th><th className="py-1.5 text-right">Tutar</th><th /></tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n} className="border-t border-line">
                    <td className="py-2">{i.name}{i.kind !== "paid" && <span className="ml-1 text-xs font-semibold text-warn">({ITEM_KIND[i.kind]})</span>}</td>
                    <td className="py-2 text-right num">{i.qty}</td>
                    <td className="py-2 text-right num">{money(i.unit_price, currency)}</td>
                    <td className="py-2 text-right num font-semibold">{money(i.amount, currency)}</td>
                    <td className="py-2 text-right"><button type="button" onClick={() => setItems((x) => x.filter((_, j) => j !== n))} className="text-bad font-semibold">Sil</button></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line">
                  <td colSpan={3} className="py-2 text-right font-semibold">Toplam</td>
                  <td className="py-2 text-right num font-bold text-brand-800">{money(total, currency)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
          {customer && customer.discount_pct > 0 && <p className="text-xs text-muted">Bu hekime %{customer.discount_pct} iskonto fiyatlara otomatik uygulanıyor.</p>}
        </section>
      </div>

      {/* Alt çubuk */}
      <div className="fixed inset-x-0 bottom-0 md:left-62 z-20 bg-white/95 backdrop-blur border-t border-line px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] mb-[72px] md:mb-0 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => save(false)} className="h-12 px-6 rounded-[10px] bg-[#E53935] text-white font-bold disabled:opacity-60">{busy ? "Kaydediliyor…" : "Kaydet"}</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="h-12 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-ink disabled:opacity-60">Kaydet ve yazdır</button>
        {job && <Link href="/isler/yeni" className="h-12 px-5 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">+ Yeni iş</Link>}
        {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
        {!job && <span className="text-xs text-muted ml-auto">Fotoğraf çekme ve yükleme kayıttan sonra açılır.</span>}
      </div>
    </div>
  );
}
