"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useState } from "react";
import { correctLedgerEntry } from "@/lib/ledger-actions";

const TYPES: Array<[string, string]> = [
  ["ADVANCE", "Avans"],
  ["SALARY", "Maaş ödemesi"],
  ["ACCRUAL", "Hakediş"],
  ["BONUS", "Prim / ikramiye"],
  ["OVERTIME", "Fazla mesai"],
  ["DEDUCTION", "Borç / iş kesintisi"],
  ["BES", "BES kesintisi"],
  ["GARNISHMENT", "İcra / nafaka kesintisi"],
  ["ADJUSTMENT", "Düzeltme (+/−)"],
];

export function EntryEditForm(props: {
  id: string;
  employeeId: string;
  type: string;
  channel: string;
  date: string;
  period: string;
  amount: string;
  note: string;
}) {
  const { state, pending, formProps: actionProps } = useActionForm(correctLedgerEntry);
  const [type, setType] = useState(props.type);
  const hasChannel = type === "ADVANCE" || type === "SALARY";
  const input = "h-12 rounded-[10px] border border-[#D5DEE8] px-3 text-ink bg-white";
  return (
    <form {...actionProps} className="bg-white border border-line rounded-2xl p-6 flex flex-col gap-4">
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="employeeId" value={props.employeeId} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm text-muted">Hareket türü
          <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {hasChannel && (
          <label className="flex flex-col gap-1.5 text-sm text-muted">Kanal
            <select name="channel" defaultValue={props.channel === "NONE" ? "CASH" : props.channel} className={input}>
              <option value="CASH">Elden</option>
              <option value="BANK">Banka</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih
          <input type="date" name="date" defaultValue={props.date} required className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Dönem
          <input type="month" name="period" defaultValue={props.period} required className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Tutar
          <input name="amount" defaultValue={props.amount} required inputMode="decimal" className={`${input} num font-bold text-lg`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Açıklama
          <input name="note" defaultValue={props.note} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Düzeltme gerekçesi *
        <input name="reason" required placeholder="ör. Tutar yanlış girilmiş" className={input} />
      </label>
      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <button disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold self-start disabled:opacity-60">
        {pending ? "Kaydediliyor…" : "Değişikliği kaydet"}
      </button>
    </form>
  );
}
