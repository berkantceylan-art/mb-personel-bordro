"use client";
import { useActionForm } from "@/lib/use-action-form";
import { postSalaries } from "./actions";

export function SalaryButton({ period, channel, label, defaultDate, disabled }: { period: string; channel: "BANK" | "CASH"; label: string; defaultDate: string; disabled?: boolean }) {
  const { state, pending, formProps } = useActionForm(postSalaries);
  return (
    <form {...formProps} className="flex flex-col gap-2 items-start">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="channel" value={channel} />
      <div className="flex gap-2 items-end flex-wrap">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Ödeme tarihi
          <input type="date" name="date" defaultValue={defaultDate} required className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-ink" />
        </label>
        <button disabled={pending || disabled} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-50">
          {pending ? "İşleniyor…" : label}
        </button>
      </div>
      {state && <p role="status" className={`text-sm rounded-lg px-3 py-1.5 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
    </form>
  );
}
