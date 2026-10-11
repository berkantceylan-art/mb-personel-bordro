"use client";
import { useRef, useState } from "react";
import { mailSend } from "@/lib/mail-actions";
import { MAX_ATTACH, fmtSize, type ComposeInit, type MailAccount } from "@/lib/mail";

const TITLES = { new: "Yeni ileti", reply: "Yanıtla", replyAll: "Tümünü yanıtla", forward: "İlet" };

/** Yazma penceresi: alıcılar, konu, metin, ekler (toplam 10 MB), alıntı ve iletilen ekler */
export function Compose({ init, account, accounts, onClose, onSent }: { init: ComposeInit; account: MailAccount; accounts: MailAccount[]; onClose: () => void; onSent: (msg: string) => void }) {
  const [from, setFrom] = useState(account.id);
  const [to, setTo] = useState(init.to ?? "");
  const [cc, setCc] = useState(init.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(!!init.cc);
  const [subject, setSubject] = useState(init.subject ?? "");
  const [body, setBody] = useState(init.body ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [fwd, setFwd] = useState<Set<string>>(new Set((init.fwdAtts ?? []).map((a) => a.id)));
  const [withQuote, setWithQuote] = useState(true);
  const [sig, setSig] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [min, setMin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fromAcc = accounts.find((a) => a.id === from) ?? account;
  const total = files.reduce((n, f) => n + f.size, 0) + (init.fwdAtts ?? []).filter((a) => fwd.has(a.id)).reduce((n, a) => n + a.size, 0);
  const isReply = init.mode === "reply" || init.mode === "replyAll";

  const send = async () => {
    setErr("");
    if (!to.trim() && !cc.trim() && !bcc.trim()) return setErr("Alıcı yazın.");
    if (total > MAX_ATTACH) return setErr("Ekler toplam 10 MB'ı geçemez.");
    const fd = new FormData();
    fd.set("account", from);
    fd.set("to", to); fd.set("cc", cc); fd.set("bcc", bcc);
    fd.set("subject", subject); fd.set("body", body);
    if (withQuote && init.quote) fd.set("quote", init.quote);
    if (!sig) fd.set("nosig", "1");
    // Yanıt aynı hesaptan gidiyorsa konuşmaya eklenir
    if (isReply && from === account.id) {
      if (init.threadId) fd.set("threadId", init.threadId);
      if (init.inReplyTo) fd.set("inReplyTo", init.inReplyTo);
      if (init.references) fd.set("references", init.references);
    }
    files.forEach((f) => fd.append("files", f));
    if (init.fwdMsg && from === account.id) {
      fd.set("fwd_msg", init.fwdMsg);
      (init.fwdAtts ?? []).filter((a) => fwd.has(a.id)).forEach((a) => fd.append("fwd_att", `${a.id}|${a.size}|${a.mime}|${a.name}`));
    }
    setBusy(true);
    const r = await mailSend(fd);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onSent("İleti gönderildi.");
  };

  const input = "w-full border-0 border-b border-line px-1 py-2 text-sm outline-none focus:border-brand-600 bg-transparent";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-end bg-black/30 md:bg-transparent md:inset-auto md:bottom-0 md:right-6 md:w-[560px]" role="dialog" aria-label={TITLES[init.mode]}>
      <div className={`flex w-full flex-col overflow-hidden bg-white shadow-2xl md:rounded-t-2xl md:border md:border-line ${min ? "" : "h-[100dvh] md:h-[min(640px,85vh)]"}`}>
        <div className="flex items-center gap-2 bg-[#0F2A47] px-4 py-2.5 text-white">
          <b className="flex-1 text-sm">{TITLES[init.mode]}{subject ? ` · ${subject}` : ""}</b>
          <button type="button" onClick={() => setMin((x) => !x)} className="hidden px-1 text-white/80 hover:text-white md:block" aria-label="Küçült">{min ? "▴" : "▾"}</button>
          <button type="button" onClick={onClose} className="px-1 text-white/80 hover:text-white" aria-label="Kapat">✕</button>
        </div>
        {!min && (
          <>
            <div className="flex flex-col px-4 pt-1">
              {accounts.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-muted">Kimden
                  <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} flex-1 text-ink`}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name ? `${a.display_name} <${a.email}>` : a.email}</option>)}
                  </select>
                </label>
              )}
              <div className="flex items-center gap-2">
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Kime" className={input} autoFocus={!to} inputMode="email" />
                {!showCc && <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">Cc / Bcc</button>}
              </div>
              {showCc && <><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc" className={input} /><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Bcc (gizli)" className={input} /></>}
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Konu" className={input} />
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!to} placeholder="İletinizi yazın…" className="min-h-[160px] flex-1 resize-none px-5 py-3 text-sm outline-none" />
            <div className="flex flex-col gap-2 border-t border-line px-4 py-2 text-xs">
              {init.quote && <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={withQuote} onChange={(e) => setWithQuote(e.target.checked)} /> {init.mode === "forward" ? "İletilen iletiyi ekle" : "Önceki iletiyi alıntıla"}</label>}
              {fromAcc.signature && <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={sig} onChange={(e) => setSig(e.target.checked)} /> İmzayı ekle</label>}
              {!!init.fwdAtts?.length && from === account.id && (
                <div className="flex flex-wrap gap-1.5">
                  {init.fwdAtts.map((a) => (
                    <label key={a.id} className={`flex items-center gap-1 rounded-full border px-2 py-1 ${fwd.has(a.id) ? "border-brand-600 bg-[#EAF2FB]" : "border-line"}`}>
                      <input type="checkbox" checked={fwd.has(a.id)} onChange={(e) => setFwd((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />
                      📎 {a.name} <span className="text-muted">{fmtSize(a.size)}</span>
                    </label>
                  ))}
                </div>
              )}
              {!!files.length && (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border border-line bg-[#F7F9FC] px-2 py-1">📎 {f.name} <span className="text-muted">{fmtSize(f.size)}</span>
                      <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-muted hover:text-red-600" aria-label="Eki kaldır">✕</button>
                    </span>
                  ))}
                </div>
              )}
              {total > 0 && <span className={total > MAX_ATTACH ? "font-semibold text-red-600" : "text-muted"}>Ekler: {fmtSize(total)} / 10 MB</span>}
              {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            </div>
            <div className="flex items-center gap-2 border-t border-line px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
              <button type="button" onClick={send} disabled={busy} className="rounded-full bg-brand-700 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">{busy ? "Gönderiliyor…" : "Gönder"}</button>
              <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full px-3 py-2 text-lg hover:bg-[#F2F6FB]" aria-label="Dosya ekle" title="Dosya ekle">📎</button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); setFiles((x) => [...x, ...l].slice(0, 20)); e.target.value = ""; }} />
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-muted hover:bg-[#F2F6FB]" title="Vazgeç">🗑</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
