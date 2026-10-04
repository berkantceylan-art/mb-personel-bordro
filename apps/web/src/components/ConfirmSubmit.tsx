"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Geri alınamaz işlemler için gönder düğmesi: önce "Emin misiniz?" sorar; işlem sürerken tekrar basılamaz.
 * Mevcut sunucu eylemli <form> içine konur.
 */
export function ConfirmSubmit({ label, question = "Emin misiniz?", className = "text-xs font-semibold text-bad", yes = "Evet", name, value }: { label: string; question?: string; className?: string; yes?: string; name?: string; value?: string }) {
  const [ask, setAsk] = useState(false);
  const { pending } = useFormStatus();
  if (pending) return <span className="text-xs text-muted">İşleniyor…</span>;
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} className={className}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-ink">{question}</span>
      <button type="submit" name={name} value={value} className="h-8 px-3 rounded-lg bg-bad text-white font-semibold">{yes}</button>
      <button type="button" onClick={() => setAsk(false)} className="h-8 px-3 rounded-lg border border-[#D5DEE8] font-semibold text-muted">Vazgeç</button>
    </span>
  );
}

/** Sıradan sunucu eylemli form düğmesi: işlem sürerken devre dışı (çift tıklama = çift kayıt olmaz) */
export function PendingSubmit({ children, className, name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`${className ?? ""} disabled:opacity-60`}>
      {pending ? "İşleniyor…" : children}
    </button>
  );
}
