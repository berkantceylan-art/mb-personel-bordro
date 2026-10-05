import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import type { AdminChat } from "@/lib/chat-admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Canlı destek" };

const LANG: Record<string, string> = { tr: "TR", en: "EN", fr: "FR" };

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ kutu?: string; ok?: string }> }) {
  const { kutu = "", ok } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cms_chats")
    .select("id, name, email, locale, page, status, note, last_message_at, last_visitor_at, staff_read_at, visitor_seen_at, created_at")
    .order("last_message_at", { ascending: false })
    .limit(300);
  const all = (data ?? []) as AdminChat[];
  const ids = all.map((c) => c.id);
  // Her konuşmanın son mesajı (önizleme)
  const last = new Map<string, { body: string; sender: string }>();
  if (ids.length) {
    const { data: msgs } = await supabase.from("cms_chat_messages").select("chat_id, body, sender, id").in("chat_id", ids.slice(0, 100)).order("id", { ascending: false }).limit(600);
    for (const m of (msgs ?? []) as { chat_id: string; body: string; sender: string }[]) if (!last.has(m.chat_id)) last.set(m.chat_id, m);
  }
  const waiting = (c: AdminChat) => c.status === "open" && (!c.staff_read_at || c.last_visitor_at > c.staff_read_at);
  const online = (c: AdminChat) => Date.now() - new Date(c.visitor_seen_at).getTime() < 60_000;
  const rows = all.filter((c) => (kutu === "kapali" ? c.status === "closed" : c.status === "open"));
  const counts = { "": all.filter((c) => c.status === "open").length, kapali: all.filter((c) => c.status === "closed").length };

  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHead title="Canlı destek" lead="Sitedeki destek penceresinden yazan ziyaretçiler. Liste her 10 saniyede kendini yeniler." />
      <Flash ok={ok} hata={error ? "Canlı destek tabloları henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined} />
      <nav aria-label="Kutu" className="mb-4 flex gap-2 text-sm">
        {(
          [
            ["", "Açık"],
            ["kapali", "Kapalı"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={k ? `/admin/canli-destek?kutu=${k}` : "/admin/canli-destek"}
            aria-current={kutu === k ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 ${kutu === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
          >
            {label} <span className="num opacity-70">{counts[k]}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Burada konuşma yok.</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((c) => {
            const l = last.get(c.id);
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/canli-destek/${c.id}`}
                  className={`flex items-center gap-4 rounded-2xl border bg-white px-5 py-4 hover:border-navy ${waiting(c) ? "border-smile ring-1 ring-smile" : "border-gypsum"}`}
                >
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-porcelain font-semibold text-navy">
                    {c.name.slice(0, 1).toLocaleUpperCase("tr")}
                    {online(c) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[#3ddc84] ring-2 ring-white" title="Şu an sitede" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{c.name}</span>
                      {c.locale && <span className="rounded bg-porcelain px-1.5 text-[11px] font-semibold text-slate">{LANG[c.locale]}</span>}
                      {waiting(c) && <span className="rounded-full bg-smile px-2 text-[11px] font-bold text-navy">Cevap bekliyor</span>}
                    </span>
                    {l && (
                      <span className="mt-0.5 block truncate text-sm text-slate">
                        {l.sender === "staff" ? "Siz: " : ""}
                        {l.body}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate">{formatTr(c.last_message_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
