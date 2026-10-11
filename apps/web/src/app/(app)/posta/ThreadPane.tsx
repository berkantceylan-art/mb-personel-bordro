"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mailAi, mailAiDone, mailCustomers, mailLinkCustomer, mailRemind, mailToLead, mailToOrder, mailUnlink } from "@/lib/mail-actions";
import { ACTION_LABELS, CATEGORY_LABELS, URGENCY, composeFrom, emailOf, fmtSize, messageText, nameOf, type ComposeInit, type Label, type MailAi, type Message, type ThreadView } from "@/lib/mail";

const fmt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const URG_TONE = ["bg-[#EEF2F6] text-muted", "bg-[#EAF2FB] text-brand-700", "bg-[#FFF4E0] text-[#8A5A00]", "bg-red-50 text-red-700"];
const ENTITY: Record<string, string> = { customer: "Cari", lead: "CRM adayı", order: "Sipariş", reminder: "Hatırlatma", job: "İş" };

/** E-posta HTML'i: betik çalışmaz (sandbox), bağlantılar yeni sekmede, yükseklik içeriğe göre */
function MailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const d = f.contentDocument;
      if (!d?.documentElement) return;
      setH(Math.min(20000, Math.max(60, d.documentElement.scrollHeight + 4)));
      if (!ro && "ResizeObserver" in window) { ro = new ResizeObserver(() => setH(Math.min(20000, Math.max(60, d.documentElement.scrollHeight + 4)))); ro.observe(d.documentElement); }
    };
    f.addEventListener("load", fit);
    return () => { f.removeEventListener("load", fit); ro?.disconnect(); };
  }, [html]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'"><base target="_blank"><style>html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b2430;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}a{color:#1d5fa8}</style></head><body>${html}</body></html>`;
  return <iframe ref={ref} srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full border-0" style={{ height: h }} title="E-posta içeriği" />;
}

function Msg({ m, account, me, open, onToggle, onCompose }: { m: Message; account: string; me: string; open: boolean; onToggle: () => void; onCompose: (mode: ComposeInit["mode"]) => void }) {
  const mine = emailOf(m.from) === me;
  const att = (a: Message["attachments"][number], view = false) => `/api/gmail/ek?a=${account}&m=${m.id}&id=${encodeURIComponent(a.id)}&n=${encodeURIComponent(a.name)}&t=${encodeURIComponent(a.mime)}${view ? "&g=1" : ""}`;
  return (
    <article className="border-b border-line last:border-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left md:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EAF2FB] text-sm font-bold text-brand-700">{nameOf(m.from).slice(0, 1).toLocaleUpperCase("tr")}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2"><b className="text-ink">{mine ? "Ben" : nameOf(m.from)}</b><span className="truncate text-xs text-muted">&lt;{emailOf(m.from)}&gt;</span></span>
          {open ? <span className="block truncate text-xs text-muted">Kime: {m.to}{m.cc ? ` · Cc: ${m.cc}` : ""}</span> : <span className="block truncate text-sm text-muted">{messageText(m).slice(0, 160) || "…"}</span>}
        </span>
        <span className="shrink-0 text-xs text-muted">{fmt(m.date)}{m.attachments.length ? " 📎" : ""}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 md:px-6 md:pl-[72px]">
          {m.html ? <MailFrame html={m.html} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink">{m.text}</pre>}
          {!!m.attachments.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-[#F7F9FC] px-3 py-2 text-sm">
                  <span>📎</span>
                  <span className="max-w-[220px] truncate">{a.name}</span>
                  <span className="text-xs text-muted">{fmtSize(a.size)}</span>
                  {/^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i.test(a.mime) && <a href={att(a, true)} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">Görüntüle</a>}
                  <a href={att(a)} className="text-xs font-semibold text-brand-700">İndir</a>
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onCompose("reply")} className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold hover:bg-[#F2F6FB]">↩ Yanıtla</button>
            <button type="button" onClick={() => onCompose("replyAll")} className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold hover:bg-[#F2F6FB]">↩↩ Tümünü yanıtla</button>
            <button type="button" onClick={() => onCompose("forward")} className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold hover:bg-[#F2F6FB]">↪ İlet</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function ThreadPane({ t, account, me, labels, aiEnabled, canOrder, onBack, onAct, onCompose, onToast, onReload }: {
  t: ThreadView; account: string; me: string; labels: Label[]; aiEnabled: boolean; canOrder: boolean;
  onBack: () => void; onAct: (op: string, label?: string) => void; onCompose: (c: ComposeInit) => void; onToast: (m: string, ok?: boolean) => void; onReload: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([t.messages[t.messages.length - 1]?.id ?? "", ...t.messages.filter((m) => m.unread).map((m) => m.id)]));
  const [ai, setAi] = useState<MailAi | null>(t.ai);
  const [busy, setBusy] = useState("");
  const [panel, setPanel] = useState<"" | "cari" | "remind">("");
  const [cq, setCq] = useState("");
  const [cust, setCust] = useState<{ id: string; name: string }[]>([]);
  const [remAt, setRemAt] = useState(() => new Date(Date.now() + 3 * 3600000 + 86400000).toISOString().slice(0, 11) + "09:00");
  const [remTitle, setRemTitle] = useState(t.subject.slice(0, 120));
  const last = t.messages[t.messages.length - 1];
  const lastIn = [...t.messages].reverse().find((m) => emailOf(m.from) !== me) ?? last;
  const starred = t.labels.includes("STARRED");
  const inInbox = t.labels.includes("INBOX");
  const meta = { subject: t.subject, sender: lastIn?.from ?? "" };

  useEffect(() => {
    if (panel !== "cari" || cq.trim().length < 2) { setCust([]); return; }
    const h = setTimeout(async () => setCust(await mailCustomers(cq)), 250);
    return () => clearTimeout(h);
  }, [cq, panel]);

  const doAi = async (force: boolean) => {
    setBusy("ai");
    const r = await mailAi(account, t.id, force);
    setBusy("");
    if (r.ok) setAi(r.data); else onToast(r.message, false);
  };
  const toLead = async () => {
    setBusy("lead");
    const r = await mailToLead(account, t.id);
    setBusy("");
    if (r.ok) { onToast("CRM adayı oluşturuldu."); onReload(); } else onToast(r.message, false);
  };
  const toOrder = async () => {
    setBusy("order");
    const r = await mailToOrder(account, t.id);
    setBusy("");
    if (r && !r.ok) onToast(r.message, false);
  };
  const remind = async (title = remTitle, at = remAt) => {
    setBusy("remind");
    const r = await mailRemind(account, t.id, title, at, `${nameOf(lastIn?.from ?? "")}: ${t.subject}`);
    setBusy("");
    if (r.ok) { setPanel(""); onToast("Hatırlatma kuruldu."); onReload(); } else onToast(r.message, false);
  };
  const linkCust = async (id: string) => {
    const r = await mailLinkCustomer(account, t.id, id, meta);
    if (r.ok) { setPanel(""); setCq(""); onToast("Cariye bağlandı."); onReload(); } else onToast(r.message, false);
  };
  const runAction = (a: MailAi["actions"][number]) => {
    if (a.kind === "order") return toOrder();
    if (a.kind === "lead") return toLead();
    if (a.kind === "reply" && lastIn) return onCompose(composeFrom("reply", lastIn, me, t.id, ai?.reply ?? ""));
    if (a.kind === "reminder" || a.kind === "task") { setRemTitle(a.text.slice(0, 120)); if (a.due) setRemAt(`${a.due}T09:00`); setPanel("remind"); }
  };

  const tb = "rounded-lg px-2.5 py-1.5 text-sm hover:bg-[#F2F6FB] whitespace-nowrap";
  const erp = "rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand-600 disabled:opacity-60 whitespace-nowrap";
  const userLabels = labels.filter((l) => t.labels.includes(l.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5 md:px-4">
        <button type="button" onClick={onBack} className={`${tb} md:hidden`} aria-label="Geri">←</button>
        {inInbox ? <button type="button" onClick={() => onAct("archive")} className={tb} title="Arşivle">🗄 <span className="hidden lg:inline">Arşivle</span></button> : <button type="button" onClick={() => onAct("inbox")} className={tb} title="Gelen kutusuna taşı">📥 <span className="hidden lg:inline">Gelen kutusuna</span></button>}
        <button type="button" onClick={() => onAct("trash")} className={tb} title="Sil">🗑 <span className="hidden lg:inline">Sil</span></button>
        <button type="button" onClick={() => onAct(t.labels.includes("SPAM") ? "notspam" : "spam")} className={tb} title="Spam">⚠️</button>
        <button type="button" onClick={() => onAct("unread")} className={tb} title="Okunmadı yap">✉️ <span className="hidden lg:inline">Okunmadı</span></button>
        <button type="button" onClick={() => onAct(starred ? "unstar" : "star")} className={tb} title="Yıldız">{starred ? "★" : "☆"}</button>
        {!!labels.length && (
          <select value="" onChange={(e) => { if (e.target.value) onAct(t.labels.includes(e.target.value) ? "removeLabel" : "addLabel", e.target.value); }} className="rounded-lg border border-line bg-white px-2 py-1 text-sm" aria-label="Etiket">
            <option value="">🏷 Etiket</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{t.labels.includes(l.id) ? "✓ " : ""}{l.name}</option>)}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-4 md:px-6">
          <h2 className="text-lg font-bold text-ink md:text-xl">{t.subject}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {userLabels.map((l) => <span key={l.id} className="rounded bg-[#EEF2F6] px-2 py-0.5 text-xs text-muted">{l.name}</span>)}
            {t.customer && <Link href={`/isler/cari?q=${encodeURIComponent(t.customer.name)}`} className="rounded bg-[#E7F6EE] px-2 py-0.5 text-xs font-semibold text-[#17663A]">Cari: {t.customer.name}</Link>}
            {t.links.map((l) => (
              <span key={l.id} className="flex items-center gap-1 rounded bg-[#EAF2FB] px-2 py-0.5 text-xs text-brand-700">
                {l.entity === "lead" && l.entity_id ? <Link href={`/crm?aday=${l.entity_id}`}>{ENTITY[l.entity]}: {l.note}</Link> : <span>{ENTITY[l.entity] ?? l.entity}{l.note ? `: ${l.note}` : ""}</span>}
                <button type="button" onClick={async () => { await mailUnlink(l.id); onReload(); }} className="text-muted hover:text-red-600" aria-label="Bağlantıyı kaldır">✕</button>
              </span>
            ))}
          </div>
        </div>

        {/* ERP'ye aktar */}
        <div className="mx-4 mt-3 rounded-2xl border border-line bg-[#F7F9FC] p-3 md:mx-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted">ERP&apos;ye aktar</span>
            {canOrder && <button type="button" disabled={!!busy || !aiEnabled} onClick={toOrder} className={erp} title={aiEnabled ? "Yapay zekâ e-postadan sipariş taslağı çıkarır" : "ANTHROPIC_API_KEY gerekli"}>🦷 {busy === "order" ? "Okunuyor…" : "Sipariş taslağı"}</button>}
            <button type="button" disabled={!!busy} onClick={toLead} className={erp}>🤝 {busy === "lead" ? "…" : "CRM adayı"}</button>
            <button type="button" onClick={() => setPanel(panel === "cari" ? "" : "cari")} className={erp}>📒 Cariye bağla</button>
            <button type="button" onClick={() => setPanel(panel === "remind" ? "" : "remind")} className={erp}>⏰ Hatırlat</button>
          </div>
          {panel === "cari" && (
            <div className="mt-3">
              <input value={cq} onChange={(e) => setCq(e.target.value)} autoFocus placeholder="Hekim / klinik adı ara…" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
              <div className="mt-1 flex flex-col">
                {cust.map((c) => <button key={c.id} type="button" onClick={() => linkCust(c.id)} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-white">{c.name}</button>)}
                {cq.trim().length >= 2 && !cust.length && <span className="px-3 py-2 text-sm text-muted">Sonuç yok.</span>}
              </div>
            </div>
          )}
          {panel === "remind" && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <input value={remTitle} onChange={(e) => setRemTitle(e.target.value)} placeholder="Ne hatırlatılsın?" className="min-w-[200px] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm" />
              <input type="datetime-local" value={remAt} onChange={(e) => setRemAt(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm" />
              <button type="button" disabled={busy === "remind"} onClick={() => remind()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Kur</button>
            </div>
          )}
        </div>

        {/* Yapay zekâ */}
        <div className="mx-4 mt-3 rounded-2xl border border-[#D9CCF5] bg-[#F7F3FF] p-3 md:mx-6">
          {!aiEnabled ? (
            <p className="text-xs text-muted">✨ Yapay zekâ özeti ve yapılacaklar için Vercel&apos;e <b>ANTHROPIC_API_KEY</b> eklenmeli.</p>
          ) : !ai ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[#4B2E83]">✨ Bu konuşmayı yapay zekâ okusun: özet, aciliyet, yapılacaklar ve yanıt taslağı.</span>
              <button type="button" disabled={busy === "ai"} onClick={() => doAi(false)} className="rounded-full bg-[#5B3CC4] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{busy === "ai" ? "Okunuyor…" : "Özetle"}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm text-[#4B2E83]">✨ Yapay zekâ</b>
                {ai.category && <span className="rounded bg-white px-2 py-0.5 text-xs text-[#4B2E83]">{CATEGORY_LABELS[ai.category] ?? ai.category}</span>}
                {ai.urgency != null && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${URG_TONE[ai.urgency] ?? ""}`}>{URGENCY[ai.urgency]}</span>}
                {ai.history !== last?.id && <span className="text-xs text-muted">(yeni ileti var)</span>}
                <span className="flex-1" />
                <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={ai.done} onChange={async (e) => { const d = e.target.checked; setAi({ ...ai, done: d }); await mailAiDone(account, t.id, d); }} /> Tamamlandı</label>
                <button type="button" disabled={busy === "ai"} onClick={() => doAi(true)} className="text-xs font-semibold text-[#5B3CC4]">{busy === "ai" ? "…" : "↻ Yenile"}</button>
              </div>
              {ai.summary && <p className="text-sm text-ink">{ai.summary}</p>}
              {!!ai.actions.length && (
                <ul className="flex flex-col gap-1">
                  {ai.actions.map((a, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#4B2E83]">{ACTION_LABELS[a.kind]}</span>
                      <span className="flex-1">{a.text}{a.due ? <span className="text-muted"> · {a.due.split("-").reverse().join(".")}</span> : null}</span>
                      {(a.kind !== "order" || canOrder) && <button type="button" onClick={() => runAction(a)} className="text-xs font-semibold text-[#5B3CC4]">Yap →</button>}
                    </li>
                  ))}
                </ul>
              )}
              {ai.reply && lastIn && (
                <button type="button" onClick={() => onCompose(composeFrom("reply", lastIn, me, t.id, ai.reply ?? ""))} className="self-start rounded-full border border-[#D9CCF5] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B2E83]">✍️ Önerilen yanıtı aç</button>
              )}
            </div>
          )}
        </div>

        <div className="mt-2">
          {t.messages.map((m) => (
            <Msg key={m.id} m={m} account={account} me={me} open={open.has(m.id)}
              onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
              onCompose={(mode) => onCompose(composeFrom(mode, m, me, t.id))} />
          ))}
        </div>
        <div className="h-24" />
      </div>
    </div>
  );
}
