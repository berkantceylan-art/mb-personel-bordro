import { btnSecondary, inputCls } from "@/components/erp";

/** Tarih aralığı filtresi (GET formu) */
export function DateFilter({ from, to, extra }: { from?: string; to?: string; extra?: Record<string, string | undefined> }) {
  return (
    <form className="flex flex-wrap items-end gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-xs text-muted flex flex-col gap-1">Başlangıç<input type="date" name="bas" defaultValue={from} className={`${inputCls} w-40`} /></label>
      <label className="text-xs text-muted flex flex-col gap-1">Bitiş<input type="date" name="bit" defaultValue={to} className={`${inputCls} w-40`} /></label>
      <button className={btnSecondary}>Göster</button>
    </form>
  );
}
