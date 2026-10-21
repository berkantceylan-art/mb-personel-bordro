import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { SlipEntry, type Product } from "./SlipEntry";

export const dynamic = "force-dynamic";

/** Kalemli fiş: firmanın sipariş fişi satır satır girilir; ürün kuralına göre iskontolu / iskontosuz fişli cariye ayrılır, istenirse stoğa girer */
export default async function SlipEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  if (!canEdit) redirect(`/finans/fis-cari/${id}`);
  const supabase = await createClient();
  const { data: p } = await supabase.from("fin_parties").select("id, name, currency, slip_of").eq("id", id).maybeSingle();
  if (!p) notFound();
  if (p.slip_of) redirect(`/finans/fis-cari/${p.slip_of}/fis`);
  const [{ data: g, error }, { data: items }, { data: wh }] = await Promise.all([
    supabase.rpc("sup_group", { p_party: id }),
    supabase.from("sup_item_prices").select("supplier_name, unit, route, price, currency, item_id").eq("party_id", id).eq("is_active", true).order("supplier_name").limit(5000),
    supabase.from("stk_warehouses").select("id, name, is_default").eq("is_active", true).order("is_default", { ascending: false }).order("name"),
  ]);
  const grp = (g ?? {}) as { slip?: { currency: string; discount_pct: number } | null; nodisc?: { currency: string } | null };
  return (
    <>
      <PageHeader title={`${p.name} · kalemli fiş`} subtitle="Sipariş fişindeki kalemler; ürün kuralına göre doğru cariye ayrılır"
        actions={<Link href={`/finans/fis-cari/${id}`} className="text-sm font-semibold text-brand-700">← Firma</Link>} />
      <div className={`${page} max-w-[1200px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270267000000_supplier_cari_group.sql çalıştırılmalı.</Notice>}
        {!error && !grp.slip && <Notice>Bu firmanın fişli carisi yok. Önce <Link href={`/finans/fis-cari/${id}/grup`} className="font-semibold text-brand-700">Grup ayarları</Link>&apos;ndan kurun.</Notice>}
        {!error && grp.slip && (
          <SlipEntry main={id} slipCurrency={grp.slip.currency} discount={Number(grp.slip.discount_pct ?? 0)} hasNodisc={!!grp.nodisc}
            products={(items ?? []) as Product[]} warehouses={(wh ?? []) as { id: string; name: string; is_default: boolean }[]} />
        )}
      </div>
    </>
  );
}
