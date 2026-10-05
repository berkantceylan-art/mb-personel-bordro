import Link from "next/link";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { PORTAL_UI, type PortalAccount } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal hesapları" };

const TABS: [string, string][] = [
  ["", "Onay bekleyen"],
  ["aktif", "Aktif"],
  ["askida", "Askıda"],
  ["fiyat", "Fiyat listesi talepleri"],
];
const MAP: Record<string, PortalAccount["status"]> = { "": "pending", aktif: "active", askida: "suspended" };
const FLAG: Record<string, string> = { tr: "TR", en: "EN", fr: "FR" };

export default async function PortalAccounts({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string }> }) {
  const { durum = "", ok } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("portal_accounts").select("*").order("created_at", { ascending: false });
  const all = (data ?? []) as PortalAccount[];
  const priceReq = (a: PortalAccount) => !!a.price_requested_at && !a.price_access;
  const rows = durum === "fiyat" ? all.filter(priceReq) : all.filter((a) => a.status === (MAP[durum] ?? "pending"));
  const count = (k: string) => (k === "fiyat" ? all.filter(priceReq).length : all.filter((a) => a.status === MAP[k]).length);
  const types = PORTAL_UI.tr.types;

  return (
    <>
      <PageHead title="Portal hesapları" lead="Hekim, klinik ve aracı kuruluş başvuruları. Onaylanan hesaplar vaka gönderebilir." />
      <Flash ok={ok} hata={error ? "Portal tabloları henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined} />
      <nav aria-label="Durum" className="mb-4 flex flex-wrap gap-2 text-sm">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={k ? `/admin/portal?durum=${k}` : "/admin/portal"}
            aria-current={durum === k ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 ${durum === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
          >
            {label} <span className="num opacity-70">{count(k)}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Bu listede hesap yok.</div>
      ) : (
        <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/portal/hesap/${a.id}`} className="grid gap-1 px-5 py-4 hover:bg-porcelain sm:grid-cols-[1fr_auto] sm:items-center">
                <span className="min-w-0">
                  <span className="block font-semibold text-navy">
                    {a.name}
                    {a.company && <span className="font-normal text-slate"> · {a.company}</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate">
                    {types[a.type]} · {a.city ? `${a.city}, ` : ""}
                    {a.country} · {a.email} · Dil {FLAG[a.language]}
                    {a.price_access && " · Fiyat listesi: erişimi var"}
                    {priceReq(a) && " · Fiyat listesi talep etti"}
                  </span>
                </span>
                <span className="text-xs text-slate">{formatTr(a.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
