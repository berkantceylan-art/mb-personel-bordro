"use client";
import { createClient } from "@/lib/supabase/client";

/** Fatura / fiş görüntüsünü (gerekirse küçültüp) receipts/<kullanıcı>/ altına yükler */
export async function uploadReceipt(f: File, userId: string | null, prefix = "fatura"): Promise<{ path?: string; mime?: string; size?: number; error?: string }> {
  if (f.size > 10 * 1024 * 1024) return { error: "Dosya 10 MB'tan büyük." };
  let blob: Blob = f;
  if (f.type.startsWith("image/") && f.type !== "image/heic" && f.size > 1_500_000) {
    try {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 2200 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), "image/jpeg", 0.88));
    } catch { blob = f; }
  }
  const mime = blob.type || "image/jpeg";
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/heic" ? "heic" : "jpg";
  const uid = userId || (await createClient().auth.getUser()).data.user?.id;
  if (!uid) return { error: "Oturum bulunamadı." };
  const path = `${uid}/${prefix}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await createClient().storage.from("receipts").upload(path, blob, { contentType: mime });
  if (error) return { error: `Yüklenemedi: ${error.message}` };
  return { path, mime, size: blob.size };
}
