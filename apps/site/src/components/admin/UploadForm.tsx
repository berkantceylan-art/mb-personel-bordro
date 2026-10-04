"use client";

import { useActionState, useRef, useState, startTransition, type ReactNode } from "react";
import { uploadMedia } from "@/lib/upload-client";

export type FormState = { error?: string };


/**
 * Admin formu: dosyalar tarayıcıdan doğrudan Supabase depolamaya yüklenir,
 * sunucuya yalnız dosya yolu gider (Vercel'in ~4,5 MB istek sınırına takılmaz).
 * Kaydederken buton kilitlenir, hata olursa formun üstünde görünür.
 */
export function UploadForm({
  action,
  folder,
  submitLabel,
  children,
  footer,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  folder: string;
  submitLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [uploading, setUploading] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const busy = pending || uploading !== null;
  const error = clientError ?? state.error;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setClientError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]'));

    try {
      for (const input of inputs) {
        data.delete(input.name);
        for (const file of Array.from(input.files ?? [])) {
          setUploading(file.name);
          const { path } = await uploadMedia(file, folder);
          data.append(`${input.name}__path`, path);
        }
      }
    } catch (err) {
      setUploading(null);
      setClientError((err as Error).message);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setUploading(null);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className="grid max-w-3xl gap-5" aria-busy={busy}>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue disabled:cursor-wait disabled:opacity-60"
        >
          {uploading ? "Dosya yükleniyor…" : pending ? "Kaydediliyor…" : submitLabel}
        </button>
        {footer}
        {uploading && <span className="text-sm text-slate">{uploading}</span>}
      </div>
    </form>
  );
}
