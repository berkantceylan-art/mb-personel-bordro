import { rateCase, saveTemplate } from "@/lib/portal-plus-actions";
import { PLUS_UI, STAGE_UI } from "@/lib/portal-plus-ui";
import type { Locale } from "@/lib/i18n";

const FLOW = ["reception", "production", "chief", "qc", "dispatch"];

/** ERP iş akışı aşaması (ince ayrıntı) */
export function StageLine({ stage, locale }: { stage: string | null | undefined; locale: Locale }) {
  if (!stage || stage === "out") return null;
  const u = STAGE_UI[locale];
  const idx = FLOW.indexOf(stage);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-semibold text-slate">{u.now}:</span>
      {stage === "tryin" ? <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{u.tryin}</span> : FLOW.map((st, i) => (
        <span key={st} className={`rounded-full px-2.5 py-1 ${i === idx ? "bg-navy font-semibold text-white" : i < idx ? "bg-porcelain text-ink" : "bg-white text-slate ring-1 ring-gypsum"}`}>{u[st]}</span>
      ))}
    </div>
  );
}

function Stars({ name, label }: { name: string; label: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="w-32 text-sm font-semibold text-navy">{label}</span>
      {[1, 2, 3, 4, 5].map((v) => (
        <label key={v} className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-gypsum bg-white text-sm font-semibold text-slate has-[:checked]:border-amber-400 has-[:checked]:bg-amber-400 has-[:checked]:text-white">
          <input type="radio" name={name} value={v} required className="sr-only" />{v}★
        </label>
      ))}
    </fieldset>
  );
}

/** Teslim sonrası memnuniyet puanı */
export function RatingCard({ caseId, rating, locale, flash }: { caseId: string; rating: { fit: number; shade: number; service: number; comment: string | null } | null; locale: Locale; flash?: string }) {
  const u = PLUS_UI[locale];
  if (rating) {
    return (
      <section id="puan" className="rounded-2xl border border-gypsum bg-white p-5">
        <h2 className="display text-lg font-semibold text-navy">{u.yourRating}</h2>
        {flash === "ok" && <p className="mt-2 text-sm font-semibold text-emerald-700">{u.thanks}</p>}
        <ul className="mt-3 grid gap-1 text-sm">{([["fit", u.fit], ["shade", u.shade], ["service", u.service]] as const).map(([k, l]) => <li key={k} className="flex gap-3"><span className="w-32 text-slate">{l}</span><span className="text-amber-400">{"★".repeat(rating[k])}<span className="text-gypsum">{"★".repeat(5 - rating[k])}</span></span></li>)}</ul>
        {rating.comment && <p className="mt-2 text-sm text-slate">“{rating.comment}”</p>}
      </section>
    );
  }
  return (
    <section id="puan" className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-5">
      <h2 className="display text-lg font-semibold text-navy">⭐ {u.rateTitle}</h2>
      <p className="mt-1 text-sm text-slate">{u.rateLead}</p>
      <form action={rateCase} className="mt-4 grid gap-3">
        <input type="hidden" name="case_id" value={caseId} />
        <Stars name="fit" label={u.fit} /><Stars name="shade" label={u.shade} /><Stars name="service" label={u.service} />
        <textarea name="comment" rows={2} maxLength={1000} placeholder={u.comment} className="field" />
        <button className="justify-self-start rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white">{u.send}</button>
      </form>
    </section>
  );
}

export function SaveTemplate({ caseId, locale, flash }: { caseId: string; locale: Locale; flash?: string }) {
  const u = PLUS_UI[locale];
  return (
    <details className="rounded-2xl border border-gypsum bg-white p-4 text-sm" open={!!flash}>
      <summary className="cursor-pointer font-semibold text-navy">📋 {u.tplSave}</summary>
      {flash === "ok" && <p className="mt-2 font-semibold text-emerald-700">{u.tplSaved}</p>}
      <form action={saveTemplate} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="case_id" value={caseId} />
        <input name="name" required maxLength={80} placeholder={u.tplName} className="field min-w-[220px] flex-1" />
        <button className="rounded-full bg-navy px-4 py-2 font-semibold text-white">{u.save}</button>
      </form>
    </details>
  );
}
