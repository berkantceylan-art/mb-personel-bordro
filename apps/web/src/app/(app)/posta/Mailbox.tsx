"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mailAccountSave, mailDisconnect, mailList, mailModify, mailThread, mailTriage } from "@/lib/mail-actions";
import { CATEGORY_LABELS, FOLDERS, MAIL_COLORS, type ComposeInit, type Label, type ListAi, type MailAccount, type ThreadRow, type ThreadView } from "@/lib/mail";
import { Compose } from "./Compose";
import { ThreadPane } from "./ThreadPane";

const URG_DOT = ["", "", "bg-[#E8A33D]", "bg-red-600"];
function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const tz = { timeZone: "Europe/Istanbul" } as const;
  const day = (x: Date) => x.toLocaleDateString("tr-TR", tz);
  if (day(d) === day(now)) return d.toLocaleTimeString("tr-TR", { ...tz, hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("tr-TR", { ...tz, day: "numeric", month: "short" });
  return d.toLocaleDateString("tr-TR", { ...tz, day: "2-digit", month: "2-digit", year: "2-digit" });
}

type Props = {
  accounts: MailAccount[]; initial: { account?: string; thread?: string }; flash: { ok: boolean; text: string } | null;
  needSql: boolean; configured: boolean; aiEnabled: boolean; canOrder: boolean;
};

export function Mailbox(p: Props) {
  if (p.needSql) return <Empty icon="🛠" title="Kurulum gerekli" text="Supabase'de 20270104000000_mail.sql çalıştırılmalı." />;
  if (!p.accounts.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        {p.flash && <Flash f={p.flash} />}
        <span className="text-5xl">📬</span>
        <h2 className="text-xl font-bold text-ink">Gmail hesabınızı bağlayın</h2>
        <p className="max-w-md text-sm text-muted">Gmail ve Google Workspace (ör. ad@mbdentaire.com) hesaplarınızı ERP içinden okuyun, yanıtlayın; e-postayı tek tıkla siparişe, CRM adayına ya da hatırlatmaya dönüştürün. Birden fazla hesap bağlayabilirsiniz. Şifreniz bize gelmez; erişimi Google hesabınızdan istediğiniz an geri alabilirsiniz.</p>
        {p.configured ? <a href="/api/gmail/connect" className="rounded-full bg-brand-700 px-6 py-3 font-semibold text-white hover:bg-brand-800">Google ile bağlan</a> : <p className="rounded-lg bg-[#FFF4E0] px-4 py-2 text-sm text-[#8A5A00]">Yönetici: Vercel&apos;de GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET tanımlanmalı.</p>}
      </div>
    );
  }
  return <Box {...p} />;
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"><span className="text-4xl">{icon}</span><b className="text-ink">{title}</b><p className="text-sm text-muted">{text}</p></div>;
}
function Flash({ f }: { f: { ok: boolean; text: string } }) {
  return <p className={`rounded-xl px-4 py-2 text-sm ${f.ok ? "bg-[#E7F6EE] text-[#17663A]" : "bg-red-50 text-red-700"}`}>{f.text}</p>;
}

function Box({ accounts, initial, flash, aiEnabled, canOrder }: Props) {
  const router = useRouter();
  const [acc, setAcc] = useState(accounts.find((a) => a.id === initial.account)?.id ?? accounts[0]!.id);
  const account = accounts.find((a) => a.id === acc) ?? accounts[0]!;
  const [folder, setFolder] = useState("INBOX");
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [aiMap, setAiMap] = useState<Record<string, ListAi>>({});
  const [next, setNext] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(initial.thread ?? null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [tLoading, setTLoading] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(flash);
  const [settings, setSettings] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const reqId = useRef(0);

  const say = useCallback((text: string, ok = true) => setToast({ ok, text }), []);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 4500); return () => clearTimeout(h); }, [toast]);

  const load = useCallback(async (opts: { more?: boolean; silent?: boolean; meta?: boolean } = {}) => {
    const id = ++reqId.current;
    if (!opts.silent && !opts.more) setLoading(true);
    const r = await mailList(acc, { folder, label, q, page: opts.more ? (next ?? undefined) : undefined, meta: opts.meta ?? !opts.more });
    if (id !== reqId.current) return;
    setLoading(false);
    if (!r.ok) { setErr(r.message); if (!opts.more) setRows([]); return; }
    setErr("");
    setRows((x) => (opts.more ? [...x, ...r.data.rows.filter((n) => !x.some((o) => o.id === n.id))] : r.data.rows));
    setAiMap((x) => (opts.more ? { ...x, ...r.data.ai } : r.data.ai));
    setNext(r.data.next);
    if (r.data.labels) setLabels(r.data.labels);
    if (r.data.counts) setCounts(r.data.counts);
  }, [acc, folder, label, q, next]);

  // Klasör / hesap / arama değişince baştan yükle
  useEffect(() => {
    setSel(new Set());
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc, folder, label, q]);
  // Açıkken her dakika sessiz yenile
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === "visible" && !sel.size) void load({ silent: true }); }, 60000);
    return () => clearInterval(h);
  }, [load, sel.size]);

  const openThread = useCallback(async (id: string) => {
    setOpenId(id);
    setTLoading(true);
    const r = await mailThread(acc, id);
    setTLoading(false);
    if (!r.ok) { say(r.message, false); setThread(null); return; }
    setThread(r.data);
    setRows((x) => x.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }, [acc, say]);
  useEffect(() => {
    if (initial.thread) void openThread(initial.thread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (ids: string[], op: string, lbl?: string) => {
    if (!ids.length) return;
    // İyimser güncelleme
    const leaves = ["archive", "trash", "spam", "notspam"].includes(op) || (op === "inbox" && folder !== "INBOX") || (op === "removeLabel" && lbl === label);
    if (leaves) setRows((x) => x.filter((t) => !ids.includes(t.id)));
    else setRows((x) => x.map((t) => (!ids.includes(t.id) ? t : { ...t, unread: op === "unread" ? true : op === "read" ? false : t.unread, starred: op === "star" ? true : op === "unstar" ? false : t.starred })));
    const r = await mailModify(acc, ids, op, lbl);
    if (!r.ok) { say(r.message, false); void load({ silent: true }); return; }
    setSel(new Set());
    const msg: Record<string, string> = { archive: "Arşivlendi.", trash: "Çöp kutusuna taşındı.", spam: "Spam olarak işaretlendi.", notspam: "Gelen kutusuna taşındı.", inbox: "Gelen kutusuna taşındı.", unread: "Okunmadı yapıldı." };
    if (msg[op]) say(ids.length > 1 ? `${ids.length} konuşma: ${msg[op]!.toLocaleLowerCase("tr")}` : msg[op]!);
    if (openId && ids.includes(openId)) {
      if (leaves || op === "unread") { setOpenId(null); setThread(null); }
      else void openThread(openId);
    }
    void load({ silent: true, meta: true });
  };

  const triage = async () => {
    setTriaging(true);
    const r = await mailTriage(acc);
    setTriaging(false);
    if (!r.ok) return say(r.message, false);
    say(r.data ? `${r.data} okunmamış e-posta özetlendi; acil olanlar masaüstünde.` : "Özetlenecek yeni okunmamış e-posta yok.");
    void load({ silent: true });
  };

  const pickFolder = (f: string, l = "") => { setFolder(f); setLabel(l); setQ(""); setQInput(""); setOpenId(null); setThread(null); };
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selIds = [...sel];
  const title = label ? labels.find((l) => l.id === label)?.name ?? "Etiket" : FOLDERS.find((f) => f.id === folder)?.label ?? "";

  return (
    <div className="flex min-h-0 flex-1 md:h-[calc(100dvh-74px)]">
      {/* Kenar çubuğu (masaüstü) */}
      <aside className="hidden w-[230px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-[#F7F9FC] p-3 md:flex">
        <button type="button" onClick={() => setCompose({ mode: "new" })} className="mb-2 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-ink shadow-sm ring-1 ring-line hover:shadow">✏️ Yeni ileti</button>
        <div className="mb-2 flex flex-col gap-0.5">
          {accounts.map((a) => (
            <button key={a.id} type="button" onClick={() => { setAcc(a.id); setOpenId(null); setThread(null); }} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${a.id === acc ? "bg-white font-semibold text-ink ring-1 ring-line" : "text-muted hover:bg-white"}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
              <span className="min-w-0 flex-1 truncate">{a.email}</span>
              {a.status !== "active" && <span title={a.last_error ?? ""}>⚠️</span>}
            </button>
          ))}
          <div className="flex gap-2 px-2 pt-1 text-xs">
            <a href="/api/gmail/connect" className="font-semibold text-brand-700">+ Hesap ekle</a>
            <button type="button" onClick={() => setSettings(true)} className="text-muted hover:text-ink">⚙ Ayarlar</button>
          </div>
        </div>
        {FOLDERS.map((f) => (
          <button key={f.id} type="button" onClick={() => pickFolder(f.id)} className={`flex items-center gap-2 rounded-r-full px-3 py-1.5 text-left text-sm ${folder === f.id && !label ? "bg-[#DCE8F7] font-semibold text-brand-800" : "text-ink hover:bg-[#EDF2F8]"}`}>
            <span className="w-5 text-center">{f.icon}</span><span className="flex-1">{f.label}</span>
            {!!counts[f.id] && <span className="text-xs font-semibold">{counts[f.id]}</span>}
          </button>
        ))}
        {!!labels.length && <span className="mt-3 px-3 text-xs font-bold uppercase tracking-wide text-muted">Etiketler</span>}
        {labels.map((l) => (
          <button key={l.id} type="button" onClick={() => pickFolder("ALL", l.id)} className={`flex items-center gap-2 rounded-r-full px-3 py-1.5 text-left text-sm ${label === l.id ? "bg-[#DCE8F7] font-semibold text-brand-800" : "text-ink hover:bg-[#EDF2F8]"}`}>
            <span className="w-5 text-center">🏷</span><span className="min-w-0 flex-1 truncate">{l.name}</span>
          </button>
        ))}
      </aside>

      {/* Liste */}
      <section className={`min-h-0 w-full flex-col border-r border-line bg-white md:flex md:w-[400px] md:shrink-0 xl:w-[460px] ${openId ? "hidden" : "flex"}`}>
        <div className="flex flex-col gap-2 border-b border-line p-2">
          <div className="flex gap-2 md:hidden">
            <select value={acc} onChange={(e) => { setAcc(e.target.value); setOpenId(null); setThread(null); }} className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-2 text-sm" aria-label="Hesap">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
            <select value={label ? `L:${label}` : folder} onChange={(e) => { const v = e.target.value; if (v.startsWith("L:")) pickFolder("ALL", v.slice(2)); else pickFolder(v); }} className="rounded-lg border border-line bg-white px-2 py-2 text-sm" aria-label="Klasör">
              {FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}{counts[f.id] ? ` (${counts[f.id]})` : ""}</option>)}
              {labels.map((l) => <option key={l.id} value={`L:${l.id}`}>🏷 {l.name}</option>)}
            </select>
            <button type="button" onClick={() => setSettings(true)} className="rounded-lg border border-line px-2 text-sm" aria-label="Ayarlar">⚙</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setOpenId(null); setThread(null); }} className="flex items-center gap-2 rounded-full bg-[#EEF2F6] px-3">
            <span className="text-muted">🔍</span>
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Postalarda ara (ör. from:klinik has:attachment)" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
            {q && <button type="button" onClick={() => { setQ(""); setQInput(""); }} className="text-muted" aria-label="Aramayı temizle">✕</button>}
          </form>
          <div className="flex items-center gap-1 px-1">
            <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Tümünü seç" />
            {sel.size ? (
              <>
                <span className="ml-1 text-xs text-muted">{sel.size} seçili</span>
                <button type="button" onClick={() => act(selIds, folder === "INBOX" ? "archive" : "inbox")} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title={folder === "INBOX" ? "Arşivle" : "Gelen kutusuna"}>{folder === "INBOX" ? "🗄" : "📥"}</button>
                <button type="button" onClick={() => act(selIds, "trash")} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title="Sil">🗑</button>
                <button type="button" onClick={() => act(selIds, "read")} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title="Okundu">📖</button>
                <button type="button" onClick={() => act(selIds, "unread")} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title="Okunmadı">✉️</button>
                <button type="button" onClick={() => act(selIds, "star")} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title="Yıldızla">☆</button>
              </>
            ) : (
              <>
                <b className="ml-1 flex-1 truncate text-sm text-ink">{q ? `“${q}” arama sonuçları` : title}</b>
                {aiEnabled && <button type="button" disabled={triaging} onClick={triage} className="rounded-full bg-[#F1ECFD] px-3 py-1 text-xs font-semibold text-[#4B2E83] disabled:opacity-60" title="Okunmamışları yapay zekâ özetlesin">{triaging ? "Okunuyor…" : "✨ Okunmamışları özetle"}</button>}
                <button type="button" onClick={() => load({ meta: true })} className="rounded px-2 py-1 text-sm hover:bg-[#F2F6FB]" title="Yenile" aria-label="Yenile">↻</button>
              </>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {account.status !== "active" && <p className="m-2 rounded-lg bg-[#FFF4E0] px-3 py-2 text-sm text-[#8A5A00]">Bu hesabın bağlantısı yenilenmeli. <a href={`/api/gmail/connect?email=${encodeURIComponent(account.email)}`} className="font-semibold underline">Yeniden bağlan</a></p>}
          {err && <p className="m-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          {loading && !rows.length ? (
            <div className="flex flex-col">{Array.from({ length: 8 }, (_, i) => <div key={i} className="m-2 h-12 animate-pulse rounded-lg bg-[#F2F5F9]" />)}</div>
          ) : !rows.length && !err ? (
            <Empty icon="📭" title="Burada ileti yok" text={q ? "Aramayı değiştirip tekrar deneyin." : "Yeni e-postalar geldikçe burada görünür."} />
          ) : (
            rows.map((t) => {
              const ai = aiMap[t.id];
              return (
                <div key={t.id} role="button" tabIndex={0} onClick={() => openThread(t.id)} onKeyDown={(e) => { if (e.key === "Enter") void openThread(t.id); }}
                  className={`group flex cursor-pointer items-start gap-2 border-b border-[#EEF1F5] px-2 py-2.5 ${openId === t.id ? "bg-[#E8F0FB]" : t.unread ? "bg-white" : "bg-[#FAFBFD]"} hover:shadow-[inset_3px_0_0_#1d5fa8]`}>
                  <input type="checkbox" checked={sel.has(t.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="mt-1" aria-label="Seç" />
                  <button type="button" onClick={(e) => { e.stopPropagation(); void act([t.id], t.starred ? "unstar" : "star"); }} className={`mt-0.5 text-base leading-none ${t.starred ? "text-[#E8A33D]" : "text-[#C3CBD6] hover:text-muted"}`} aria-label="Yıldız">{t.starred ? "★" : "☆"}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {ai && !ai.done && (ai.urgency ?? 0) >= 2 && <span className={`h-2 w-2 shrink-0 rounded-full ${URG_DOT[ai.urgency ?? 0]}`} title="Yapay zekâ: önemli" />}
                      <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-bold text-ink" : "text-ink/80"}`}>{folder === "SENT" ? "Kime: " : ""}{t.from}{t.count > 1 ? <span className="ml-1 text-xs font-normal text-muted">{t.count}</span> : null}</span>
                      <span className={`shrink-0 text-xs ${t.unread ? "font-bold text-ink" : "text-muted"}`}>{when(t.date)}</span>
                    </div>
                    <div className={`truncate text-sm ${t.unread ? "font-semibold text-ink" : "text-ink/80"}`}>{t.subject}{t.hasAttachment ? " 📎" : ""}</div>
                    <div className="truncate text-xs text-muted">{ai?.summary ? <span className="text-[#5B3CC4]">✨ {ai.summary}</span> : t.snippet}</div>
                    {ai?.category && ai.category !== "other" && <span className="mt-1 inline-block rounded bg-[#F1ECFD] px-1.5 py-0.5 text-[10px] font-semibold text-[#4B2E83]">{CATEGORY_LABELS[ai.category]}</span>}
                  </div>
                  <div className="hidden shrink-0 flex-col gap-1 group-hover:flex">
                    <button type="button" onClick={(e) => { e.stopPropagation(); void act([t.id], folder === "INBOX" ? "archive" : "inbox"); }} className="text-sm" title={folder === "INBOX" ? "Arşivle" : "Gelen kutusuna"}>{folder === "INBOX" ? "🗄" : "📥"}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void act([t.id], "trash"); }} className="text-sm" title="Sil">🗑</button>
                  </div>
                </div>
              );
            })
          )}
          {next && <button type="button" onClick={() => load({ more: true })} className="m-3 w-[calc(100%-24px)] rounded-lg border border-line py-2 text-sm font-semibold text-brand-700 hover:bg-[#F2F6FB]">Daha fazla</button>}
          <div className="h-24 md:h-4" />
        </div>
      </section>

      {/* Okuma bölmesi */}
      <section className={`min-h-0 flex-1 flex-col bg-white ${openId ? "flex" : "hidden md:flex"}`}>
        {tLoading && <div className="h-1 w-full animate-pulse bg-brand-600" />}
        {thread && thread.id === openId ? (
          <ThreadPane key={`${thread.id}-${thread.messages.length}-${thread.links.length}`} t={thread} account={acc} me={account.email} labels={labels} aiEnabled={aiEnabled} canOrder={canOrder}
            onBack={() => { setOpenId(null); setThread(null); }}
            onAct={(op, l) => act([thread.id], op, l)}
            onCompose={setCompose} onToast={say} onReload={() => openThread(thread.id)} />
        ) : openId ? (
          <div className="flex-1 p-6"><div className="h-6 w-2/3 animate-pulse rounded bg-[#F2F5F9]" /><div className="mt-4 h-40 animate-pulse rounded bg-[#F2F5F9]" /></div>
        ) : (
          <Empty icon="✉️" title="Bir konuşma seçin" text="Soldaki listeden bir e-posta açın." />
        )}
      </section>

      {/* Mobil yaz düğmesi */}
      {!openId && !compose && <button type="button" onClick={() => setCompose({ mode: "new" })} className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-40 rounded-2xl bg-brand-700 px-5 py-4 font-semibold text-white shadow-xl md:hidden">✏️ Yaz</button>}

      {compose && <Compose init={compose} account={account} accounts={accounts} onClose={() => setCompose(null)} onSent={(m) => { setCompose(null); say(m); if (openId) void openThread(openId); void load({ silent: true }); }} />}
      {settings && <Settings accounts={accounts} onClose={() => setSettings(false)} onDone={(m) => { setSettings(false); say(m); router.refresh(); }} />}
      {toast && <div className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-[80] -translate-x-1/2 md:bottom-6" role="status"><div className={`rounded-xl px-4 py-2.5 text-sm shadow-xl ${toast.ok ? "bg-[#0F2A47] text-white" : "bg-red-600 text-white"}`}>{toast.text}</div></div>}
    </div>
  );
}

/** Hesap ayarları: görünen ad, renk, imza; bağlantıyı kaldır */
function Settings({ accounts, onClose, onDone }: { accounts: MailAccount[]; onClose: () => void; onDone: (m: string) => void }) {
  const [id, setId] = useState(accounts[0]!.id);
  const a = accounts.find((x) => x.id === id)!;
  const [color, setColor] = useState(a.color);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setColor(a.color); setConfirm(false); }, [a]);
  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/40 p-4" role="dialog" aria-label="Posta ayarları" onClick={onClose}>
      <form key={id} onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("id", id); fd.set("color", color);
        setBusy(true);
        const r = await mailAccountSave(fd);
        setBusy(false);
        if (r.ok) onDone("Ayarlar kaydedildi."); else setErr(r.message);
      }} className="flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center"><b className="flex-1 text-lg text-ink">Posta ayarları</b><button type="button" onClick={onClose} aria-label="Kapat">✕</button></div>
        {accounts.length > 1 && (
          <select value={id} onChange={(e) => setId(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.email}</option>)}
          </select>
        )}
        <label className="flex flex-col gap-1 text-sm text-muted">Gönderen adı
          <input name="display_name" defaultValue={a.display_name ?? ""} placeholder="ör. MB Dental — Ayşe Yılmaz" className="rounded-lg border border-line px-3 py-2 text-ink" />
        </label>
        <div className="flex flex-col gap-1 text-sm text-muted">Renk
          <div className="flex gap-2">{MAIL_COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-offset-2 ring-ink" : ""}`} style={{ background: c }} aria-label={c} />)}</div>
        </div>
        <label className="flex flex-col gap-1 text-sm text-muted">İmza
          <textarea name="signature" defaultValue={a.signature ?? ""} rows={4} placeholder={"Ayşe Yılmaz\nMB Dental Laboratuvarı\n+90 …"} className="rounded-lg border border-line px-3 py-2 text-ink" />
        </label>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">Kaydet</button>
          <span className="flex-1" />
          {confirm ? (
            <>
              <span className="text-xs text-red-700">Bağlantı kaldırılsın mı?</span>
              <button type="button" onClick={async () => { setBusy(true); const r = await mailDisconnect(id); setBusy(false); if (r.ok) onDone("Hesap bağlantısı kaldırıldı."); else setErr(r.message); }} className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Evet, kaldır</button>
              <button type="button" onClick={() => setConfirm(false)} className="text-xs text-muted">Vazgeç</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="text-xs font-semibold text-red-600">Bağlantıyı kaldır</button>
          )}
        </div>
      </form>
    </div>
  );
}
