"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { iconFor } from "@/lib/desktop-icons";
import { deleteNote, reminderAction, saveNote, saveReminder, saveShortcuts, type Shortcut } from "@/lib/desktop-actions";

export type Note = { id: string; body: string; color: string; pinned: boolean; updated_at: string };
export type Reminder = { id: string; title: string; note: string | null; remind_at: string; repeat: string; link: string | null; notified_at: string | null };
export type Pickable = { group: string; items: { href: string; label: string }[] };
export type Todo = { label: string; href: string; tone: "red" | "amber" | "blue" | "green" };


const EMOJIS = ["⭐", "🦷", "🏭", "📦", "🛒", "🧾", "💰", "📒", "👥", "💵", "🌴", "⏱", "✅", "🤝", "📊", "✔️", "🚚", "📣", "🧮", "✨", "💬", "📅", "⛑", "🔧", "📌", "🔥", "🎯", "📁"];
const NOTE_BG: Record<string, string> = { yellow: "#FFF7C2", blue: "#DCEBFF", green: "#DCF7E3", pink: "#FFE0EC", purple: "#EDE3FF", gray: "#EEF2F6" };
const TONE: Record<Todo["tone"], string> = { red: "bg-[#FDECEC] text-[#B42318] border-[#F7C9C9]", amber: "bg-[#FFF6E5] text-[#8A5A00] border-[#F5D9A8]", blue: "bg-[#EAF2FB] text-brand-700 border-[#CFE0F3]", green: "bg-ok-bg text-ok border-[#BFE8CF]" };
const REPEAT: Record<string, string> = { none: "Bir kez", daily: "Her gün", weekdays: "İş günleri", weekly: "Her hafta", monthly: "Her ay" };
const fmtAt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const localNow = (plusMin = 60) => new Date(Date.now() + 3 * 3600000 + plusMin * 60000).toISOString().slice(0, 16);

/** Kişisel masaüstü: bugün senin için, simgeler, notlar, hatırlatmalar */
export function DesktopClient({ todos, shortcuts: s0, pickable, notes: n0, reminders, needSql }: { todos: Todo[]; shortcuts: Shortcut[]; pickable: Pickable[]; notes: Note[]; reminders: Reminder[]; needSql: boolean }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Masaüstüm">
      {needSql && <p className="rounded-xl bg-warn-bg text-warn p-3 text-sm">Masaüstü (simgeler, notlar, hatırlatmalar) için Supabase&apos;de 20270103000000_desktop.sql çalıştırılmalı.</p>}
      {todos.length > 0 && (
        <div className="rounded-[20px] border border-line bg-white p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-muted">Bugün senin için</h2>
          <div className="flex flex-wrap gap-2">{todos.map((t) => <Link key={t.label} href={t.href} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${TONE[t.tone]}`}>{t.label}</Link>)}</div>
        </div>
      )}
      <Icons initial={s0} pickable={pickable} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Notes initial={n0} />
        <Reminders list={reminders} />
      </div>
    </section>
  );
}

function Icons({ initial, pickable }: { initial: Shortcut[]; pickable: Pickable[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [edit, setEdit] = useState(false);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const has = new Set(list.map((x) => x.href));
  const save = (l: Shortcut[]) => start(async () => { await saveShortcuts(l); router.refresh(); });
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j]!, n[i]!]; setList(n); };
  const filtered = useMemo(() => {
    const k = q.trim().toLocaleLowerCase("tr");
    return pickable.map((g) => ({ ...g, items: g.items.filter((i) => !k || `${g.group} ${i.label}`.toLocaleLowerCase("tr").includes(k)) })).filter((g) => g.items.length);
  }, [q, pickable]);

  return (
    <div className="rounded-[20px] border border-line bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-xs font-bold uppercase tracking-[.12em] text-muted">Masaüstüm</h2>
        {edit ? (
          <>
            <button type="button" onClick={() => setPick((p) => !p)} className="h-8 rounded-full border border-line px-3 text-sm font-semibold">+ Simge ekle</button>
            <button type="button" disabled={pending} onClick={() => { save(list); setEdit(false); setPick(false); }} className="h-8 rounded-full bg-brand-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "…" : "Bitti"}</button>
          </>
        ) : <button type="button" onClick={() => setEdit(true)} className="h-8 rounded-full border border-line px-3 text-sm font-semibold text-muted hover:text-ink">Düzenle</button>}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        {list.map((x, i) => (
          <li key={x.href} className="relative">
            {edit ? (
              <div className="flex h-[92px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[#C5D0DB] bg-[#FAFBFD] p-1 text-center">
                <select aria-label="Simge" value={x.icon} onChange={(e) => setList(list.map((y) => (y.href === x.href ? { ...y, icon: e.target.value } : y)))} className="bg-transparent text-2xl">
                  {EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <input aria-label="Ad" value={x.label} maxLength={40} onChange={(e) => setList(list.map((y) => (y.href === x.href ? { ...y, label: e.target.value } : y)))} className="w-full bg-transparent text-center text-[11px] font-semibold outline-none" />
                <div className="flex gap-1 text-xs">
                  <button type="button" onClick={() => move(i, -1)} aria-label="Sola">◀</button>
                  <button type="button" onClick={() => setList(list.filter((y) => y.href !== x.href))} aria-label="Kaldır" className="text-bad">✕</button>
                  <button type="button" onClick={() => move(i, 1)} aria-label="Sağa">▶</button>
                </div>
              </div>
            ) : (
              <Link href={x.href} className="flex h-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl p-1 text-center transition hover:bg-[#F2F6FA]">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#EAF2FB] to-[#DCEBFF] text-2xl shadow-sm">{x.icon}</span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-ink">{x.label}</span>
              </Link>
            )}
          </li>
        ))}
        {!edit && list.length === 0 && <li className="col-span-full text-sm text-muted">Sık kullandığınız sayfaları buraya ekleyin: <button type="button" onClick={() => { setEdit(true); setPick(true); }} className="font-semibold text-brand-700">simge ekle</button></li>}
      </ul>
      {edit && pick && (
        <div className="mt-3 rounded-2xl border border-line bg-[#FAFBFD] p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sayfa ara…" className="mb-2 h-10 w-full rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" />
          <div className="grid max-h-72 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{g.group}</div>
                {g.items.map((it) => (
                  <label key={it.href} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-white">
                    <input type="checkbox" checked={has.has(it.href)} onChange={(e) => setList(e.target.checked ? [...list, { href: it.href, label: it.label.slice(0, 40), icon: iconFor(it.href) }] : list.filter((y) => y.href !== it.href))} />
                    <span>{iconFor(it.href)} {it.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Notes({ initial }: { initial: Note[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState("yellow");
  const [pending, start] = useTransition();
  const add = () => {
    const body = draft.trim();
    if (!body) return;
    start(async () => {
      const r = await saveNote({ body, color });
      if (r.ok && r.id) { setNotes((n) => [{ id: r.id!, body, color, pinned: false, updated_at: new Date().toISOString() }, ...n]); setDraft(""); router.refresh(); }
    });
  };
  const update = (n: Note, patch: Partial<Note>) => {
    const next = { ...n, ...patch };
    setNotes((l) => l.map((x) => (x.id === n.id ? next : x)));
    start(async () => { await saveNote({ id: n.id, body: next.body, color: next.color, pinned: next.pinned }); });
  };
  const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return (
    <div className="rounded-[20px] border border-line bg-white p-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-muted">Notlarım</h2>
      <div className="flex flex-col gap-2 rounded-2xl p-2" style={{ background: NOTE_BG[color] }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }} rows={2} maxLength={2000} placeholder="Kısa bir not yazın…" className="w-full resize-none bg-transparent text-sm outline-none" />
        <div className="flex items-center gap-1.5">
          {Object.entries(NOTE_BG).map(([k, v]) => <button key={k} type="button" aria-label={k} onClick={() => setColor(k)} className={`h-5 w-5 rounded-full border ${color === k ? "border-ink" : "border-black/10"}`} style={{ background: v }} />)}
          <button type="button" onClick={add} disabled={pending || !draft.trim()} className="ml-auto h-8 rounded-full bg-ink px-4 text-xs font-semibold text-white disabled:opacity-40">Ekle</button>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {sorted.map((n) => (
          <li key={n.id} className="group relative rounded-2xl p-3 shadow-sm" style={{ background: NOTE_BG[n.color] ?? NOTE_BG.yellow }}>
            <textarea defaultValue={n.body} rows={Math.min(8, Math.max(2, n.body.split("\n").length))} maxLength={2000} onBlur={(e) => { const v = e.target.value.trim(); if (v !== n.body) { if (v) update(n, { body: v }); else { setNotes((l) => l.filter((x) => x.id !== n.id)); start(async () => { await deleteNote(n.id); }); } } }}
              className="w-full resize-none bg-transparent text-sm outline-none" aria-label="Not" />
            <div className="flex items-center gap-2 text-xs opacity-60 group-hover:opacity-100">
              <button type="button" onClick={() => update(n, { pinned: !n.pinned })} title="Sabitle">{n.pinned ? "📌" : "📍"}</button>
              <button type="button" onClick={() => { const keys = Object.keys(NOTE_BG); update(n, { color: keys[(keys.indexOf(n.color) + 1) % keys.length]! }); }} title="Renk">🎨</button>
              <span className="ml-auto">{new Date(n.updated_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}</span>
              <button type="button" onClick={() => { setNotes((l) => l.filter((x) => x.id !== n.id)); start(async () => { await deleteNote(n.id); }); }} title="Sil" className="text-bad">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reminders({ list }: { list: Reminder[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [perm, setPerm] = useState<string>("unsupported");
  useEffect(() => { if ("Notification" in window) setPerm(Notification.permission); }, []);
  const { state, pending: saving, formProps } = useActionForm(saveReminder, { onSuccess: () => { setOpen(false); router.refresh(); } });
  const act = (id: string, op: "done" | "delete" | "snooze") => start(async () => { await reminderAction(id, op); router.refresh(); });
  const now = Date.now();
  return (
    <div id="hatirlatma" className="rounded-[20px] border border-line bg-white p-4 scroll-mt-20">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-xs font-bold uppercase tracking-[.12em] text-muted">Hatırlatmalarım</h2>
        <button type="button" onClick={() => setOpen((o) => !o)} className="h-8 rounded-full bg-brand-700 px-3 text-sm font-semibold text-white">{open ? "Kapat" : "+ Hatırlatma"}</button>
      </div>
      {open && (
        <form {...formProps} className="mb-3 flex flex-col gap-2 rounded-2xl bg-[#FAFBFD] p-3">
          <input name="title" required maxLength={160} placeholder="Ne hatırlatılsın? (ör. Dr. Kaya'yı ara)" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" name="at" required defaultValue={localNow()} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm" />
            <select name="repeat" defaultValue="none" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm">{Object.entries(REPEAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <input name="note" maxLength={1000} placeholder="Not (isteğe bağlı)" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" />
          <input name="link" maxLength={300} placeholder="Açılacak sayfa (isteğe bağlı, ör. /isler/123)" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" />
          {state && !state.ok && <p className="text-sm text-bad">{state.message}</p>}
          <button disabled={saving} className="h-10 rounded-[10px] bg-brand-700 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Kaydediliyor…" : "Kur"}</button>
        </form>
      )}
      <ul className="flex flex-col gap-1.5">
        {list.map((r) => {
          const due = Date.parse(r.remind_at) <= now;
          return (
            <li key={r.id} className={`flex items-start gap-2 rounded-xl px-3 py-2 ${due ? "bg-[#FDECEC]" : "bg-[#F8FAFC]"}`}>
              <span className="mt-0.5">{due ? "🔔" : "⏰"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.link ? <Link href={r.link} className="hover:underline">{r.title}</Link> : r.title}</div>
                <div className={`text-xs ${due ? "font-semibold text-[#B42318]" : "text-muted"}`}>{fmtAt(r.remind_at)}{r.repeat !== "none" ? ` · ${REPEAT[r.repeat]}` : ""}{r.note ? ` · ${r.note}` : ""}</div>
              </div>
              <div className="flex shrink-0 gap-1.5 text-xs font-semibold">
                <button type="button" disabled={pending} onClick={() => act(r.id, "done")} className="text-ok" title="Tamam">✓</button>
                {due && <button type="button" disabled={pending} onClick={() => act(r.id, "snooze")} className="text-brand-700" title="10 dk ertele">+10dk</button>}
                <button type="button" disabled={pending} onClick={() => act(r.id, "delete")} className="text-muted hover:text-bad" title="Sil">✕</button>
              </div>
            </li>
          );
        })}
        {list.length === 0 && <li className="text-sm text-muted">Yaklaşan hatırlatma yok.</li>}
      </ul>
      {perm === "default" && (
        <button type="button" onClick={async () => setPerm(await Notification.requestPermission())} className="mt-3 text-xs font-semibold text-brand-700">🔔 Bu tarayıcıda hatırlatma bildirimlerini aç</button>
      )}
    </div>
  );
}
