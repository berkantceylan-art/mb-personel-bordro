"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { emailDocs, logDocEvent } from "@/lib/billing-actions";

export type DocKind = "waybill" | "statement";
export type DocMarks = { print?: string; email?: string; whatsapp?: string; excel?: string };
const btn = "h-9 px-3 inline-flex items-center gap-1 rounded-[10px] border text-sm font-semibold disabled:opacity-50";
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/** Tek belge: Yazdır · Excel · WhatsApp · E-posta, yapılanların yanında ✓ ve zamanı */
export function DocActions({ kind, id, printHref, waHref, email, marks }: { kind: DocKind; id: string; printHref: string; waHref: string | null; email: string | null; marks: DocMarks }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const tick = (k: keyof DocMarks) => (marks[k] ? <span className="text-ok" title={fmt(marks[k])}>✓</span> : null);
  const tur = kind === "waybill" ? "irsaliye" : "fatura";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={`${btn} border-brand-700 bg-brand-700 text-white`} onClick={() => { void logDocEvent(kind, [id], "print"); window.open(printHref, "_blank"); setTimeout(() => router.refresh(), 800); }}>🖨 Yazdır {tick("print")}</button>
      <a className={`${btn} border-line`} href={`/isler/belge-excel?tur=${tur}&id=${id}`} onClick={() => setTimeout(() => router.refresh(), 1500)}>⬇ Excel {tick("excel")}</a>
      {waHref ? <button type="button" className={`${btn} border-[#25D366] text-[#128C7E]`} onClick={() => { void logDocEvent(kind, [id], "whatsapp"); window.open(waHref, "_blank"); setTimeout(() => router.refresh(), 800); }}>WhatsApp {tick("whatsapp")}</button>
        : <span className="text-xs text-muted px-1" title="Müşteri kartında telefon yok">WhatsApp yok</span>}
      <button type="button" disabled={busy || !email} title={email ?? "Müşteri kartında e-posta yok"} className={`${btn} border-line`} onClick={async () => {
        setBusy(true); setMsg(null);
        const r = await emailDocs(kind, [id]).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }));
        setBusy(false); setMsg({ ok: r.ok, text: r.message }); router.refresh();
      }}>✉ {busy ? "Gönderiliyor…" : "E-posta"} {tick("email")}</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
    </div>
  );
}

/** Toplu: hepsini yazdır · Excel · e-posta */
export function BulkDocActions({ kind, ids, printHref, excelHref }: { kind: DocKind; ids: string[]; printHref: string; excelHref: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const router = useRouter();
  if (!ids.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${btn} border-brand-700 bg-brand-700 text-white h-10 px-4`} onClick={() => { void logDocEvent(kind, ids, "print"); window.open(printHref, "_blank"); setTimeout(() => router.refresh(), 800); }}>🖨 Hepsini yazdır ({ids.length})</button>
        <a className={`${btn} border-line h-10 px-4`} href={excelHref} onClick={() => setTimeout(() => router.refresh(), 1500)}>⬇ Hepsini Excel&apos;e aktar</a>
        <button type="button" disabled={busy} className={`${btn} border-line h-10 px-4`} onClick={async () => {
          if (!confirm(`${ids.length} belge müşterilerin e-posta adreslerine gönderilsin mi?`)) return;
          setBusy(true); setMsg(null);
          const r = await emailDocs(kind, ids).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı", results: [] as { ok: boolean; message: string }[] }));
          setBusy(false); setMsg({ ok: r.ok, text: r.message, list: ("results" in r ? r.results ?? [] : []).filter((x) => !x.ok).map((x) => x.message) }); router.refresh();
        }}>✉ {busy ? "Gönderiliyor…" : "Hepsini e-postayla gönder"}</button>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}{msg.list && msg.list.length > 0 && <ul className="list-disc pl-5 text-xs mt-1 text-bad">{msg.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
    </div>
  );
}

/** Sihirbaz adım çubuğu */
export function WizardSteps({ steps, current, done, onGo }: { steps: string[]; current: number; done: boolean[]; onGo: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Adımlar">
      {steps.map((s, i) => (
        <li key={s}>
          <button type="button" onClick={() => onGo(i)} disabled={i > 0 && !done.slice(0, i).every(Boolean)}
            className={`h-10 px-3 inline-flex items-center gap-2 rounded-full text-sm font-semibold border disabled:opacity-40 ${i === current ? "bg-brand-700 text-white border-brand-700" : done[i] ? "bg-ok-bg text-ok border-ok" : "bg-white text-brand-700 border-line"}`}>
            <span className={`w-6 h-6 grid place-items-center rounded-full text-xs ${i === current ? "bg-white text-brand-700" : done[i] ? "bg-ok text-white" : "bg-[#EEF2F6]"}`}>{done[i] && i !== current ? "✓" : i + 1}</span>{s}
          </button>
        </li>
      ))}
    </ol>
  );
}
