"use client";
import { useState } from "react";
import { formatTL, parseTL } from "@mb/core";

/** Tutar alanı: yazılan tutarın nasıl okunacağını altında gösterir ("5.000" → ₺5.000,00) */
export function AmountInput({ name = "amount", className, placeholder, required }: { name?: string; className?: string; placeholder?: string; required?: boolean }) {
  const [v, setV] = useState("");
  let hint: { ok: boolean; text: string } | null = null;
  if (v.trim()) {
    try {
      hint = { ok: true, text: `= ${formatTL(parseTL(v))}` };
    } catch {
      hint = { ok: false, text: "Tutar okunamadı · örnek: 5.000 veya 5.000,50" };
    }
  }
  return (
    <>
      <input name={name} required={required} inputMode="decimal" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} className={className} aria-describedby={`${name}-hint`} />
      <span id={`${name}-hint`} aria-live="polite" className={`text-xs min-h-4 ${hint?.ok === false ? "text-bad" : "text-muted"}`}>{hint?.text ?? ""}</span>
    </>
  );
}
