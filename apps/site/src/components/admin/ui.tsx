import Link from "next/link";
import { liveState } from "@/lib/cms";
import { AiTranslateButton } from "./AiButtons";

// Yapay zekâ anahtarı varsa çeviri düğmesi görünür (istemci paketinde bu değer hep boştur)
const AI_ON = typeof process !== "undefined" && !!process.env.ANTHROPIC_API_KEY;
import { LOCALES, LOCALE_NAMES, type I18nText } from "@/lib/i18n";

const STATE: Record<ReturnType<typeof liveState>, { label: string; cls: string }> = {
  live: { label: "Yayında", cls: "bg-ok-bg text-ok" },
  draft: { label: "Taslak", cls: "bg-gypsum text-slate" },
  scheduled: { label: "Zamanlanmış", cls: "bg-warn-bg text-warn" },
  expired: { label: "Süresi doldu", cls: "bg-gypsum text-slate" },
  trash: { label: "Çöpte", cls: "bg-bad-bg text-bad" },
};

export function StateBadge({ row }: { row: Parameters<typeof liveState>[0] }) {
  const s = STATE[liveState(row)];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Flash({ ok, hata }: { ok?: string; hata?: string }) {
  if (hata)
    return (
      <p role="alert" className="mb-6 rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">
        {hata}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="mb-6 rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">
        {ok}
      </p>
    );
  return null;
}

export function PageHead({ title, lead, action }: { title: string; lead?: string; action?: { href: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="display text-3xl font-semibold text-navy">{title}</h1>
        {lead && <p className="mt-1 text-slate">{lead}</p>}
      </div>
      {action && (
        <Link href={action.href} className="rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Aynı alanın TR / EN / FR karşılıkları; Türkçe zorunlu, diğerleri boşsa sitede Türkçesi görünür */
export function I18nField({
  name,
  label,
  value,
  multiline,
  required,
  hint,
  rows = 4,
}: {
  name: string;
  label: string;
  value?: I18nText;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  hint?: string;
}) {
  return (
    <fieldset className="rounded-xl border border-gypsum bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-navy">
        {label}
        {required && <span className="text-bad"> *</span>}
        {AI_ON && <AiTranslateButton name={name} />}
      </legend>
      {hint && <p className="mb-3 text-xs text-slate">{hint}</p>}
      <div className="grid gap-3">
        {LOCALES.map((l) => (
          <label key={l} className="grid gap-1 text-xs text-slate sm:grid-cols-[5.5rem_1fr] sm:items-start sm:gap-3">
            <span className="pt-2">{LOCALE_NAMES[l]}</span>
            {multiline ? (
              <textarea name={`${name}.${l}`} defaultValue={value?.[l] ?? ""} rows={rows} required={required && l === "tr"} lang={l} className="field" />
            ) : (
              <input name={`${name}.${l}`} defaultValue={value?.[l] ?? ""} required={required && l === "tr"} lang={l} className="field" />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** ISO tarihini <input type="datetime-local"> için İstanbul saatine çevirir */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

export function formatTr(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

export function FilterTabs({ base, current, counts }: { base: string; current: string; counts: Record<string, number> }) {
  const tabs: [string, string][] = [
    ["", "Tümü"],
    ["yayinda", "Yayında"],
    ["taslak", "Taslak"],
    ["cop", "Çöp kutusu"],
  ];
  return (
    <nav aria-label="Filtre" className="mb-4 flex flex-wrap gap-2 text-sm">
      {tabs.map(([k, label]) => (
        <Link
          key={k}
          href={k ? `${base}?durum=${k}` : base}
          aria-current={current === k ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 ${current === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
        >
          {label} <span className="num opacity-70">{counts[k] ?? 0}</span>
        </Link>
      ))}
    </nav>
  );
}
