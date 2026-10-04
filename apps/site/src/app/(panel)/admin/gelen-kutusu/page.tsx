import Link from "next/link";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { TOPIC_LABELS, type Message } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Gelen kutusu" };

const TABS: [string, string][] = [
  ["", "Gelen"],
  ["yeni", "Okunmamış"],
  ["arsiv", "Arşiv"],
];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ kutu?: string; konu?: string; ok?: string }> }) {
  const { kutu = "", konu = "", ok } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_messages").select("*").order("created_at", { ascending: false }).limit(500);
  const all = (data ?? []) as Message[];
  const rows = all.filter(
    (m) =>
      (kutu === "arsiv" ? m.status === "archived" : kutu === "yeni" ? m.status === "new" : m.status !== "archived") &&
      (!konu || m.topic === konu),
  );
  const counts: Record<string, number> = {
    "": all.filter((m) => m.status !== "archived").length,
    yeni: all.filter((m) => m.status === "new").length,
    arsiv: all.filter((m) => m.status === "archived").length,
  };

  return (
    <>
      <PageHead title="Gelen kutusu" lead="Sitedeki iletişim ve vaka formlarından gelen mesajlar." />
      <Flash ok={ok} hata={error ? "Gelen kutusu tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Kutu" className="flex flex-wrap gap-2 text-sm">
          {TABS.map(([k, label]) => (
            <Link
              key={k}
              href={k ? `/admin/gelen-kutusu?kutu=${k}` : "/admin/gelen-kutusu"}
              aria-current={kutu === k ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 ${kutu === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
            >
              {label} <span className="num opacity-70">{counts[k]}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Konu" className="flex flex-wrap gap-1.5 text-xs">
          {[["", "Tüm konular"], ...Object.entries(TOPIC_LABELS)].map(([k, label]) => (
            <Link
              key={k}
              href={`/admin/gelen-kutusu?${new URLSearchParams({ ...(kutu ? { kutu } : {}), ...(k ? { konu: k } : {}) })}`}
              aria-current={konu === k ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${konu === k ? "border-navy bg-porcelain text-navy" : "border-gypsum bg-white text-slate hover:text-navy"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">
          {kutu === "arsiv" ? "Arşiv boş." : "Mesaj yok."}
        </div>
      ) : (
        <ul className="divide-y divide-gypsum overflow-hidden rounded-2xl border border-gypsum bg-white">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/admin/gelen-kutusu/${m.id}`} className={`grid gap-1 px-5 py-4 hover:bg-porcelain sm:grid-cols-[12rem_1fr_auto] sm:items-baseline sm:gap-4 ${m.status === "new" ? "bg-white" : "bg-white/60"}`}>
                <span className={`flex min-w-0 items-center gap-2 truncate ${m.status === "new" ? "font-semibold text-ink" : "text-slate"}`}>
                  {m.status === "new" && <span aria-label="okunmamış" className="h-2 w-2 shrink-0 rounded-full bg-smile" />}
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="min-w-0 truncate text-sm">
                  <span className="mr-2 rounded bg-porcelain px-1.5 py-0.5 text-[11px] font-semibold text-navy">{TOPIC_LABELS[m.topic]}</span>
                  {m.company && <span className="mr-2 text-slate">{m.company} ·</span>}
                  <span className={m.status === "new" ? "text-ink" : "text-slate"}>{m.message.slice(0, 140)}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-slate">{formatTr(m.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
