"use client";
import { useActionState } from "react";
import { importExcel, type ImportResult } from "./actions";

export function ImportForm({ year, today }: { year: number; today: string }) {
  const [state, action, pending] = useActionState<ImportResult | null, FormData>(importExcel, null);
  return (
    <form action={action} className="bg-white border border-line rounded-2xl p-6 flex flex-col gap-5 max-w-2xl">
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Aylık maaş listesi (.xlsx)
        <input type="file" name="file" accept=".xlsx" required className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 py-2.5 text-ink" />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Yıl
          <input type="number" name="year" defaultValue={year} className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 text-ink" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Dönem (boşsa sayfa adından: &quot;EKİM&quot; → Ekim)
          <input type="month" name="period" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 text-ink" />
        </label>
      </div>
      <fieldset className="flex flex-col gap-3 text-sm">
        <legend className="text-muted mb-1">Ne aktarılsın?</legend>
        <label className="flex gap-2.5 items-center"><input type="checkbox" checked disabled className="w-5 h-5" />Bölümler, personel ve aylık toplam ücret (sigorta tipi &quot;asgari ücret&quot; olarak başlar, profilden değiştirilir)</label>
        <label className="flex gap-2.5 items-center"><input type="checkbox" name="accrual" defaultChecked className="w-5 h-5" />Hakediş tutarını bu dönemin cari hesabına yaz</label>
        <label className="flex gap-2.5 items-center"><input type="checkbox" name="payments" className="w-5 h-5" />Excel&apos;deki avans / ödeme / kesinti sütunlarını da aktar</label>
        <label className="flex flex-col gap-1.5 text-muted pl-7">
          Excel&apos;de tarih olmadığı için ödemelere yazılacak tarih
          <input type="date" name="paymentDate" defaultValue={today} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-ink max-w-56" />
        </label>
      </fieldset>
      {state && (
        <div role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          <p>{state.message}</p>
          {state.details && state.details.length > 0 && (
            <ul className="list-disc pl-5 mt-1">{state.details.slice(0, 10).map((d) => <li key={d}>{d}</li>)}</ul>
          )}
        </div>
      )}
      <button disabled={pending} className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60 self-start px-6">
        {pending ? "Aktarılıyor…" : "İçe aktar"}
      </button>
    </form>
  );
}
