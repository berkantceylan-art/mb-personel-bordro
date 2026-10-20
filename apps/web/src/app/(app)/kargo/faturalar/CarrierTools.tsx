"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCarrierMail, rematchCarrier, uploadCarrierFiles } from "@/lib/carrier-actions";

/** Fatura yükleme, e-postadan çekme, yeniden eşleştirme */
export function CarrierTools({ carrier }: { carrier: "dhl" | "ups" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string; lines?: string[] } | null>(null);
  async function go(k: string, fn: () => Promise<{ ok: boolean; message: string; lines?: string[] }>) {
    setBusy(k); setMsg(null);
    try { setMsg(await fn()); } catch (e) { setMsg({ ok: false, message: String(e) }); }
    setBusy(null); router.refresh();
  }
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); void go("up", () => uploadCarrierFiles(fd)); e.currentTarget.reset(); }}>
        <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-[260px]">Fatura dosyaları
          <input type="file" name="files" multiple accept={carrier === "dhl" ? ".pdf,.csv" : ".pdf,.xlsx,.xls"} className="text-sm font-normal" />
          <span className="text-xs font-normal text-muted">{carrier === "dhl" ? <>DHL fatura PDF&apos;leri · MyDHL+ Gönderi Detay Raporu (CSV)</> : <>UPS fatura PDF&apos;leri · UPS &quot;Fatura Detay&quot; Excel&apos;i (faturadaki &quot;E-Fatura Ayrıntıları&quot; bağlantısından)</>}</span>
        </label>
        <button disabled={!!busy} className="h-11 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy === "up" ? "Okunuyor…" : "Yükle"}</button>
        <button type="button" disabled={!!busy} onClick={() => go("mail", () => fetchCarrierMail(carrier))} className="h-11 px-4 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-50">{busy === "mail" ? "E-postalar taranıyor…" : "E-postadan çek"}</button>
        <button type="button" disabled={!!busy} onClick={() => go("re", rematchCarrier)} className="h-11 px-4 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-50">{busy === "re" ? "…" : "Yeniden eşleştir"}</button>
      </form>
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>
          <p className="font-semibold">{msg.message}</p>
          {msg.lines && msg.lines.length > 0 && <ul className="text-xs text-[#33414F] grid gap-0.5 mt-1">{msg.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
