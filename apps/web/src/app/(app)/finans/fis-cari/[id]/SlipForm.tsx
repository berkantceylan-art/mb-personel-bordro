"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { PhotoPicker } from "@/components/PhotoPicker";
import { saveSlip } from "@/lib/supplier-actions";

/** Fiş ekle (tutar, para birimi, belge no, fotoğraf); mal kabulden gelirse tutar önerilir */
export function SlipForm({ party, currency, receipt, defAmount, defDoc, compact = false }: { party: string; currency: string; receipt?: string; defAmount?: string; defDoc?: string; compact?: boolean }) {
  const router = useRouter();
  const [pics, setPics] = useState<string[]>([]);
  const [n, setN] = useState(0);
  const { state, pending, formProps } = useActionForm(saveSlip, { prepare: (fd) => fd.set("photo", pics[0] ?? ""), onSuccess: () => { setPics([]); setN((x) => x + 1); router.refresh(); } });
  return (
    <form {...formProps} className={compact ? "flex flex-wrap items-end gap-2" : "grid gap-3 md:grid-cols-3"} key={n}>
      <input type="hidden" name="party_id" value={party} />
      {receipt && <input type="hidden" name="receipt_id" value={receipt} />}
      <Field label="Fiş tarihi"><input type="date" name="slip_date" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} className={inputCls} /></Field>
      <Field label="Fiş / irsaliye no"><input name="doc_no" defaultValue={defDoc} maxLength={60} className={inputCls} /></Field>
      <div className="flex gap-2">
        <Field label="Tutar" className="flex-1"><input name="amount" defaultValue={defAmount} inputMode="decimal" required placeholder="0,00" className={`${inputCls} num text-right`} /></Field>
        <Field label="Para birimi"><select name="currency" defaultValue={currency} className={selectCls}>{["TRY", "EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      {!compact && <Field label="Not" hint="isteğe bağlı" className="md:col-span-2"><input name="note" maxLength={300} className={inputCls} /></Field>}
      {!compact && <div className="flex items-end"><PhotoPicker value={pics} onChange={setPics} max={1} label="📷 Fiş fotoğrafı" /></div>}
      {state && !compact && <div className="md:col-span-3"><Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice></div>}
      {state && compact && !state.ok && <span className="text-xs text-bad">{state.message}</span>}
      <div className={compact ? "" : "md:col-span-3"}><button disabled={pending} className={btnPrimary}>{pending ? "…" : compact ? "Fişe işle" : "Fişi kaydet"}</button></div>
    </form>
  );
}
