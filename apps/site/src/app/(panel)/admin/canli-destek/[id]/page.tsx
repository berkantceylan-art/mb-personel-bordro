import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatThread } from "@/components/admin/ChatThread";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Flash, formatTr } from "@/components/admin/ui";
import { adminChatThread, chatToInbox, deleteChat, saveChatNote, setChatStatus } from "@/lib/chat-admin";

export const metadata = { title: "Canlı destek" };

const LANG: Record<string, string> = { tr: "Türkçe", en: "İngilizce", fr: "Fransızca" };
const btn = "rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy";

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { id } = await params;
  const { ok, hata } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const snap = await adminChatThread(id, 0);
  const c = snap.chat;
  if (!c) notFound();

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/admin/canli-destek" className="text-sm font-semibold text-slate hover:text-navy">
          ← Canlı destek
        </Link>
        <h1 className="display mr-auto text-2xl font-semibold text-navy">{c.name}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${c.status === "open" ? "bg-smile/20 text-navy" : "bg-gypsum text-slate"}`}>
          {c.status === "open" ? "Açık" : "Kapalı"}
        </span>
      </div>
      <Flash ok={ok} hata={hata} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ChatThread id={c.id} initial={snap.messages} visitorName={c.name} locale={c.locale ?? "tr"} />
        <aside className="grid content-start gap-4">
          <dl className="grid gap-3 rounded-2xl border border-gypsum bg-white p-5 text-sm">
            <div>
              <dt className="text-xs text-slate">E-posta</dt>
              <dd className="font-semibold text-ink">{c.email ? <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Dil</dt>
              <dd className="text-ink">{c.locale ? LANG[c.locale] : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Başladığı sayfa</dt>
              <dd className="break-all text-ink">{c.page ? <a href={c.page} target="_blank" rel="noreferrer" className="hover:underline">{c.page}</a> : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Başlangıç</dt>
              <dd className="text-ink">{formatTr(c.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">Ziyaretçi en son</dt>
              <dd className="text-ink">{formatTr(c.visitor_seen_at)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <form action={setChatStatus}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="status" value={c.status === "open" ? "closed" : "open"} />
              <button type="submit" className={btn}>
                {c.status === "open" ? "Konuşmayı kapat" : "Yeniden aç"}
              </button>
            </form>
            {c.email && (
              <form action={chatToInbox}>
                <input type="hidden" name="id" value={c.id} />
                <button type="submit" className={btn}>
                  Gelen kutusuna aktar
                </button>
              </form>
            )}
            <form action={deleteChat}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton message="Bu konuşma kalıcı olarak silinsin mi?" className="rounded-full px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-bg">
                Sil
              </ConfirmButton>
            </form>
          </div>
          <form action={saveChatNote} className="grid gap-2 rounded-2xl border border-gypsum bg-white p-5">
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="note" className="text-sm font-semibold text-navy">
              İç not
            </label>
            <textarea id="note" name="note" defaultValue={c.note ?? ""} rows={3} maxLength={2000} placeholder="Yalnız ekip görür." className="field" />
            <button type="submit" className={`${btn} justify-self-start`}>
              Notu kaydet
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
