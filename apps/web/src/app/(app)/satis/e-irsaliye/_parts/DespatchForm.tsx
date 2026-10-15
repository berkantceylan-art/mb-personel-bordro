"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { edspSave } from "@/lib/edsp-actions";
import { Field, Notice, btnPrimary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { UNITS } from "@/lib/stock";

type Party = { id: string; name: string; tax_no: string | null; is_edespatch: boolean };
type Line = { key: number; name: string; qty: number; unit: string; seller_code: string; unit_price: string; currency: string };
type InitLine = { name: string; qty: number; unit: string; seller_code: string | null; unit_price: number | null; currency: string | null };
export type DespatchInitial = { [k: string]: string | null | InitLine[] | undefined; lines?: InitLine[] };

let k = 0;
const blank = (): Line => ({ key: ++k, name: "", qty: 1, unit: "adet", seller_code: "", unit_price: "", currency: "TRY" });
const num = (s: string) => { const n = Number(s.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/** e-İrsaliye formu: alıcı, sevk zamanı, araç / şoför / taşıyıcı, satırlar */
export function DespatchForm({ parties, initial, now }: { parties: Party[]; initial?: DespatchInitial; now: { date: string; time: string } }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { type_code: "SEVK", issue_date: now.date, issue_time: now.time, ship_date: now.date, ship_time: now.time };
    for (const [key, val] of Object.entries(initial ?? {})) if (key !== "lines" && typeof val === "string") o[key] = val;
    return o;
  });
  const [lines, setLines] = useState<Line[]>(() => initial?.lines?.length ? initial.lines.map((l) => ({ key: ++k, name: l.name, qty: Number(l.qty), unit: l.unit, seller_code: l.seller_code ?? "", unit_price: l.unit_price != null ? String(l.unit_price).replace(".", ",") : "", currency: l.currency ?? "TRY" })) : [blank()]);
  const [mode, setMode] = useState<"own" | "carrier">(initial?.carrier_name ? "carrier" : "own");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (key: string, val: string) => setV((x) => ({ ...x, [key]: val }));
  const shown = useMemo(() => { const s = q.toLocaleLowerCase("tr").trim(); return parties.filter((p) => !s || p.name.toLocaleLowerCase("tr").includes(s) || (p.tax_no ?? "").includes(s)).slice(0, 200); }, [parties, q]);
  const party = parties.find((p) => p.id === v.party_id);

  async function submit() {
    setBusy(true); setMsg(null);
    const body = { ...v, ...(mode === "own" ? { carrier_name: "", carrier_tax_no: "" } : { driver_name: v.driver_name ?? "", driver_tckn: v.driver_tckn ?? "" }),
      lines: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, seller_code: l.seller_code || null, unit_price: l.unit_price ? num(l.unit_price) : null, currency: l.unit_price ? l.currency : null })) };
    const r = await edspSave(body);
    setBusy(false);
    if (r.ok && r.id) router.push(`/satis/e-irsaliye/${r.id}?tamam=${encodeURIComponent(r.message)}`);
    else setMsg(r.message);
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="bg-white border border-line rounded-[14px] p-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-2">
          <span className="text-sm font-semibold">Alıcı (teslim alan)</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad ya da VKN ile ara…" className={inputCls} />
          <select value={v.party_id ?? ""} onChange={(e) => set("party_id", e.target.value)} size={5} className={`${selectCls} h-auto py-1`}>
            {shown.map((p) => <option key={p.id} value={p.id}>{p.name}{p.tax_no ? ` · ${p.tax_no}` : ""}{p.is_edespatch ? " · e-İrsaliye" : ""}</option>)}
          </select>
          {party && <span className="text-xs text-muted">{party.is_edespatch ? "e-İrsaliye mükellefi (son sorguya göre)" : "Son sorguya göre e-İrsaliye mükellefi değil; gönderimde yeniden sorgulanır."}{!party.tax_no ? " · VKN/TCKN yok: e-İrsaliye için gerekli" : ""}</span>}
          <Field label="Teslim adresi" hint="boş = cari adresi"><input value={v.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid gap-3 grid-cols-2 content-start">
          <Field label="Tip" className="col-span-2"><select value={v.type_code} onChange={(e) => set("type_code", e.target.value)} className={selectCls}><option value="SEVK">Sevk irsaliyesi</option><option value="MATBUDAN">Matbudan (kâğıt irsaliyenin e-kaydı)</option></select></Field>
          <Field label="Düzenleme tarihi"><input type="date" value={v.issue_date} onChange={(e) => set("issue_date", e.target.value)} className={inputCls} /></Field>
          <Field label="Saati"><input type="time" value={v.issue_time.slice(0, 5)} onChange={(e) => set("issue_time", e.target.value)} className={inputCls} /></Field>
          <Field label="Fiili sevk tarihi"><input type="date" value={v.ship_date} onChange={(e) => set("ship_date", e.target.value)} className={inputCls} /></Field>
          <Field label="Saati"><input type="time" value={v.ship_time.slice(0, 5)} onChange={(e) => set("ship_time", e.target.value)} className={inputCls} /></Field>
          {v.type_code === "MATBUDAN" && <>
            <Field label="Kâğıt irsaliye no"><input value={v.matbu_no ?? ""} onChange={(e) => set("matbu_no", e.target.value)} className={inputCls} /></Field>
            <Field label="Kâğıt irsaliye tarihi"><input type="date" value={v.matbu_date ?? ""} onChange={(e) => set("matbu_date", e.target.value)} className={inputCls} /></Field>
          </>}
        </div>
      </section>

      <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <b>Taşıma</b>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "own"} onChange={() => setMode("own")} /> Kendi aracımız (şoför)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "carrier"} onChange={() => setMode("carrier")} /> Kargo / taşıyıcı firma</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Araç plakası" hint={mode === "carrier" ? "kargo aracının plakası" : "zorunlu"}><input value={v.plate ?? ""} onChange={(e) => set("plate", e.target.value.toUpperCase())} placeholder="34ABC123" className={`${inputCls} font-mono`} /></Field>
          <Field label="Dorse plakası" hint="varsa"><input value={v.trailer_plate ?? ""} onChange={(e) => set("trailer_plate", e.target.value.toUpperCase())} className={`${inputCls} font-mono`} /></Field>
          {mode === "own" ? <>
            <Field label="Şoför adı soyadı"><input value={v.driver_name ?? ""} onChange={(e) => set("driver_name", e.target.value)} className={inputCls} /></Field>
            <Field label="Şoför TCKN"><input value={v.driver_tckn ?? ""} onChange={(e) => set("driver_tckn", e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" className={`${inputCls} font-mono`} /></Field>
          </> : <>
            <Field label="Taşıyıcı unvanı"><input value={v.carrier_name ?? ""} onChange={(e) => set("carrier_name", e.target.value)} placeholder="ör. Yurtiçi Kargo A.Ş." className={inputCls} /></Field>
            <Field label="Taşıyıcı VKN"><input value={v.carrier_tax_no ?? ""} onChange={(e) => set("carrier_tax_no", e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" className={`${inputCls} font-mono`} /></Field>
          </>}
          <Field label="Sipariş no" hint="varsa"><input value={v.order_no ?? ""} onChange={(e) => set("order_no", e.target.value)} className={inputCls} /></Field>
          <Field label="Sipariş tarihi"><input type="date" value={v.order_date ?? ""} onChange={(e) => set("order_date", e.target.value)} className={inputCls} /></Field>
        </div>
      </section>

      <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 text-sm">
        <b>Sevk edilen mallar</b>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr className="text-xs text-muted text-left"><th className="py-1 pr-2 w-[45%]">Mal / hizmet</th><th className="py-1 pr-2 w-24 text-right">Miktar</th><th className="py-1 pr-2 w-24">Birim</th><th className="py-1 pr-2">Kod</th><th className="py-1 pr-2 w-28 text-right">Birim fiyat</th><th className="py-1 pr-2 w-20">Para</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-[#EEF2F6]">
                  <td className="py-1 pr-2"><input value={l.name} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} className={`${inputCls} h-9`} /></td>
                  <td className="py-1 pr-2"><input defaultValue={String(l.qty).replace(".", ",")} onBlur={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: num(e.target.value) } : x)))} inputMode="decimal" className={`${inputCls} h-9 text-right`} /></td>
                  <td className="py-1 pr-2"><select value={l.unit} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unit: e.target.value } : x)))} className={`${selectCls} h-9`}>{[...new Set([...UNITS, l.unit])].map((u) => <option key={u}>{u}</option>)}</select></td>
                  <td className="py-1 pr-2"><input value={l.seller_code} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, seller_code: e.target.value } : x)))} className={`${inputCls} h-9 font-mono`} /></td>
                  <td className="py-1 pr-2"><input value={l.unit_price} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unit_price: e.target.value } : x)))} placeholder="isteğe bağlı" inputMode="decimal" className={`${inputCls} h-9 text-right`} /></td>
                  <td className="py-1 pr-2"><select value={l.currency} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, currency: e.target.value } : x)))} className={`${selectCls} h-9`}>{["TRY", "EUR", "USD", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td className="py-1"><button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))} className="px-1.5 text-bad">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="self-start text-sm font-semibold text-brand-700">+ Satır ekle</button>
      </section>

      <Field label="Not"><textarea value={v.note ?? ""} onChange={(e) => set("note", e.target.value)} rows={2} maxLength={500} className={textareaCls} /></Field>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <div className="flex gap-3 items-center">
        <button type="button" disabled={busy} onClick={submit} className={btnPrimary}>{busy ? "Kaydediliyor…" : "Kaydet"}</button>
        <span className="text-xs text-muted">Kaydettikten sonra irsaliye sayfasından eLogo&apos;ya gönderilir. Alıcı e-İrsaliye mükellefi değilse kâğıt irsaliye kullanılır.</span>
      </div>
    </div>
  );
}
