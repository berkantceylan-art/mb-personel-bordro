"use client";
import { useRef, useState, useTransition } from "react";
import { addJobNote, deleteJobNote, sendCaseMessage } from "@/lib/case-actions";

export type ThreadItem = {
  key: string;
  kind: "note" | "doctor" | "lab" | "status" | "file";
  body: string;
  who: string;
  at: string;
  noteId?: number;
  mine?: boolean;
};

const fmt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** İş konuşması: hekimle portal mesajları + ekibin iç notları tek akışta */
export function JobThread({ jobId, items, portal, waHref }: { jobId: string; items: ThreadItem[]; portal: boolean; waHref: string | null }) {
  const [to, setTo] = useState<"doctor" | "note">(portal ? "doctor" : "note");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  function submit(fd: FormData) {
    setMsg(null);
    start(async () => {
      const r = to === "doctor" ? await sendCaseMessage(fd) : await addJobNote(fd);
      if (r.ok) form.current?.reset();
      else setMsg(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
        {items.map((m) => {
          if (m.kind === "status" || m.kind === "file")
            return (
              <li key={m.key} className="text-xs text-muted flex gap-2 items-center"><span className="h-1.5 w-1.5 rounded-full bg-[#94A3B8]" />{m.kind === "file" ? `📎 ${m.who}: ${m.body}` : m.body} · {fmt(m.at)}</li>
            );
          const tone = m.kind === "note" ? "bg-[#FFF8E6] border-[#F5D9A8]" : m.kind === "lab" ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line";
          return (
            <li key={m.key} className={`flex ${m.kind === "doctor" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-[14px] border px-3 py-2 text-sm ${tone}`}>
                <div className={`text-[11px] font-semibold mb-0.5 ${m.kind === "lab" ? "text-white/75" : "text-muted"}`}>
                  {m.kind === "note" ? "İç not · " : m.kind === "lab" ? "Hekime · " : "Hekim · "}{m.who} · {fmt(m.at)}
                </div>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                {m.kind === "note" && m.mine && m.noteId && (
                  <form action={deleteJobNote} className="text-right"><input type="hidden" name="job_id" value={jobId} /><input type="hidden" name="id" value={m.noteId} /><button className="text-[11px] text-bad font-semibold">Sil</button></form>
                )}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-muted">Henüz mesaj ya da not yok.</li>}
      </ol>
      <form ref={form} action={submit} className="flex flex-col gap-2 border-t border-line pt-3">
        <input type="hidden" name="job_id" value={jobId} />
        <div className="flex flex-wrap gap-1 text-sm font-semibold">
          {portal && <button type="button" onClick={() => setTo("doctor")} className={`h-9 px-3 rounded-[10px] ${to === "doctor" ? "bg-brand-700 text-white" : "border border-line"}`}>Hekime (portal)</button>}
          <button type="button" onClick={() => setTo("note")} className={`h-9 px-3 rounded-[10px] ${to === "note" ? "bg-[#D97706] text-white" : "border border-line"}`}>İç not (hekim görmez)</button>
          {waHref && <a href={waHref} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center rounded-[10px] border border-[#25D366] text-[#128C7E]">WhatsApp</a>}
        </div>
        <textarea name="body" required rows={2} maxLength={4000} placeholder={to === "doctor" ? "Hekime mesaj: renk sorusu, prova notu, onay…" : "Ekip içi not: dikkat edilecekler, aşama bilgisi…"} className="w-full rounded-[12px] border border-line p-3 text-sm" />
        <div className="flex items-center gap-3">
          <button disabled={pending} className="h-10 px-4 rounded-[10px] bg-ink text-white text-sm font-semibold disabled:opacity-60">{pending ? "Gönderiliyor…" : to === "doctor" ? "Hekime gönder" : "Notu kaydet"}</button>
          {msg && <span className="text-sm text-bad">{msg}</span>}
        </div>
      </form>
    </div>
  );
}
