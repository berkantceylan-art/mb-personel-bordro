"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveInvoice, type InvoicePayload } from "@/lib/invoice-actions";
import { CURRENCIES, fmt } from "@/lib/fin";
import { UNITS, qty as fq } from "@/lib/stock";
import { DIRECTION, VAT_EXEMPTIONS, VAT_RATES, calcLine, calcTotals, type Direction, type LineInput } from "@/lib/invoice";
import { EINV_PROFILES, EINV_TYPES, INCOTERMS, PACKAGE_KINDS, PAY_METHODS, PROFILE_TYPES, TRANSPORT_MODES, WITHHOLDINGS } from "@/lib/einv-codes";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls, textareaCls } from "@/components/erp";
import type { FormItem, FormParty, FormProduct } from "@/lib/invoice-data";
import { CategorySelect } from "@/components/CategorySelect";
import { uploadReceipt } from "@/lib/upload-receipt";

type Row = LineInput & { key: string; open?: boolean };
type Opt = { kind: "item" | "product"; id: string; label: string; sub: string; unit: string; price: number | null; cur: string; vat: number; stock?: number; stockKind?: string };

let seq = 0;
const blank = (vat: number): Row => ({ key: `r${++seq}`, name: "", qty: 1, unit: "adet", unit_price: 0, discount_pct: 0, vat_rate: vat, withholding_rate: 0 });
const numIn = (s: string) => { const t = s.trim(); const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? n : 0; };
const show = (n: number) => (n ? String(n).replace(".", ",") : "");

export type InitialInvoice = Partial<Omit<InvoicePayload, "lines">> & { lines?: LineInput[] };
type Ed = Record<string, string | boolean>;
const isTR = (c?: string | null) => !c || ["TR", "TÜRKIYE", "TÜRKİYE", "TURKEY"].includes(c.trim().toLocaleUpperCase("tr-TR"));

export function InvoiceForm({ direction, parties, items, products, warehouses, categories, rates, today, labVat, initial }: {
  direction: Direction; parties: FormParty[]; items: FormItem[]; products: FormProduct[]; warehouses: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string; code: string }[]; rates: Record<string, number>; today: string; labVat: number; initial?: InitialInvoice;
}) {
  const router = useRouter();
  const D = DIRECTION[direction];
  const defVat = direction === "sale" ? labVat : 20;
  const [type, setType] = useState<"invoice" | "return">(initial?.type ?? "invoice");
  const [attach, setAttach] = useState<{ path: string; name: string } | null>(initial?.attach_path ? { path: initial.attach_path, name: initial.attach_name ?? "Fotoğraftan okunan fatura" } : null);
  const [upBusy, setUpBusy] = useState(false);
  const [partyId, setPartyId] = useState(initial?.party_id ?? "");
  const [pq, setPq] = useState("");
  const [newParty, setNewParty] = useState(!initial?.party_id && !!initial?.new_party?.name);
  const [np, setNp] = useState({ name: "", tax_no: "", tax_office: "", address: "", city: "", email: "", phone: "", is_einvoice: false, ...(initial?.new_party ?? {}) });
  const [docNo, setDocNo] = useState(initial?.doc_no ?? "");
  const [date, setDate] = useState(initial?.invoice_date ?? today);
  const [due, setDue] = useState(initial?.due_date ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? parties.find((p) => p.id === initial?.party_id)?.currency ?? "TRY");
  const [rate, setRate] = useState(initial?.rate ?? "");
  const [wh, setWh] = useState(initial?.warehouse_id ?? warehouses[0]?.id ?? "");
  const [profile, setProfile] = useState(initial?.profile ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [ed, setEd] = useState<Ed>(() => Object.fromEntries(Object.entries(initial?.edoc ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : v == null ? "" : String(v)])));
  const E = (k: string) => String(ed[k] ?? "");
  const setE = (patch: Ed) => setEd((x) => ({ ...x, ...patch }));
  const [rows, setRows] = useState<Row[]>(() => (initial?.lines?.length ? initial.lines.map((l) => ({ ...l, key: `r${++seq}` })) : [blank(defVat)]));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  const party = parties.find((p) => p.id === partyId);
  const shownParties = useMemo(() => {
    const q = pq.toLocaleLowerCase("tr").trim();
    return parties.filter((p) => !q || p.name.toLocaleLowerCase("tr").includes(q) || (p.tax_no ?? "").includes(q)).slice(0, 200);
  }, [parties, pq]);
  const opts: Opt[] = useMemo(() => [
    ...products.map((p) => ({ kind: "product" as const, id: p.id, label: p.name, sub: `Protez ${p.code ?? ""}`, unit: "adet", price: currency === "EUR" && p.price_eur ? p.price_eur : p.price_try, cur: currency === "EUR" && p.price_eur ? "EUR" : "TRY", vat: labVat })),
    ...items.map((i) => ({
      kind: "item" as const, id: i.id, label: i.name, sub: `${i.code}${i.barcode ? ` · ${i.barcode}` : ""}`, unit: i.unit,
      price: direction === "sale" ? i.sale_price : i.purchase_price, cur: direction === "sale" ? i.sale_currency : i.purchase_currency, vat: Number(i.vat_rate ?? 20), stock: i.qty, stockKind: i.kind,
    })),
  ], [items, products, currency, direction, labVat]);
  const r = (c: string) => (c === "TRY" ? 1 : Number(rates[c]) || 0);
  const invRate = currency === "TRY" ? 1 : numIn(String(rate)) || r(currency);
  const convert = (minor: number | null, from: string) => {
    if (!minor) return 0;
    if (from === currency) return minor / 100;
    const a = r(from), b = invRate;
    return a && b ? Math.round(((minor / 100) * a) / b * 10000) / 10000 : minor / 100;
  };
  const t = calcTotals(rows.filter((x) => x.name.trim()));
  const issuing = (direction === "sale" && type === "invoice") || (direction === "purchase" && type === "return");
  const regd = party?.is_einvoice || (newParty && np.is_einvoice);
  const effProfile = profile || (direction === "purchase" ? (type === "return" ? (regd ? "TEMELFATURA" : "EARSIVFATURA") : "TICARIFATURA") : party && !isTR(party.country) ? "IHRACAT" : regd ? (type === "return" ? "TEMELFATURA" : "TICARIFATURA") : "EARSIVFATURA");
  const foreign = !!party && !isTR(party.country);
  const anyZero = rows.some((x) => Number(x.vat_rate) === 0 && x.name.trim());
  const typeOptions = PROFILE_TYPES[effProfile] ?? Object.keys(EINV_TYPES);
  function microExport() {
    setProfile("EARSIVFATURA");
    setE({ export_doc_kind: "etgb", type_code: "ISTISNA" });
    setRows((rs) => rs.map((x) => ({ ...x, vat_rate: 0, vat_exemption_code: "301", open: true })));
    setMsg({ ok: true, text: "Mikro ihracat: e-Arşiv, istisna 301, KDV %0. Satırlara GTİP, aşağıya ETGB numarasını yazın; para birimini seçin." });
  }

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const pick = (key: string, o: Opt) => set(key, {
    name: o.label, unit: o.unit, unit_price: convert(o.price, o.cur), vat_rate: o.vat,
    item_id: o.kind === "item" ? o.id : null, lab_product_id: o.kind === "product" ? o.id : null, seller_code: o.kind === "item" ? o.sub.split(" · ")[0] : null,
  });

  function addByCode(code: string) {
    const c = code.trim().toLocaleLowerCase("tr");
    if (!c) return;
    const it = items.find((i) => i.barcode?.toLocaleLowerCase("tr") === c || i.code.toLocaleLowerCase("tr") === c);
    if (!it) { setMsg({ ok: false, text: `“${code}” kodlu kart yok.` }); return; }
    setRows((rs) => {
      const same = rs.find((x) => x.item_id === it.id);
      if (same) return rs.map((x) => (x === same ? { ...x, qty: Number(x.qty) + 1 } : x));
      const empty = rs.find((x) => !x.name.trim());
      const o = opts.find((x) => x.id === it.id)!;
      const row: Row = { ...(empty ?? blank(defVat)), name: o.label, unit: o.unit, unit_price: convert(o.price, o.cur), vat_rate: o.vat, item_id: it.id, seller_code: it.code };
      return empty ? rs.map((x) => (x === empty ? row : x)) : [...rs, row];
    });
    setScan("");
    setMsg(null);
    scanRef.current?.focus();
  }

  async function submit(post: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await saveInvoice({
      id: initial?.id ?? null, direction, type, party_id: newParty ? null : partyId || null, new_party: newParty ? np : null,
      doc_no: docNo, invoice_date: date, due_date: due || null, currency, rate: currency === "TRY" ? null : String(rate || r(currency)), warehouse_id: wh || null,
      profile: profile || null, note, post, return_of: type === "return" ? initial?.return_of ?? null : null,
      edoc: issuing ? { ...ed, online_sale: !!ed.online_sale } : null,
      ettn: initial?.ettn ?? null,
      attach_path: attach?.path ?? null, attach_name: attach?.name ?? null,
      lines: rows.filter((x) => x.name.trim()).map((x) => { const l: Partial<Row> = { ...x }; delete l.key; delete l.open; return l as LineInput; }),
    });
    setBusy(false);
    if (res.id) router.push(`/fatura/${res.id}?${res.ok ? "tamam" : "hata"}=${encodeURIComponent(res.message)}`);
    else setMsg({ ok: res.ok, text: res.message });
  }

  const stockWarn = direction === "sale" && type === "invoice" ? rows.filter((x) => x.item_id).map((x) => ({ x, it: items.find((i) => i.id === x.item_id) })).filter(({ x, it }) => it && it.kind !== "service" && it.qty < Number(x.qty)) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2" role="tablist">
        {([["invoice", `${D.label} faturası`], ["return", `${D.label} iadesi`]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={type === k} onClick={() => setType(k)} className={`rounded-full px-4 py-2 text-sm font-semibold border ${type === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{label}</button>
        ))}
      </div>

      <section className="bg-white border border-line rounded-[14px] p-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-sm font-semibold">
            {D.party}
            <label className="ml-auto flex items-center gap-1.5 font-normal"><input type="checkbox" checked={newParty} onChange={(e) => setNewParty(e.target.checked)} /> Kayıtlı değil, yeni cari aç</label>
          </div>
          {!newParty ? (
            <>
              <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Ad ya da VKN ile ara…" className={inputCls} />
              <select value={partyId} onChange={(e) => {
                setPartyId(e.target.value);
                const p = parties.find((x) => x.id === e.target.value);
                if (p) { setCurrency(p.currency); if (p.payment_term_days && !due) { const d = new Date(date); d.setDate(d.getDate() + p.payment_term_days); setDue(d.toISOString().slice(0, 10)); } }
              }} size={5} className={`${selectCls} h-auto py-1`}>
                {shownParties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.tax_no ? ` · ${p.tax_no}` : ""} · {p.currency}{p.lab ? " · hekim" : ""}</option>)}
              </select>
              {party && <span className="text-xs text-muted">{party.is_einvoice ? "e-Fatura mükellefi" : "e-Fatura mükellefi değil (e-Arşiv)"}{!party.tax_no && direction === "sale" ? " · VKN/TCKN yok: faturada 11111111111 yazılır" : ""}</span>}
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="Unvan / ad soyad *" className={`${inputCls} sm:col-span-2`} />
              <input value={np.tax_no} onChange={(e) => setNp({ ...np, tax_no: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="VKN (10) / TCKN (11)" inputMode="numeric" className={inputCls} />
              <input value={np.tax_office} onChange={(e) => setNp({ ...np, tax_office: e.target.value })} placeholder="Vergi dairesi" className={inputCls} />
              <input value={np.address} onChange={(e) => setNp({ ...np, address: e.target.value })} placeholder="Adres" className={`${inputCls} sm:col-span-2`} />
              <input value={np.city} onChange={(e) => setNp({ ...np, city: e.target.value })} placeholder="İl" className={inputCls} />
              <input value={np.email} onChange={(e) => setNp({ ...np, email: e.target.value })} placeholder="E-posta" className={inputCls} />
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={np.is_einvoice} onChange={(e) => setNp({ ...np, is_einvoice: e.target.checked })} /> e-Fatura mükellefi</label>
              <span className="text-xs text-muted sm:col-span-2">Aynı VKN ile kayıtlı cari varsa yenisi açılmaz, o kullanılır.</span>
            </div>
          )}
        </div>
        <div className="grid gap-3 grid-cols-2 content-start">
          <Field label="Fatura tarihi"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Vade"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} /></Field>
          <Field label="Fatura no" hint={issuing ? "boş = otomatik" : "tedarikçinin"}><input value={docNo} onChange={(e) => setDocNo(e.target.value.toUpperCase())} maxLength={40} className={`${inputCls} font-mono`} /></Field>
          <Field label="Para birimi">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          {currency !== "TRY" && <Field label={`Kur (1 ${currency})`} hint={r(currency) ? `TCMB ${String(r(currency)).replace(".", ",")}` : "kur yok"}><input value={rate} onChange={(e) => setRate(e.target.value)} placeholder={String(r(currency) || "").replace(".", ",")} inputMode="decimal" className={inputCls} /></Field>}
          <Field label="Depo"><select value={wh} onChange={(e) => setWh(e.target.value)} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          {issuing && (
            <>
              <Field label="Senaryo" className="col-span-2" hint={EINV_PROFILES[effProfile]?.hint}>
                <select value={profile} onChange={(e) => { setProfile(e.target.value); setE({ type_code: "" }); }} className={selectCls}>
                  <option value="">Otomatik ({EINV_PROFILES[effProfile]?.label ?? effProfile})</option>
                  {Object.entries(EINV_PROFILES).filter(([k]) => direction === "sale" || ["TEMELFATURA", "EARSIVFATURA", "KAGIT"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Fatura tipi" className="col-span-2" hint="otomatik: satırlardaki tevkifat / istisna kodundan">
                <select value={E("type_code")} onChange={(e) => setE({ type_code: e.target.value })} className={selectCls}>
                  <option value="">Otomatik</option>
                  {typeOptions.map((k) => <option key={k} value={k}>{EINV_TYPES[k] ?? k}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      </section>

      <section className="bg-white border border-line rounded-[14px]">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
          <h2 className="font-semibold">Kalemler</h2>
          <form onSubmit={(e) => { e.preventDefault(); addByCode(scan); }} className="ml-auto flex gap-2">
            <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Barkod / stok kodu okut" className={`${inputCls} h-9 w-56 font-mono`} />
            <button className={`${btnSecondary} h-9`}>Ekle</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-xs text-muted text-left">
              <th className="px-3 py-2 w-[34%]">Ürün / hizmet</th><th className="px-2 py-2 w-24 text-right">Miktar</th><th className="px-2 py-2 w-24">Birim</th>
              <th className="px-2 py-2 w-32 text-right">Birim fiyat</th><th className="px-2 py-2 w-20 text-right">İsk. %</th><th className="px-2 py-2 w-20">KDV</th>
              <th className="px-2 py-2 w-32 text-right">Tutar (KDV hariç)</th><th className="w-16" />
            </tr></thead>
            <tbody>
              {rows.map((x) => {
                const c = calcLine(x);
                const linked = x.item_id ? items.find((i) => i.id === x.item_id) : null;
                return (
                  <FragmentRow key={x.key}>
                    <tr className="border-t border-[#EEF2F6] align-top">
                      <td className="px-3 py-2"><Picker value={x.name} opts={opts} onText={(v) => set(x.key, { name: v, item_id: null, lab_product_id: null })} onPick={(o) => pick(x.key, o)} />
                        <span className="text-[11px] text-muted">{linked ? `Stok kartı: ${linked.code} · eldeki ${fq(linked.qty)} ${linked.unit}` : x.lab_product_id ? "Protez ürünü" : x.name ? "Stoksuz kalem" : ""}</span></td>
                      <td className="px-2 py-2"><input key={`q${x.qty}`} defaultValue={show(Number(x.qty))} onBlur={(e) => set(x.key, { qty: numIn(e.target.value) })} inputMode="decimal" className={`${inputCls} h-9 text-right`} /></td>
                      <td className="px-2 py-2"><select value={x.unit} onChange={(e) => set(x.key, { unit: e.target.value })} className={`${selectCls} h-9`}>{[...new Set([...UNITS, x.unit])].map((u) => <option key={u}>{u}</option>)}</select></td>
                      <td className="px-2 py-2"><input key={`p${x.unit_price}${x.item_id ?? ""}${x.lab_product_id ?? ""}`} defaultValue={show(Number(x.unit_price))} onBlur={(e) => set(x.key, { unit_price: numIn(e.target.value) })} inputMode="decimal" className={`${inputCls} h-9 text-right`} /></td>
                      <td className="px-2 py-2"><input key={`d${x.discount_pct}`} defaultValue={show(Number(x.discount_pct))} onBlur={(e) => set(x.key, { discount_pct: Math.min(100, numIn(e.target.value)) })} inputMode="decimal" className={`${inputCls} h-9 text-right`} /></td>
                      <td className="px-2 py-2"><select value={x.vat_rate} onChange={(e) => set(x.key, { vat_rate: Number(e.target.value) })} className={`${selectCls} h-9`}>{[...new Set([...VAT_RATES, Number(x.vat_rate)])].map((v) => <option key={v} value={v}>%{v}</option>)}</select></td>
                      <td className="px-2 py-2 text-right num pt-4">{fmt(c.net, currency)}</td>
                      <td className="px-2 py-2 pt-3 whitespace-nowrap">
                        <button type="button" title="Ayrıntılar" onClick={() => set(x.key, { open: !x.open })} className="px-1.5 text-muted">⋯</button>
                        <button type="button" title="Sil" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((y) => y.key !== x.key) : [blank(defVat)]))} className="px-1.5 text-bad">✕</button>
                      </td>
                    </tr>
                    {x.open && (
                      <tr className="bg-[#F8FAFC]">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="flex flex-wrap gap-3 text-xs items-end">
                            {!x.item_id && !x.lab_product_id && (
                              <label className="flex flex-col gap-1">{direction === "sale" ? "Gelir hesabı" : "Gider / varlık hesabı"}
                                {direction === "sale" ? (
                                  <select value={x.category_id ?? ""} onChange={(e) => set(x.key, { category_id: e.target.value || null })} className={`${selectCls} h-9 w-56`}>
                                    <option value="">Otomatik</option>
                                    {categories.map((c2) => <option key={c2.id} value={c2.id}>{c2.name}</option>)}
                                  </select>
                                ) : (
                                  <CategorySelect value={x.category_id ?? null} onChange={(id) => set(x.key, { category_id: id })} categories={categories} emptyLabel="Otomatik" className={`${selectCls} h-9 w-56`} />
                                )}
                              </label>
                            )}
                            <label className="flex flex-col gap-1">KDV tevkifatı
                              <select value={x.withholding_code ?? ""} onChange={(e) => { const w = WITHHOLDINGS.find((y) => y[0] === e.target.value); set(x.key, { withholding_code: e.target.value || null, withholding_rate: w ? w[2] : 0 }); }} className={`${selectCls} h-9 w-72`}>
                                <option value="">Yok</option>
                                {WITHHOLDINGS.map(([k, v, rt]) => <option key={k} value={k}>{k} · {v} ({rt / 10}/10)</option>)}
                              </select>
                            </label>
                            {!!x.withholding_code && <span className="pb-2">oran %{Number(x.withholding_rate ?? 0)}</span>}
                            {Number(x.vat_rate) === 0 && (
                              <label className="flex flex-col gap-1">KDV istisna
                                <select value={x.vat_exemption_code ?? "351"} onChange={(e) => set(x.key, { vat_exemption_code: e.target.value })} className={`${selectCls} h-9 w-56`}>{VAT_EXEMPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                              </label>
                            )}
                            {issuing && (effProfile === "IHRACAT" || foreign || x.vat_exemption_code === "301" || x.vat_exemption_code === "702") && (
                              <label className="flex flex-col gap-1">GTİP<input defaultValue={x.gtip ?? ""} onChange={(e) => set(x.key, { gtip: e.target.value.replace(/[^0-9.]/g, "").slice(0, 16) || null })} placeholder="9021.21.00.00.00" className={`${inputCls} h-9 w-40 font-mono`} /></label>
                            )}
                            {issuing && x.vat_exemption_code === "702" && Number(x.vat_rate) === 0 && (
                              <label className="flex flex-col gap-1">Alıcı DİİB satır kodu<input defaultValue={x.diib_line ?? ""} onChange={(e) => set(x.key, { diib_line: e.target.value.replace(/\D/g, "").slice(0, 11) || null })} placeholder="11 hane" className={`${inputCls} h-9 w-32 font-mono`} /></label>
                            )}
                            {issuing && effProfile === "ILAC_TIBBICIHAZ" && (
                              <>
                                <label className="flex flex-col gap-1">Ürün türü
                                  <select value={x.ident_scheme ?? "DIGER"} onChange={(e) => set(x.key, { ident_scheme: e.target.value })} className={`${selectCls} h-9 w-36`}><option value="TIBBICIHAZ">Tıbbi cihaz (ÜTS)</option><option value="ILAC">İlaç (İTS)</option><option value="DIGER">Diğer</option></select>
                                </label>
                                <label className="flex flex-col gap-1">Ürün tanımlayıcı<input defaultValue={x.ident ?? ""} onChange={(e) => set(x.key, { ident: e.target.value.slice(0, 200) || null })} placeholder="(UNO)…(LNO)…(SNO)…(URT)YYAAGG" className={`${inputCls} h-9 w-80 font-mono`} /></label>
                              </>
                            )}
                            {x.item_id && (
                              <>
                                <label className="flex flex-col gap-1">Lot no<input defaultValue={x.lot_no ?? ""} onChange={(e) => set(x.key, { lot_no: e.target.value || null })} className={`${inputCls} h-9 w-32`} /></label>
                                {direction === "purchase" && <label className="flex flex-col gap-1">Son kullanma<input type="date" defaultValue={x.expiry_date ?? ""} onChange={(e) => set(x.key, { expiry_date: e.target.value || null })} className={`${inputCls} h-9`} /></label>}
                              </>
                            )}
                            <span className="text-muted">Brüt {fmt(c.gross, currency)} · iskonto {fmt(c.discount, currency)} · KDV {fmt(c.vat, currency)}{c.withholding ? ` · tevkifat ${fmt(c.withholding, currency)}` : ""}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-line">
          <button type="button" onClick={() => setRows((rs) => [...rs, blank(defVat)])} className="text-sm font-semibold text-brand-700">+ Satır ekle</button>
        </div>
      </section>

      {issuing && (
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">e-Belge ayrıntıları</h2>
            <span className="text-xs text-muted">{EINV_PROFILES[effProfile]?.label}{E("type_code") ? ` · ${EINV_TYPES[E("type_code")] ?? E("type_code")}` : ""}</span>
            {direction === "sale" && <button type="button" onClick={microExport} className="ml-auto text-sm font-semibold text-brand-700">Mikro ihracat (ETGB) olarak hazırla</button>}
          </div>
          {effProfile === "EARSIVFATURA" && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Gönderim şekli"><select value={E("send_method") || "ELEKTRONIK"} onChange={(e) => setE({ send_method: e.target.value })} className={selectCls}><option value="ELEKTRONIK">Elektronik (e-posta)</option><option value="KAGIT">Kâğıt</option></select></Field>
              <Field label="ETGB no" hint="mikro ihracatta"><input value={E("export_doc_no")} onChange={(e) => setE({ export_doc_no: e.target.value.toUpperCase(), export_doc_kind: "etgb" })} className={`${inputCls} font-mono`} /></Field>
              <Field label="ETGB tarihi"><input type="date" value={E("export_doc_date")} onChange={(e) => setE({ export_doc_date: e.target.value })} className={inputCls} /></Field>
              <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={!!ed.online_sale} onChange={(e) => setE({ online_sale: e.target.checked })} /> İnternet satışı</label>
              {!!ed.online_sale && (
                <>
                  <Field label="Ödeme şekli"><select value={E("pay_method")} onChange={(e) => setE({ pay_method: e.target.value })} className={selectCls}><option value="">—</option>{PAY_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <Field label="Ödeme tarihi"><input type="date" value={E("pay_date")} onChange={(e) => setE({ pay_date: e.target.value })} className={inputCls} /></Field>
                  <Field label="Ödeme aracısı"><input value={E("pay_agent")} onChange={(e) => setE({ pay_agent: e.target.value })} placeholder="ör. iyzico" className={inputCls} /></Field>
                  <Field label="Gönderim tarihi"><input type="date" value={E("ship_date")} onChange={(e) => setE({ ship_date: e.target.value })} className={inputCls} /></Field>
                  <Field label="Taşıyıcı (kargo) unvanı"><input value={E("carrier_name")} onChange={(e) => setE({ carrier_name: e.target.value })} className={inputCls} /></Field>
                  <Field label="Taşıyıcı VKN"><input value={E("carrier_tax_no")} onChange={(e) => setE({ carrier_tax_no: e.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" className={inputCls} /></Field>
                </>
              )}
            </div>
          )}
          {effProfile === "IHRACAT" && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Teslim şartı"><select value={E("incoterm")} onChange={(e) => setE({ incoterm: e.target.value })} className={selectCls}><option value="">—</option>{INCOTERMS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Taşıma şekli"><select value={E("transport_mode")} onChange={(e) => setE({ transport_mode: e.target.value })} className={selectCls}><option value="">—</option>{TRANSPORT_MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Kap cinsi"><select value={E("package_kind")} onChange={(e) => setE({ package_kind: e.target.value })} className={selectCls}><option value="">—</option>{PACKAGE_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Kap adedi"><input value={E("package_count")} onChange={(e) => setE({ package_count: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={inputCls} /></Field>
              <Field label="Kap no"><input value={E("package_no")} onChange={(e) => setE({ package_no: e.target.value })} className={inputCls} /></Field>
              <Field label="Teslim adresi" hint="boş = cari adresi" className="sm:col-span-3"><input value={E("delivery_address")} onChange={(e) => setE({ delivery_address: e.target.value })} className={inputCls} /></Field>
              <Field label="Gümrük beyannamesi no" hint="sonradan da girilebilir"><input value={E("export_doc_no")} onChange={(e) => setE({ export_doc_no: e.target.value.toUpperCase(), export_doc_kind: "gb" })} className={`${inputCls} font-mono`} /></Field>
              <p className="sm:col-span-3 text-xs text-muted self-end">İhracat faturası Gümrük ve Ticaret Bakanlığına gider; yabancı alıcı faturada ayrıca yer alır. Her satıra GTİP yazın, KDV %0 ve istisna 301 olmalı.</p>
            </div>
          )}
          {effProfile === "KAMU" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Alıcı kurum (birim)" hint="boş = cari"><input value={E("buyer_name")} onChange={(e) => setE({ buyer_name: e.target.value })} className={inputCls} /></Field>
              <Field label="Kurum VKN"><input value={E("buyer_tax_no")} onChange={(e) => setE({ buyer_tax_no: e.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" className={inputCls} /></Field>
              <p className="text-xs text-muted self-end">Cari: faturayı ödeyen birim (saymanlık). Şirket IBAN&apos;ı Satış › Ayarlar&apos;dan gelir.</p>
            </div>
          )}
          {!["EARSIVFATURA", "IHRACAT", "KAMU"].includes(effProfile) && <p className="text-xs text-muted">{effProfile === "KAGIT" ? "Kâğıt fatura elektronik gönderilmez." : "Ek bilgi gerekmiyor."}{anyZero ? " %0 KDV'li satırlarda istisna kodunu satır ayrıntısından (⋯) seçin." : ""}</p>}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          <Field label="Fatura notu" hint="faturada görünür"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={1000} className={textareaCls} /></Field>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Fatura görüntüsü</span>
            {attach ? (
              <><span className="rounded-full bg-ok-bg text-ok px-3 py-1 text-xs font-semibold">📎 {attach.name}</span>
                <button type="button" onClick={() => setAttach(null)} className="text-xs text-muted">Kaldır</button></>
            ) : (
              <label className={`h-9 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-xs font-semibold text-brand-700 cursor-pointer ${upBusy ? "opacity-60 pointer-events-none" : ""}`}>
                {upBusy ? "Yükleniyor…" : "📎 Fotoğraf / PDF ekle (isteğe bağlı)"}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                  setUpBusy(true); const u = await uploadReceipt(f, null); setUpBusy(false);
                  if (u.path) setAttach({ path: u.path, name: f.name }); else setMsg({ ok: false, text: u.error ?? "Yüklenemedi" });
                }} />
              </label>
            )}
            <span className="text-xs text-muted">kaydedince faturaya eklenir</span>
          </div>
        </div>
        <section className="bg-white border border-line rounded-[14px] p-4 text-sm flex flex-col gap-1.5">
          <Line label="Brüt" v={fmt(t.gross, currency)} />
          {t.discount > 0 && <Line label="İskonto" v={`−${fmt(t.discount, currency)}`} />}
          <Line label="Matrah" v={fmt(t.net, currency)} />
          {[...t.byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rt, b]) => <Line key={rt} label={`KDV %${rt}`} v={fmt(b.vat, currency)} />)}
          {t.withholding > 0 && <Line label="KDV tevkifatı" v={`−${fmt(t.withholding, currency)}`} />}
          <div className="flex justify-between border-t border-line pt-2 mt-1 text-base font-bold"><span>Ödenecek</span><span className="num">{fmt(t.total, currency)}</span></div>
          {currency !== "TRY" && invRate > 0 && <span className="text-xs text-muted text-right">≈ {fmt(Math.round(t.total * invRate), "TRY")}</span>}
        </section>
      </div>

      {stockWarn.length > 0 && <Notice>Stok yetersiz görünüyor: {stockWarn.map(({ x, it }) => `${x.name} (eldeki ${fq(it!.qty)})`).join(", ")}. Fatura kesilirken seçili depodaki stok kontrol edilir.</Notice>}
      {msg && <Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => submit(true)} className={btnPrimary}>{busy ? "Kaydediliyor…" : direction === "sale" ? "Faturayı kes" : "Kaydet ve işle"}</button>
        <button type="button" disabled={busy} onClick={() => submit(false)} className={btnSecondary}>Taslak kaydet</button>
        <span className="text-xs text-muted">İşlenince cari bakiye, KDV, gelir/gider ve stok tek seferde güncellenir; iptal tümünü geri alır.</span>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Line({ label, v }: { label: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{label}</span><span className="num">{v}</span></div>;
}

/** Ürün seçici: yazarak arama, stok kartları ve protez ürünleri; serbest metin de olur */
function Picker({ value, opts, onText, onPick }: { value: string; opts: Opt[]; onText: (v: string) => void; onPick: (o: Opt) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = value.toLocaleLowerCase("tr").trim();
  const list = open ? opts.filter((o) => !q || o.label.toLocaleLowerCase("tr").includes(q) || o.sub.toLocaleLowerCase("tr").includes(q)).slice(0, 10) : [];
  return (
    <div className="relative">
      <input value={value} onChange={(e) => { onText(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          if (e.key === "Enter") { e.preventDefault(); onPick(list[hi]); setOpen(false); }
        }}
        placeholder="Ürün / malzeme ara ya da açıklama yaz" className={`${inputCls} h-9`} />
      {list.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-line rounded-[10px] shadow-lg text-sm">
          {list.map((o, i) => (
            <li key={`${o.kind}${o.id}`}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(o); setOpen(false); }} className={`w-full text-left px-3 py-2 ${i === hi ? "bg-[#EAF2FB]" : ""}`}>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-[11px] text-muted">{o.sub}{o.price ? ` · ${fmt(o.price, o.cur)}` : ""}{o.stock !== undefined && o.stockKind !== "service" ? ` · stok ${fq(o.stock)} ${o.unit}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
