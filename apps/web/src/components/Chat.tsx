"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { markConversationRead, openDepartmentGroup, openDirect, sendMessage } from "@/lib/comms-actions";

type Msg = { id: string; sender_id: string; body: string; created_at: string; pending?: boolean };

export function ChatThread({ conversationId, me, names, isGroup, initial }: { conversationId: string; me: string; names: Record<string, string>; isGroup: boolean; initial: Msg[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setMsgs(initial);
  }, [initial]);

  useEffect(() => {
    markConversationRead(conversationId);
    const supabase = createClient();
    const ch = supabase
      .channel(`conv:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => {
          if (cur.some((x) => x.id === m.id)) return cur;
          const i = cur.findIndex((x) => x.pending && x.sender_id === m.sender_id && x.body === m.body);
          if (i >= 0) return cur.map((x, j) => (j === i ? m : x));
          return [...cur, m];
        });
        if (m.sender_id !== me) markConversationRead(conversationId);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, me]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    setErr(null);
    const temp: Msg = { id: `tmp-${Date.now()}`, sender_id: me, body, created_at: new Date().toISOString(), pending: true };
    setMsgs((c) => [...c, temp]);
    const r = await sendMessage(conversationId, body);
    if (!r.ok) {
      setMsgs((c) => c.filter((x) => x.id !== temp.id));
      setErr(r.message ?? "Gönderilemedi");
      setText(body);
    } else {
      setMsgs((c) => c.map((x) => (x.id === temp.id ? { ...x, pending: false } : x)));
      router.refresh();
    }
  }

  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Msg[] }> = [];
    for (const m of msgs) {
      const day = new Date(m.created_at).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long" });
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [msgs]);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 bg-[#F6F8FA] flex flex-col gap-1.5" aria-live="polite">
        {groups.map((g) => (
          <div key={g.day} className="flex flex-col gap-1.5">
            <div className="self-center text-[11px] text-muted bg-white border border-line rounded-full px-3 py-0.5 my-2">{g.day}</div>
            {g.items.map((m, i) => {
              const mine = m.sender_id === me;
              const showName = isGroup && !mine && g.items[i - 1]?.sender_id !== m.sender_id;
              return (
                <div key={m.id} className={`max-w-[78%] flex flex-col ${mine ? "self-end items-end" : "self-start items-start"}`}>
                  {showName && <span className="text-[11px] font-semibold text-accent-ink px-1">{names[m.sender_id] ?? "Kullanıcı"}</span>}
                  <div className={`rounded-2xl px-3.5 py-2 text-[15px] whitespace-pre-wrap break-words ${mine ? "bg-brand-700 text-white rounded-br-md" : "bg-white border border-line text-ink rounded-bl-md"} ${m.pending ? "opacity-60" : ""}`}>
                    {m.body}
                  </div>
                  <span className="text-[10px] text-muted px-1">{new Date(m.created_at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              );
            })}
          </div>
        ))}
        {msgs.length === 0 && <p className="m-auto text-sm text-muted">İlk mesajı yazın.</p>}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2 p-3 border-t border-line bg-white">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={4000}
          placeholder="Mesaj yazın…"
          aria-label="Mesaj"
          className="flex-1 resize-none rounded-[10px] border border-[#D5DEE8] px-3 py-2.5 bg-white max-h-32"
        />
        <button className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Gönder</button>
      </form>
      {err && <p role="alert" className="text-sm text-bad bg-bad-bg px-3 py-1.5">{err}</p>}
    </>
  );
}

export function NewChat({ people, departments }: { people: Array<{ id: string; name: string; sub: string }>; departments: Array<{ id: string; name: string }> }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const router = useRouter();
  const norm = (s: string) => s.toLocaleLowerCase("tr-TR");
  const hits = q ? people.filter((p) => norm(`${p.name} ${p.sub}`).includes(norm(q))).slice(0, 30) : people.slice(0, 30);
  const go = (fn: () => Promise<string>) => start(async () => { const id = await fn(); setOpen(false); setQ(""); router.push(`/mesajlar/${id}`); router.refresh(); });
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Yeni mesaj: kişi ara…"
        aria-label="Kişi ara"
        className="h-11 w-full rounded-[10px] border border-[#D5DEE8] px-3 bg-white"
      />
      {open && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-[10px] shadow-lg max-h-80 overflow-y-auto">
          {departments.length > 0 && !q && (
            <div className="border-b border-line p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted px-2 pb-1">Bölüm grupları</div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {departments.map((d) => (
                  <button key={d.id} type="button" disabled={busy} onClick={() => go(() => openDepartmentGroup(d.id))} className="text-xs px-2.5 py-1 rounded-full bg-[#EAF2FB] text-brand-700 font-semibold">{d.name}</button>
                ))}
              </div>
            </div>
          )}
          {hits.map((p) => (
            <button key={p.id} type="button" disabled={busy} onClick={() => go(() => openDirect(p.id))} className="w-full text-left px-3 py-2 hover:bg-[#F6F8FA] flex flex-col">
              <span className="font-semibold text-ink text-sm">{p.name}</span>
              {p.sub && <span className="text-xs text-muted">{p.sub}</span>}
            </button>
          ))}
          {hits.length === 0 && <p className="p-3 text-sm text-muted">Kimse bulunamadı. Personelin uygulama hesabı olmalı.</p>}
          <button type="button" onClick={() => setOpen(false)} className="w-full text-center text-xs text-muted py-2 border-t border-line">Kapat</button>
        </div>
      )}
    </div>
  );
}

type Conv = { id: string; title: string; sub: string; at: string; unread: boolean; last?: { body: string; sender_id: string } };

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", ...(today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }) });
};

export function MessagesShell({ me, convs, people, departments, children }: { me: string; convs: Conv[]; people: Array<{ id: string; name: string; sub: string }>; departments: Array<{ id: string; name: string }>; children: React.ReactNode }) {
  const activeId = usePathname().split("/")[2] ?? null;
  const router = useRouter();
  // Başka konuşmalara gelen mesajlarda listeyi tazele
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => router.refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [router]);
  return (
    <div className="bg-white md:border border-line md:rounded-[14px] grid md:grid-cols-[320px_1fr] h-[calc(100dvh-215px-env(safe-area-inset-bottom))] md:h-[calc(100vh-150px)] min-h-[360px] overflow-hidden">
      <aside className={`border-r border-line flex-col min-h-0 ${activeId ? "hidden md:flex" : "flex"}`}>
        <div className="p-3 border-b border-line">
          <NewChat people={people} departments={departments} />
        </div>
        <ul className="overflow-y-auto flex-1">
          {convs.map((c) => {
            const unread = c.unread && c.id !== activeId;
            return (
              <li key={c.id}>
                <Link href={`/mesajlar/${c.id}`} className={`flex flex-col gap-0.5 px-4 py-3 border-b border-[#EEF2F6] ${c.id === activeId ? "bg-[#EAF2FB]" : "hover:bg-[#F6F8FA]"}`}>
                  <span className="flex items-center gap-2">
                    <span className={`flex-1 truncate ${unread ? "font-bold text-ink" : "font-semibold text-brand-800"}`}>{c.title}</span>
                    <span className="text-[11px] text-muted">{fmtWhen(c.at)}</span>
                    {unread && <span className="w-2.5 h-2.5 rounded-full bg-accent" aria-label="okunmamış" />}
                  </span>
                  <span className="text-[13px] text-muted truncate">{c.last ? `${c.last.sender_id === me ? "Siz: " : ""}${c.last.body}` : c.sub || "Henüz mesaj yok"}</span>
                </Link>
              </li>
            );
          })}
          {convs.length === 0 && <li className="p-6 text-sm text-muted text-center">Henüz konuşma yok. Yukarıdan bir kişi seçin.</li>}
        </ul>
      </aside>
      <section className={`min-h-0 flex-col ${activeId ? "flex" : "hidden md:flex"}`}>{children}</section>
    </div>
  );
}
