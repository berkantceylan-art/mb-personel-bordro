"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { rcvStart } from "@/lib/barcode-actions";

/** Mal kabul başlat: açık satın alma siparişinden ya da serbest (tedarikçi + irsaliye / fiş no) */
export function StartForm({ orders, parties, warehouses }: { orders: { id: string; label: string }[]; parties: { id: string; name: string }[]; warehouses: { id: string; name: string; is_default: boolean }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"po" | "free">(orders.length ? "po" : "free");
  const [slip, setSlip] = useState(false);
  const { state, pending, formProps } = useActionForm(rcvStart, { onSuccess: (st) => { if (st.id) router.push(`/stok/mal-kabul/${st.id}`); } });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setMode("po")} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${mode === "po" ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white"}`}>📋 Siparişten ({orders.length})</button>
        <button type="button" onClick={() => setMode("free")} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${mode === "free" ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white"}`}>🧾 Siparişsiz (fiş / irsaliye)</button>
      </div>
      <input type="hidden" name="slip" value={slip ? "1" : ""} />
      <div className="grid gap-2 sm:grid-cols-2">
        {([[false, "🧾 Faturalı alım", "Faturası gelecek; faturalı cariye işlenir"], [true, "📄 Fişli alım (faturasız)", "Faturası gelmeyecek; onayda firmanın fişli carisine borç yazılır"]] as const).map(([v, l, d]) => (
          <button key={String(v)} type="button" onClick={() => setSlip(v)} aria-pressed={slip === v} className={`rounded-[12px] border px-3 py-2.5 text-left ${slip === v ? (v ? "border-[#F59E0B] bg-[#FFFBEB]" : "border-brand-700 bg-[#EEF4FB]") : "border-line bg-white"}`}>
            <b className="block text-sm">{l}</b><span className="block text-[11px] text-muted">{d}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {mode === "po" ? (
          <Field label="Satın alma siparişi"><select name="po_id" required className={selectCls}><option value="">— Seçin —</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
        ) : (
          <Field label="Tedarikçi (firma)"><select name="party_id" required={slip} className={selectCls}><option value="">— Seçin —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        )}
        <Field label="İrsaliye / fiş no" hint="isteğe bağlı"><input name="supplier_doc" maxLength={60} className={inputCls} /></Field>
        <Field label="Depo"><select name="warehouse_id" defaultValue={warehouses.find((w) => w.is_default)?.id} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      {state && !state.ok && <Notice tone="bad">{state.message}</Notice>}
      <div><button disabled={pending} className={btnPrimary}>{pending ? "Açılıyor…" : "Mal kabule başla · okut"}</button></div>
    </form>
  );
}
