"use client";
import { useState } from "react";
import { Field, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { glStampSave } from "@/lib/gl-actions";
import { STAMP_TYPES } from "./shared";


/** Damga vergisine tabi kâğıt ekleme */
export function StampForm({ month, parties }: { month: string; parties: Array<{ id: string; name: string }> }) {
  const [type, setType] = useState("contract");
  const [rate, setRate] = useState("9,48");
  const fixed = type === "fixed";
  return (
    <form action={glStampSave} className="grid gap-3 md:grid-cols-3">
      <Field label="Düzenleme tarihi"><input type="date" name="doc_date" required defaultValue={`${month}-01`} className={inputCls} /></Field>
      <Field label="Kâğıt türü">
        <select name="doc_type" value={type} onChange={(e) => { setType(e.target.value); const t = STAMP_TYPES.find((x) => x[0] === e.target.value); if (t && t[2]) setRate(String(t[2]).replace(".", ",")); }} className={selectCls}>
          {STAMP_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Adı"><input name="title" required maxLength={200} placeholder="ör. Atölye kira sözleşmesi" className={inputCls} /></Field>
      <Field label="Karşı taraf" hint="isteğe bağlı">
        <select name="party_id" defaultValue="" className={selectCls}>
          <option value="">—</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {fixed ? (
        <Field label="Maktu vergi" hint="TL"><input name="fixed_amount" inputMode="decimal" required placeholder="0,00" className={inputCls} /></Field>
      ) : (
        <>
          <Field label="Sözleşme bedeli" hint={type === "rent" ? "aylık kira × süre (ay)" : "KDV hariç toplam, TL"}><input name="base" inputMode="decimal" required placeholder="0,00" className={inputCls} /></Field>
          <Field label="Oran" hint="binde"><input name="rate_pm" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} /></Field>
        </>
      )}
      <Field label="Şirketin payı" hint="%; taraflar paylaşıyorsa ör. 50"><input name="share_pct" inputMode="decimal" defaultValue="100" className={inputCls} /></Field>
      <Field label="Not" className="md:col-span-2"><input name="note" maxLength={500} className={inputCls} /></Field>
      <div className="md:col-span-3"><PendingSubmit className={btnPrimary}>Ekle</PendingSubmit></div>
    </form>
  );
}
