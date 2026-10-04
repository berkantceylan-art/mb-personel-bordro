"use client";

import { createClient } from "./supabase/client";
import type { UploadedCaseFile } from "./portal-actions";

export const PORTAL_MAX_BYTES = 50 * 1024 * 1024;

/** Vaka dosyasını tarayıcıdan doğrudan gizli depoya yükler */
export async function uploadCaseFile(file: File, accountId: string, caseId: string): Promise<UploadedCaseFile> {
  if (file.size > PORTAL_MAX_BYTES) throw new Error(`${file.name}: > 50 MB`);
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-120) || "dosya";
  const path = `${accountId}/${caseId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await createClient()
    .storage.from("portal-files")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return { path, name: file.name.slice(0, 200), size: file.size, mime: file.type || "application/octet-stream" };
}
