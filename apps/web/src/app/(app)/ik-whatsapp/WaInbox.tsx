"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waReply, waThreadAction } from "@/lib/wa-actions";

export type Thread = { id: string; wa_id: string; name: string | null; employee: string | null; employee_id: string | null; status: string; last_in_at: string | null; last_out_at: string | null; last_text: string | null; unread: number };
export type Msg = { id: string; direction: string; type: string; body: string | null; media_id: string | null; media_mime: string | null; filename: string | null; status: string | null; error: string | null; at: string; by: string | null };
const QUICK = ["Merhaba, mesajınız alındı; en kısa sürede dönüş yapacağız.", "Talebiniz onaylandı.", "Lütfen talebinizi uygulamada Benim sayfam bölümünden iletin.", "Belgeyi aldık, teşekkürler.", "Detay için İK birimine uğrayabilir misiniz?"];
const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const ago = (iso: string | null) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} dk` : m < 1440 ? `${Math.floor(m / 60)} sa` : `${Math.floor(m / 1440)} gün`; };

/** İK WhatsApp gelen kutusu: yanıt bekleyenler görev gibi; yanıtlayınca WhatsApp'tan gider, görev kapanır */
export function WaInbox({ threads, active, messages, employees, canReply, configured }: { threads: Thread[]; active: Thread | null; messages: Msg[]; employees: { id: string; name: string }[]; canReply: boolean; configured: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [close, setClose] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length, active?.id]);
  useEffect(() => { const h = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000); return () => clearInterval(h); }, [router]);
  useEffect(() => { if (active?.unread && canReply) void waThreadAction(active.id, "read"); }, [active?.id, active?.unread, canReply]);
  const windowOpen = active?.last_in_at && Date.now() - new Date(active.last_in_at).getTime() < 24 * 3600 * 1000;

  const send = () => start(async () => {
    if (!active) return;
    const r = await waReply(active.id, text, close);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setText(""); router.refresh(); }
  });

  return (
    <div className="flex min-h-0 flex-1 md:h-[calc(100dvh-150px)]">
      <aside className={`w-full flex-col border-r border-line bg-white md:flex md:w-[360px] ${active ? "hidden" : "flex"}`}>
        <ul className="min-h-0 flex-1 divide-y divide-[#EEF2F6] overflow-y-auto">
          {threads.map((th) => (
            <li key={th.id}>
              <Link href={`/ik-whatsapp?t=${th.id}`} className={`flex items-start gap-3 px-4 py-3 ${active?.id === th.id ? "bg-[#E8F0FB]" : "hover:bg-[#F7F9FC]"}`}>
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full font-bold ${th.status === "open" ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#EEF2F6] text-muted"}`}>{(th.employee ?? th.name ?? "?").slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{th.employee ?? th.name ?? `+${th.wa_id}`}</b><span className="text-xs text-muted">{ago(th.last_in_at)}</span></span>
                  <span className="block truncate text-sm text-muted">{th.last_text}</span>
                  {!th.employee && <span className="text-[11px] text-warn">personel eşleşmedi · +{th.wa_id}</span>}
                </span>
                {th.status === "open" && <span className="mt-1 rounded-full bg-[#16A34A] px-2 py-0.5 text-xs font-bold text-white">{th.unread || "•"}</span>}
              </Link>
            </li>
          ))}
          {!threads.length && <li className="p-6 text-center text-sm text-muted">Mesaj yok.</li>}
        </ul>
      </aside>
      <section className={`min-h-0 flex-1 flex-col bg-[#EFEAE2] ${active ? "flex" : "hidden md:flex"}`}>
        {active ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
              <Link href="/ik-whatsapp" className="md:hidden" aria-label="Geri">←</Link>
              <div className="min-w-0 flex-1"><b>{active.employee ?? active.name ?? `+${active.wa_id}`}</b><span className="block text-xs text-muted">+{active.wa_id}{active.name && active.employee ? ` · ${active.name}` : ""}</span></div>
              {canReply && (
                <select value={active.employee_id ?? ""} onChange={(e) => start(async () => { await waThreadAction(active.id, "employee", e.target.value || null); router.refresh(); })} className="h-9 max-w-[200px] rounded-lg border border-line px-2 text-xs" aria-label="Personel eşleştir">
                  <option value="">Personel eşleştir…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              {active.employee_id && <Link href={`/personel/${active.employee_id}`} className="text-xs font-semibold text-brand-700">Sicil →</Link>}
              {canReply && (active.status === "open"
                ? <button type="button" onClick={() => start(async () => { await waThreadAction(active.id, "close"); router.refresh(); })} className="h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold">✓ Yanıtsız kapat</button>
                : <button type="button" onClick={() => start(async () => { await waThreadAction(active.id, "open"); router.refresh(); })} className="h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold">Yeniden aç</button>)}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-8">
              <div className="flex flex-col gap-1.5">
                {messages.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm ${m.direction === "in" ? "self-start bg-white" : "self-end bg-[#D9FDD3]"}`}>
                    {m.media_id && (m.media_mime?.startsWith("image/")
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a href={`/api/whatsapp/media/${m.media_id}`} target="_blank" rel="noopener"><img src={`/api/whatsapp/media/${m.media_id}`} alt="" className="mb-1 max-h-64 rounded-lg" /></a>
                      : <a href={`/api/whatsapp/media/${m.media_id}`} target="_blank" rel="noopener" className="mb-1 block font-semibold text-brand-700">📎 {m.filename ?? (m.type === "audio" ? "Ses kaydı" : "Dosya")}</a>)}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <span className="mt-0.5 block text-right text-[10px] text-muted">{t(m.at)}{m.direction === "out" ? ` · ${m.by ?? ""} ${m.status === "read" ? "✓✓ okundu" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? "⚠ iletilemedi" : "✓"}` : ""}</span>
                    {m.error && <span className="block text-[10px] text-bad">{m.error}</span>}
                  </div>
                ))}
                <div ref={end} />
              </div>
            </div>
            {canReply ? (
              <div className="flex flex-col gap-2 border-t border-line bg-white p-3">
                {!configured && <p className="text-xs text-bad">WhatsApp bağlantısı kurulmamış; yanıt gönderilemez.</p>}
                {!windowOpen && <p className="text-xs text-warn">Son mesajın üzerinden 24 saat geçti: yanıt onaylı şablonla gönderilir (WHATSAPP_TEMPLATE).</p>}
                <div className="flex flex-wrap gap-1.5">{QUICK.map((q) => <button key={q} type="button" onClick={() => setText(q)} className="rounded-full border border-line px-2.5 py-1 text-xs hover:border-brand-600">{q.slice(0, 32)}…</button>)}</div>
                <div className="flex items-end gap-2">
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Yanıt yazın… (WhatsApp'tan personele gider)" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} className="min-h-12 flex-1 resize-none rounded-xl border border-[#D5DEE8] p-3 text-sm" />
                  <button type="button" disabled={busy || !text.trim()} onClick={send} className="h-12 rounded-xl bg-[#16A34A] px-5 font-bold text-white disabled:opacity-50">{busy ? "…" : "Gönder"}</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />Gönderince görevi kapat</label>
                {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
              </div>
            ) : <p className="border-t border-line bg-white p-3 text-xs text-muted">Yanıt için İK düzenleme yetkisi gerekir.</p>}
          </>
        ) : <div className="grid flex-1 place-items-center text-sm text-muted">Bir konuşma seçin.</div>}
      </section>
    </div>
  );
}
