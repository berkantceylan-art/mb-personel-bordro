"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { registerCaseFiles, registerLabFiles } from "@/lib/portal-actions";
import { uploadCaseFile } from "@/lib/portal-upload";

/** Mevcut vakaya dosya ekleme (hekim ya da laboratuvar) */
export function CaseFileAdder({ caseId, accountId, label, lab = false }: { caseId: string; accountId: string; label: string; lab?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(files: File[]) {
    setError(null);
    const done = [];
    for (const f of files) {
      setBusy(f.name);
      try {
        done.push(await uploadCaseFile(f, accountId, caseId));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (done.length) {
      const res = lab ? await registerLabFiles(caseId, accountId, done) : await registerCaseFiles(caseId, done);
      if (res.error) setError(res.error);
    }
    setBusy(null);
    if (ref.current) ref.current.value = "";
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <label className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy ${busy ? "pointer-events-none opacity-60" : ""}`}>
        + {busy ? `${busy}…` : label}
        <input ref={ref} type="file" multiple className="sr-only" disabled={!!busy} onChange={(e) => add(Array.from(e.target.files ?? []))} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
