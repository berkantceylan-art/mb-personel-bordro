"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { translateProductBatch } from "@/lib/product-tr-actions";

/** Türkçe adı eksik tüm ürünleri yapay zekâ ile çevirir (60'arlı partiler) */
export function TranslateAll({ missing }: { missing: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  if (!missing && !msg) return null;
  async function go() {
    setBusy(true); setMsg(null);
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const r = await translateProductBatch().catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }) as const);
      if (!r.ok) { setMsg({ ok: false, text: `${total ? `${total} ürün çevrildi; ` : ""}${r.message ?? "hata"}` }); break; }
      total += r.done ?? 0;
      setMsg({ ok: true, text: `${total} ürün çevrildi${r.left ? ` · ${r.left} kaldı…` : " · tamamlandı"}` });
      if (!r.left || !r.done) break;
    }
    setBusy(false); router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#F2C38B] bg-[#FFF7ED] p-3 text-sm">
      {missing > 0 && <span><b>{missing}</b> ürünün Türkçe adı yok.</span>}
      {missing > 0 && <button type="button" disabled={busy} onClick={go} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-50">{busy ? "Çevriliyor…" : "🇹🇷 Hepsini Türkçeye çevir"}</button>}
      {msg && <span role="status" className={msg.ok ? "text-ok font-semibold" : "text-bad font-semibold"}>{msg.text}</span>}
      <span className="text-xs text-muted w-full">Yeni eklenen ya da adı değişen ürün kaydederken kendiliğinden çevrilir. Çeviri yanlışsa ürüne tıklayıp “Türkçe adı” alanını düzeltin.</span>
    </div>
  );
}
