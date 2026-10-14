import { btnSecondary, inputCls } from "@/components/erp";

/** Rapor dönemi seçimi (GET formu) + Excel bağlantısı */
export function PeriodForm({ from, to, extra, excel, children }: { from: string; to: string; extra?: Record<string, string | null | undefined>; excel?: string; children?: React.ReactNode }) {
  const y = from.slice(0, 4);
  const quick: Array<[string, string, string]> = [
    [`${y}-01-01`, `${y}-12-31`, `${y} yılı`], [`${y}-01-01`, `${y}-03-31`, "1. çeyrek"], [`${y}-04-01`, `${y}-06-30`, "2. çeyrek"], [`${y}-07-01`, `${y}-09-30`, "3. çeyrek"], [`${y}-10-01`, `${y}-12-31`, "4. çeyrek"],
  ];
  const qs = (f: string, t: string) => { const u = new URLSearchParams({ bas: f, bit: t }); Object.entries(extra ?? {}).forEach(([k, v]) => v && u.set(k, v)); return `?${u}`; };
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <form className="flex flex-wrap items-end gap-2">
        {Object.entries(extra ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Başlangıç<input type="date" name="bas" defaultValue={from} className={`${inputCls} w-40`} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bitiş<input type="date" name="bit" defaultValue={to} className={`${inputCls} w-40`} /></label>
        {children}
        <button className={btnSecondary}>Göster</button>
      </form>
      <div className="flex flex-wrap gap-1.5 text-xs">{quick.map(([f, t, l]) => <a key={l} href={qs(f, t)} className="rounded-full border border-line bg-white px-2.5 py-1 font-semibold">{l}</a>)}</div>
      {excel && <a href={excel} className="ml-auto text-sm font-semibold text-brand-700">Excel ↓</a>}
    </div>
  );
}
