import type { Locale } from "@/lib/i18n";
import { CASE_FLOW, PORTAL_UI, STATUS_CLS, formatBytes, formatDate, type CaseEvent, type CaseFile, type PortalCase } from "@/lib/portal-ui";

/** Vaka ayrıntısı: hekim portalı ve laboratuvar ekranı ortak kullanır */
export function CaseProgress({ c, locale }: { c: PortalCase; locale: Locale }) {
  const ui = PORTAL_UI[locale];
  const idx = CASE_FLOW.indexOf(c.status);
  if (idx < 0)
    return <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${STATUS_CLS[c.status]}`}>{ui.statuses[c.status]}</span>;
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label={ui.list.status}>
      {CASE_FLOW.map((st, i) => (
        <li key={st} aria-current={i === idx ? "step" : undefined} className="grid gap-1.5">
          <span className={`h-1.5 rounded-full ${i <= idx ? "bg-smile" : "bg-gypsum"}`} />
          <span className={`text-xs ${i === idx ? "font-semibold text-navy" : i < idx ? "text-ink" : "text-slate"}`}>{ui.statuses[st]}</span>
        </li>
      ))}
    </ol>
  );
}

export function CaseInfo({ c, locale, productName }: { c: PortalCase; locale: Locale; productName?: string }) {
  const ui = PORTAL_UI[locale];
  const rows: [string, string | null][] = [
    [ui.list.patient, c.patient_ref],
    [ui.list.product, productName ?? c.product_slug],
    [ui.list.teeth, c.teeth?.join(", ") || null],
    [ui.form.shade, c.shade],
    [ui.list.due, c.due_date ? formatDate(c.due_date, locale) : null],
    [ui.list.date, formatDate(c.created_at, locale, true)],
    [ui.detail.tracking, c.tracking],
  ];
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      {c.notes && (
        <div className="sm:col-span-2">
          <dt className="text-slate">{ui.form.notes}</dt>
          <dd className="whitespace-pre-wrap">{c.notes}</dd>
        </div>
      )}
    </dl>
  );
}

export function CaseFiles({ files, urls, locale }: { files: CaseFile[]; urls: Record<string, string>; locale: Locale }) {
  const ui = PORTAL_UI[locale];
  if (files.length === 0) return <p className="text-sm text-slate">{ui.detail.noFiles}</p>;
  return (
    <ul className="divide-y divide-gypsum text-sm">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.from_lab ? "bg-navy text-white" : "bg-porcelain text-navy"}`}>{f.from_lab ? ui.detail.lab : ui.detail.you}</span>
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="whitespace-nowrap text-xs text-slate">{formatBytes(f.size)}</span>
          {urls[f.path] && (
            <a href={urls[f.path]} className="font-semibold text-smile-ink hover:underline" download={f.name}>
              {ui.detail.download}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CaseTimeline({ events, locale, viewer }: { events: CaseEvent[]; locale: Locale; viewer: "doctor" | "lab" }) {
  const ui = PORTAL_UI[locale];
  return (
    <ol className="grid gap-3">
      {events.map((e) => {
        const mine = viewer === "lab" ? e.from_lab : !e.from_lab;
        const who = e.from_lab ? ui.detail.lab : viewer === "lab" ? "Hekim" : ui.detail.you;
        if (e.kind === "status")
          return (
            <li key={e.id} className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-smile" aria-hidden="true" />
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.status ? STATUS_CLS[e.status] : ""}`}>{e.status ? ui.statuses[e.status] : ""}</span>
              <span className="text-xs text-slate">{formatDate(e.created_at, locale, true)}</span>
            </li>
          );
        return (
          <li key={e.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${mine ? "bg-navy text-white" : "border border-gypsum bg-white text-ink"}`}>
              <p className={`text-[11px] font-semibold ${mine ? "text-white/70" : "text-slate"}`}>
                {who} · {formatDate(e.created_at, locale, true)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{e.kind === "file" ? `${ui.detail.files}: ${e.body}` : e.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
