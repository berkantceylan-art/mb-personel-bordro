"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ToothPicker } from "@/components/portal/ToothPicker";
import { createCase, registerCaseFiles } from "@/lib/portal-actions";
import { PORTAL_UI } from "@/lib/portal-ui";
import { uploadCaseFile } from "@/lib/portal-upload";
import type { Locale } from "@/lib/i18n";

export function NewCaseForm({ locale, products }: { locale: Locale; products: { slug: string; name: string; group: string }[] }) {
  const ui = PORTAL_UI[locale].form;
  const router = useRouter();
  const [teeth, setTeeth] = useState<number[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const f = new FormData(e.currentTarget);
    setBusy(ui.sending);
    const res = await createCase({
      patient_ref: String(f.get("patient_ref") ?? ""),
      product_slug: String(f.get("product_slug") ?? ""),
      teeth,
      shade: String(f.get("shade") ?? ""),
      due_date: String(f.get("due_date") ?? ""),
      notes: String(f.get("notes") ?? ""),
    });
    if (res.error || !res.id || !res.accountId) {
      setBusy(null);
      setError(ui.errors[res.error ?? "server"]);
      return;
    }
    const uploaded = [];
    for (const file of files) {
      setBusy(`${ui.uploading}: ${file.name}`);
      try {
        uploaded.push(await uploadCaseFile(file, res.accountId, res.id));
      } catch (err) {
        // Vaka açıldı; yüklenemeyen dosya vaka sayfasından yeniden eklenebilir
        setError(`${ui.errors.file} ${(err as Error).message}`);
      }
    }
    if (uploaded.length) await registerCaseFiles(res.id, uploaded);
    router.push(`/portal/vaka/${res.id}`);
  }

  const groups = [...new Set(products.map((p) => p.group))];
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <form onSubmit={onSubmit} className="grid gap-5" aria-busy={!!busy}>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="grid gap-4 rounded-2xl border border-gypsum bg-white p-5 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.patient} *
          <input name="patient_ref" required maxLength={40} autoComplete="off" className="field font-normal" />
          <span className="text-xs font-normal text-slate">{ui.patientHint}</span>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.product}
          <select name="product_slug" defaultValue="" className="field font-normal">
            <option value="">{ui.productNone}</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {products
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.shade}
          <input name="shade" maxLength={40} placeholder="A2, BL3…" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.due}
          <input name="due_date" type="date" min={today} className="field font-normal" />
        </label>
      </div>

      <fieldset className="rounded-2xl border border-gypsum bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-navy">{ui.teeth}</legend>
        <p className="mb-3 text-xs text-slate">{ui.teethHint}</p>
        <ToothPicker value={teeth} onChange={setTeeth} labels={{ upper: ui.upper, lower: ui.lower }} />
        {teeth.length > 0 && <p className="num mt-3 text-sm font-semibold text-navy">{teeth.join(", ")}</p>}
      </fieldset>

      <label className="grid gap-1.5 rounded-2xl border border-gypsum bg-white p-5 text-sm font-semibold text-navy">
        {ui.notes}
        <textarea name="notes" rows={5} maxLength={4000} className="field font-normal" />
      </label>

      <div className="rounded-2xl border border-gypsum bg-white p-5">
        <label className="block text-sm font-semibold text-navy" htmlFor="files">
          {ui.files}
        </label>
        <p className="mb-3 text-xs text-slate">{ui.filesHint}</p>
        <input
          id="files"
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => f.size <= 50 * 1024 * 1024))}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-navy file:px-4 file:py-2 file:text-white"
        />
        {files.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm text-slate">
            {files.map((f) => (
              <li key={f.name}>
                {f.name} <span className="text-xs">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={!!busy} className="rounded-full bg-navy px-7 py-3 font-semibold text-white hover:bg-blue disabled:cursor-wait disabled:opacity-60">
          {busy ? ui.sending : ui.submit}
        </button>
        {busy && <span className="text-sm text-slate">{busy}</span>}
      </div>
    </form>
  );
}
