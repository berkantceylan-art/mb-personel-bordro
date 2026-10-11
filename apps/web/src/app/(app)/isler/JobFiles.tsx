"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordCaseFiles, recordJobFile } from "@/lib/case-actions";

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

const SCAN_ACCEPT = ".stl,.ply,.obj,.3mf,.dcm,.zip,.7z,.pdf,image/*";
const MAX = 100 * 1024 * 1024;
const safeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(-100) || "dosya";

/** İş dosyaları: "Resim çek" (kamera), "Resim yükle", "Tarama / dosya" (STL, PLY, OBJ, ZIP…) */
export function JobFiles({ jobId }: { jobId: string }) {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const scan = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setMsg(null);
    let n = 0;
    for (const f of Array.from(list).slice(0, 20)) {
      if (f.size > MAX) { setMsg(`${f.name}: 100 MB sınırı aşıldı.`); continue; }
      setBusy(f.name);
      const blob = await shrink(f);
      const name = blob !== f ? f.name.replace(/\.\w+$/, "") + ".jpg" : f.name;
      const path = `${jobId}/${crypto.randomUUID()}-${safeName(name)}`;
      const { error } = await createClient().storage.from("job-files").upload(path, blob, { contentType: blob.type || "application/octet-stream" });
      if (error) {
        setMsg(/mime|type/i.test(error.message) ? "Bu dosya türü için Supabase'de 20261221000000_case_files.sql çalıştırılmalı." : error.message);
        continue;
      }
      const r = await recordJobFile({ jobId, path, name, size: blob.size });
      if (r.ok) n++;
      else setMsg(r.message);
    }
    setBusy(null);
    [cam, pick, scan].forEach((r) => r.current && (r.current.value = ""));
    if (n) {
      setMsg(`${n} dosya yüklendi.`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={scan} type="file" accept={SCAN_ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <button type="button" disabled={!!busy} onClick={() => cam.current?.click()} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">📷 Resim çek</button>
      <button type="button" disabled={!!busy} onClick={() => pick.current?.click()} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-60">Resim yükle</button>
      <button type="button" disabled={!!busy} onClick={() => scan.current?.click()} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-60">{busy ? `${busy.slice(0, 24)}…` : "Tarama / dosya (STL, PLY, ZIP)"}</button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}

/** Laboratuvardan hekime dosya gönder (bağlı portal vakasına) */
export function CaseFileSender({ jobId, caseId, accountId }: { jobId: string; caseId: string; accountId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(list: FileList | null) {
    if (!list?.length) return;
    setMsg(null);
    const done: { path: string; name: string; size: number; mime: string }[] = [];
    for (const f of Array.from(list).slice(0, 20)) {
      if (f.size > 50 * 1024 * 1024) { setMsg(`${f.name}: 50 MB sınırı aşıldı.`); continue; }
      setBusy(f.name);
      const path = `${accountId}/${caseId}/${crypto.randomUUID()}-${safeName(f.name.toLowerCase())}`;
      const { error } = await createClient().storage.from("portal-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (error) { setMsg(error.message); continue; }
      done.push({ path, name: f.name, size: f.size, mime: f.type || "application/octet-stream" });
    }
    if (done.length) {
      const r = await recordCaseFiles(jobId, done);
      setMsg(r.message);
    }
    setBusy(null);
    if (ref.current) ref.current.value = "";
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input ref={ref} type="file" multiple hidden onChange={(e) => send(e.target.files)} />
      <button type="button" disabled={!!busy} onClick={() => ref.current?.click()} className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700 disabled:opacity-60">{busy ? `${busy.slice(0, 24)}…` : "Hekime dosya gönder"}</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
