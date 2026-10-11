"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Kağıt / PDF alış faturasını yükle → yapay zekâ okusun → form dolu açılsın */
export function PhotoInvoice({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(f: File | undefined) {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { setErr("Dosya 8 MB'tan büyük."); return; }
    setErr(null); setBusy("Yükleniyor…");
    let blob: Blob = f;
    if (f.type.startsWith("image/") && f.size > 1_500_000) {
      try {
        const img = await createImageBitmap(f);
        const k = Math.min(1, 2200 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), "image/jpeg", 0.88));
      } catch { blob = f; }
    }
    const ext = blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg";
    const path = `${userId}/alis-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await createClient().storage.from("receipts").upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (error) { setBusy(null); setErr(`Yüklenemedi: ${error.message}`); return; }
    setBusy("Fatura okunuyor (10-20 sn)…");
    router.push(`/alis/yeni?foto=${encodeURIComponent(path)}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={`h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        📷 {busy ?? "Kağıt faturayı fotoğraftan oku"}
        <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => void go(e.target.files?.[0])} />
      </label>
      <span className="text-xs text-muted">Tedarikçi, fatura no, tarih ve kalemler otomatik dolar; kaydetmeden önce kontrol edin.</span>
      {err && <span className="text-sm text-bad">{err}</span>}
    </div>
  );
}
