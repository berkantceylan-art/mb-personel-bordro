"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LiveCamera, isTouchDevice } from "@/components/LiveCamera";
import { receiptSave } from "@/lib/invoice-actions";

/** Kağıt / PDF alış faturasını yükle → yapay zekâ okusun → form dolu açılsın */
export function PhotoInvoice({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // bilgisayarda "capture" yok sayılır (dosya penceresi açılır): web kamerası için canlı pencere
  const [desk, setDesk] = useState(false);
  const [cam, setCam] = useState<null | "fatura" | "fis">(null);
  useEffect(() => setDesk(!isTouchDevice()), []);

  async function go(f: File | undefined, fis = false) {
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
    const path = `${userId}/${fis ? "fis" : "alis"}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await createClient().storage.from("receipts").upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (error) { setBusy(null); setErr(`Yüklenemedi: ${error.message}`); return; }
    if (fis) {
      // fiş: okunur ve hemen kaydedilir (cari, alış faturası, nakit ödeme); okunamayan bilgi varsa form açılır
      setBusy("Fiş okunuyor ve kaydediliyor (10-30 sn)…");
      try {
        const res = await receiptSave(path);
        if (res.id) { router.push(`/fatura/${res.id}?${res.ok ? "tamam" : "hata"}=${encodeURIComponent(res.message)}`); return; }
        if (!res.form) { setBusy(null); setErr(res.message); return; }
        setErr(res.message);
      } catch (e) { setErr(`Fiş kaydedilemedi: ${(e as Error).message}`); }
    }
    setBusy(fis ? "Fiş formu açılıyor…" : "Fatura okunuyor (10-20 sn)…");
    router.push(`/alis/yeni?foto=${encodeURIComponent(path)}${fis ? "&fis=1" : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={`h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        📷 {busy ?? "Kağıt faturayı fotoğraftan oku"}
        <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => void go(e.target.files?.[0])} />
      </label>
      <label className={`h-10 px-4 inline-flex items-center rounded-[10px] border border-brand-700 bg-white text-brand-700 text-sm font-semibold cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        🧾 Esnaf / tedarikçi fişi okut
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void go(e.target.files?.[0], true)} />
      </label>
      {desk && (
        <span className="flex gap-2 text-xs font-semibold">
          <button type="button" disabled={!!busy} onClick={() => setCam("fatura")} className="h-10 px-3 rounded-[10px] border border-line bg-white">🎥 Faturayı kamerayla çek</button>
          <button type="button" disabled={!!busy} onClick={() => setCam("fis")} className="h-10 px-3 rounded-[10px] border border-line bg-white">🎥 Fişi kamerayla çek</button>
        </span>
      )}
      <LiveCamera open={!!cam} onClose={() => setCam(null)} onShot={(f) => { const fis = cam === "fis"; setCam(null); void go(f, fis); }} />
      <span className="text-xs text-muted">Tedarikçi, belge no, tarih ve kalemler otomatik dolar; cari yoksa açılır. Fişte ödeme (nakit) de aynı anda girilir. Kaydetmeden önce kontrol edin.</span>
      {err && <span className="text-sm text-bad">{err}</span>}
    </div>
  );
}
