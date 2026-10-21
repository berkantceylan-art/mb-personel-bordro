"use client";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, inputCls } from "@/components/erp";
import { postDiscount } from "@/lib/supplier-group-actions";

const f2 = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fişli cariye iskonto: ödeme / kapanışta bakiyenin yüzdesi ayrı satırla düşülür */
export function DiscountForm({ party, main, currency, pct, suggest }: { party: string; main: string; currency: string; pct: number; suggest: number }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(postDiscount, { onSuccess: () => router.refresh() });
  return (
    <details className="rounded-[16px] border border-line bg-white p-4 md:p-5">
      <summary className="cursor-pointer font-display text-lg font-bold">− İskonto düş (%{pct})</summary>
      <p className="mt-2 text-xs text-muted">Firma iskontoyu fişlere değil, ödeme / kapanış sırasında bakiyeden düşüyor. Önerilen tutar: fişli cari borcunun %{pct}&apos;u = <b>{f2(suggest)} {currency}</b>. Firmanın ekstresindeki tutarı yazın.</p>
      <form {...formProps} className="mt-3 grid gap-3 md:grid-cols-4">
        <input type="hidden" name="party_id" value={party} />
        <input type="hidden" name="main" value={main} />
        <Field label="Tarih"><input type="date" name="date" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} className={inputCls} /></Field>
        <Field label={`Tutar (${currency})`}><input name="amount" inputMode="decimal" required defaultValue={suggest ? f2(suggest) : ""} className={`${inputCls} num text-right`} /></Field>
        <Field label="Açıklama" className="md:col-span-2"><input name="note" defaultValue={`İskonto %${pct}`} maxLength={300} className={inputCls} /></Field>
        {state && <div className="md:col-span-4"><Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice></div>}
        <div className="md:col-span-4"><button disabled={pending} className={btnPrimary}>{pending ? "…" : "İskontoyu işle"}</button></div>
      </form>
    </details>
  );
}
