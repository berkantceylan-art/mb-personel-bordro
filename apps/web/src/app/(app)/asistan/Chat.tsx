"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

/** Basit sohbet: geçmiş yalnız tarayıcı belleğinde tutulur, sayfa yenilenince silinir */
export function Chat({ suggestions, name }: { suggestions: string[]; name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/asistan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }) });
      const j = await r.json().catch(() => ({}));
      setMsgs([...next, j.answer ? { role: "assistant", content: j.answer } : { role: "assistant", content: j.error ?? "Bir hata oluştu.", error: true }]);
    } catch { setMsgs([...next, { role: "assistant", content: "Bağlantı hatası. İnternetinizi kontrol edip tekrar deneyin.", error: true }]); }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-3 min-h-[60vh]">
      {msgs.length === 0 && (
        <div className="rounded-[14px] bg-white border border-line p-4 flex flex-col gap-3">
          <p className="text-[15px]">{name ? `Merhaba ${name}, size` : "Merhaba, size"} nasıl yardımcı olabilirim? Bilgileriniz yalnız görme yetkiniz kadarıyla kullanılır.</p>
          <div className="flex flex-wrap gap-2">{suggestions.map((s) => <button key={s} onClick={() => ask(s)} className="text-left text-sm rounded-full border border-[#D5DEE8] bg-[#F7FAFD] px-3 py-2 text-brand-700 font-semibold">{s}</button>)}</div>
        </div>
      )}
      <div className="flex flex-col gap-2.5" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 ${m.role === "user" ? "self-end bg-brand-700 text-white rounded-br-[4px]" : m.error ? "self-start bg-bad-bg text-bad rounded-bl-[4px]" : "self-start bg-white border border-line rounded-bl-[4px]"}`}>{m.content.replace(/\*\*(.+?)\*\*/g, "$1")}</div>
        ))}
        {busy && <div className="self-start rounded-[16px] bg-white border border-line px-3.5 py-2.5 text-sm text-muted">Bakıyorum…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(text); }} className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-4 mt-auto flex gap-2 bg-[#F2F6FA] pt-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Sorunuzu yazın…" aria-label="Soru" className="flex-1 h-12 rounded-[12px] border border-[#D5DEE8] bg-white px-3.5 text-base" />
        <button disabled={busy || !text.trim()} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-semibold disabled:opacity-50">Sor</button>
      </form>
      {msgs.length > 0 && <button onClick={() => setMsgs([])} className="self-center text-xs text-muted underline">Sohbeti temizle</button>}
    </div>
  );
}
