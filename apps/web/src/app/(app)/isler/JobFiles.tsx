"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordJobFile } from "./actions";

async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
}

/** İş fotoğrafı: "Resim çek" (kamera) ve "Resim yükle" (galeri / PDF) */
export function JobFiles({ jobId }: { jobId: string }) {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg(null);
    let n = 0;
    for (const f of Array.from(list).slice(0, 15)) {
      const blob = await shrink(f);
      const name = (blob !== f ? f.name.replace(/\.\w+$/, "") + ".jpg" : f.name).replace(/[^\w.\-]+/g, "_").slice(-80) || "resim.jpg";
      const path = `${jobId}/${crypto.randomUUID()}-${name}`;
      const { error } = await createClient().storage.from("job-files").upload(path, blob, { contentType: blob.type || "application/octet-stream" });
      if (error) {
        setMsg(error.message.includes("Bucket not found") ? "Depo yok: 20261125000000_lab_jobs.sql çalıştırılmalı." : error.message);
        continue;
      }
      const r = await recordJobFile({ jobId, path, name });
      if (r.ok) n++;
      else setMsg(r.message);
    }
    setBusy(false);
    if (n) {
      setMsg(`${n} dosya yüklendi.`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => cam.current?.click()} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">📷 Resim çek</button>
      <button type="button" disabled={busy} onClick={() => pick.current?.click()} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-60">{busy ? "Yükleniyor…" : "Resim yükle"}</button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}
