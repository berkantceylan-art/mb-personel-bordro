"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { removeItemImage, setItemImage } from "@/lib/stock-actions";

/** Resmi tarayıcıda küçültür (en fazla 1400 px, JPEG) */
async function shrink(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), "image/jpeg", 0.86));
  } catch {
    return f;
  }
}

/** Stok kartı resmi: göster, yükle / değiştir, kaldır */
export function ItemImage({ itemId, url, name, canEdit, size = "lg" }: { itemId: string; url: string | null; name: string; canEdit: boolean; size?: "sm" | "lg" }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? url;
  const box = size === "lg" ? "w-full aspect-square max-w-[320px] rounded-[16px]" : "w-full aspect-square rounded-[12px]";

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { setMsg({ ok: false, text: "Yalnız resim dosyası seçin." }); return; }
    if (f.size > 25 * 1024 * 1024) { setMsg({ ok: false, text: "Dosya çok büyük." }); return; }
    setMsg(null);
    start(async () => {
      const blob = await shrink(f);
      setPreview(URL.createObjectURL(blob));
      const path = `${itemId}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.jpg`;
      const { error } = await createClient().storage.from("stock-images").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
      if (error) {
        setPreview(null);
        setMsg({ ok: false, text: /bucket|not found/i.test(error.message) ? "Supabase'de mbdental-stok-hiz-resim.sql çalıştırılmalı." : /row-level|policy|unauthorized/i.test(error.message) ? "Resim yükleme yetkiniz yok (stok düzenleme yetkisi gerekir)." : `Yüklenemedi: ${error.message}` });
        return;
      }
      const r = await setItemImage(itemId, path);
      setMsg({ ok: r.ok, text: r.message });
      if (!r.ok) setPreview(null);
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const r = await removeItemImage(itemId);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setPreview(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" disabled={!canEdit || busy} onClick={() => input.current?.click()}
        className={`${box} relative overflow-hidden border border-line bg-[#F4F7FA] flex items-center justify-center text-muted ${canEdit ? "hover:border-brand-600 cursor-pointer" : "cursor-default"}`}
        title={canEdit ? "Resim yükle / değiştir" : name}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={name} className="absolute inset-0 w-full h-full object-contain bg-white" loading="lazy" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs px-2 text-center">
            <svg width={size === "lg" ? 40 : 26} height={size === "lg" ? 40 : 26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>
            {canEdit ? "Resim ekle" : "Resim yok"}
          </span>
        )}
        {busy && <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs font-semibold text-brand-800">Yükleniyor…</span>}
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
      {canEdit && size === "lg" && (
        <div className="flex gap-3 text-sm">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="font-semibold text-brand-700">{shown ? "Değiştir" : "Resim yükle"}</button>
          {url && <button type="button" disabled={busy} onClick={remove} className="font-semibold text-bad">Kaldır</button>}
        </div>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
