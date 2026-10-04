"use client";
import { useActionForm } from "@/lib/use-action-form";
import { createPeriod } from "./actions";

export function CreatePeriodButton({ period, label, variant = "primary" }: { period: string; label: string; variant?: "primary" | "secondary" }) {
  const { state, pending, formProps: actionProps } = useActionForm(createPeriod);
  return (
    <form {...actionProps} className="flex flex-col gap-2 items-start">
      <input type="hidden" name="period" value={period} />
      <button
        disabled={pending}
        className={
          variant === "primary"
            ? "h-12 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60"
            : "h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-brand-700 text-[13px] font-semibold disabled:opacity-60"
        }
      >
        {pending ? "Oluşturuluyor…" : label}
      </button>
      {state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
    </form>
  );
}
