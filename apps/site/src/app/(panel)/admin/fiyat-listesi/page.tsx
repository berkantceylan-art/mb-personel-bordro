import Link from "next/link";
import { PriceEditor } from "@/components/admin/PriceEditor";
import { Flash, PageHead } from "@/components/admin/ui";
import type { PriceItem } from "@/lib/prices";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Fiyat listesi" };

export default async function PriceListPage() {
  const supabase = await createClient();
  const [{ data, error }, { count: access }, { count: waiting }] = await Promise.all([
    supabase.from("cms_price_items").select("*").order("sort"),
    supabase.from("portal_accounts").select("id", { count: "exact", head: true }).eq("price_access", true),
    supabase.from("portal_accounts").select("id", { count: "exact", head: true }).not("price_requested_at", "is", null).eq("price_access", false),
  ]);
  return (
    <>
      <PageHead
        title="Fiyat listesi"
        lead="Genel fiyat listesi yalnız erişim verdiğiniz portal hesaplarına (aktif hekim, klinik, aracı kuruluş) portalda görünür. Sitede herkese açık değildir."
      />
      <Flash hata={error ? "Fiyat listesi tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined} />
      <p className="mb-5 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white px-3.5 py-1.5 text-slate">
          Erişimi olan hesap: <strong className="text-navy">{access ?? 0}</strong>
        </span>
        <Link href="/admin/portal?durum=fiyat" className={`rounded-full px-3.5 py-1.5 ${waiting ? "bg-smile font-semibold text-navy" : "bg-white text-slate"}`}>
          Bekleyen talep: {waiting ?? 0} →
        </Link>
      </p>
      <PriceEditor initial={(data ?? []) as PriceItem[]} />
    </>
  );
}
