"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setPortalLogo } from "@/lib/portal-team-actions";

/** Hesap logosu: PNG/JPG/SVG, en fazla 2 MB; portal-files/<hesap>/logo-… */
export function LogoUploader({ accountId, labels, hasLogo }: { accountId: string; labels: { upload: string; remove: string }; hasLogo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024 || !/^image\/(png|jpe?g|svg\+xml|webp)$/.test(f.type)) return setErr("PNG / JPG / SVG · max 2 MB");
    setBusy(true);
    setErr(null);
    const ext = f.type === "image/svg+xml" ? "svg" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    const path = `${accountId}/logo-${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("portal-files").upload(path, f, { contentType: f.type });
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    const r = await setPortalLogo(path);
    setBusy(false);
    if (!r.ok) return setErr("!");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-blue disabled:opacity-60">{busy ? "…" : labels.upload}</button>
      {hasLogo && (
        <button type="button" disabled={busy} onClick={async () => { await setPortalLogo(""); router.refresh(); }} className="rounded-full border border-gypsum px-4 py-2 text-sm font-semibold text-bad">
          {labels.remove}
        </button>
      )}
      {err && <span className="text-sm text-bad">{err}</span>}
    </div>
  );
}
