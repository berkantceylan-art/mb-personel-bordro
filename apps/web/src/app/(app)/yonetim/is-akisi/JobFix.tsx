"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { jobFix } from "@/lib/admin-actions";

export const STAGES: Record<string, string> = { reception: "Kabul", production: "Üretim", chief: "Şef kontrol", qc: "Kalite kontrol", dispatch: "Sevk", tryin: "Provada (hekimde)" };

/** Bir işe yönetici müdahalesi: sorumlu ata, aşamaya taşı, not */
export function JobFix({ job, stage, people }: { job: string; stage: string; people: Array<{ id: string; name: string; role: string }> }) {
  const [mode, setMode] = useState<"" | "assign" | "stage" | "note">("");
  const { state, pending, formProps } = useActionForm(jobFix, { onSuccess: () => setMode("") });
  const sel = "h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm";
  const ROLE: Record<string, string> = { technician: "teknisyen", chief: "şef", qc: "kalite", dispatch: "sevk" };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {([["assign", "👤 Sorumlu ata"], ["stage", "➡ Aşamaya taşı"], ["note", "📝 Not"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(mode === k ? "" : k)} className={`h-8 px-2.5 rounded-lg text-xs font-semibold ${mode === k ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white"}`}>{l}</button>
        ))}
      </div>
      {mode && (
        <form {...formProps} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#F7F9FB] p-2">
          <input type="hidden" name="job" value={job} />
          <input type="hidden" name="action" value={mode} />
          {mode === "stage" && (
            <select name="stage" defaultValue={stage} className={sel} aria-label="Aşama">{Object.entries(STAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          )}
          {mode !== "note" && (
            <select name="employee" required={mode === "assign"} defaultValue="" className={sel} aria-label="Personel">
              <option value="">{mode === "assign" ? "Personel seçin" : "— sorumlu yok —"}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE[p.role] ?? p.role})</option>)}
            </select>
          )}
          <input name="note" required={mode === "note"} maxLength={300} placeholder={mode === "note" ? "Not (işin geçmişine yazılır)" : "Not (isteğe bağlı)"} aria-label="Not" className="h-9 flex-1 min-w-[160px] rounded-lg border border-[#D5DEE8] px-2 text-sm" />
          <button disabled={pending} className="h-9 px-3 rounded-lg bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{pending ? "…" : "Uygula"}</button>
        </form>
      )}
      {state && <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
    </div>
  );
}
