import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { GroupSetup } from "./GroupSetup";
import { ItemRoutes, type ItemRow } from "./ItemRoutes";

export const dynamic = "force-dynamic";

type G = { id: string; name: string; currency: string; balance: number; discount_pct?: number; moves?: number } | null;

/** Firmanın cari grubu: fişli carinin para birimi ve iskontosu, iskontosuz fişli cari, KDV carisi, ürün kuralları */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2;
  const supabase = await createClient();
  const { data: p } = await supabase.from("fin_parties").select("id, name, currency, slip_of").eq("id", id).maybeSingle();
  if (!p) notFound();
  if (p.slip_of) redirect(`/finans/fis-cari/${p.slip_of}/grup`);
  const [{ data: g, error }, { data: items }] = await Promise.all([
    supabase.rpc("sup_group", { p_party: id }),
    supabase.from("sup_item_prices").select("id, supplier_name, unit, route, price, currency, price_date, is_active, item_id, stk_items(code)").eq("party_id", id).order("supplier_name").limit(5000),
  ]);
  const grp = (g ?? {}) as { slip?: G; nodisc?: G; vat?: G };
  return (
    <>
      <PageHeader title={`${p.name} · cari grubu`} subtitle="Faturalı, fişli (iskontolu), iskontosuz fişli ve KDV carisi"
        actions={<Link href={`/finans/fis-cari/${id}`} className="text-sm font-semibold text-brand-700">← Firma</Link>} />
      <div className={`${page} max-w-[1200px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270267000000_supplier_cari_group.sql çalıştırılmalı.</Notice>}
        <Notice tone="info">
          <b>Nasıl çalışır?</b> Banka ödemesi faturalı cariye girilir ve fişli cariye (farklı para birimindeyse ödeme günündeki TCMB döviz satış kuruyla) aynı anda düşer.
          İskontosuz fişli cariye ve KDV carisine ödeme yansımaz; onların ödemesi kendi cari kartından girilir. Faturalı cariye işlenen alış faturasının KDV&apos;si KDV carisine kendiliğinden borç yazılır.
        </Notice>
        {!error && (
          <GroupSetup main={id} mainCurrency={p.currency} canEdit={canEdit}
            slip={grp.slip ?? null} nodisc={grp.nodisc ?? null} vat={grp.vat ?? null} />
        )}
        {!error && (
          <ItemRoutes main={id} canEdit={canEdit} hasNodisc={!!grp.nodisc}
            rows={((items ?? []) as unknown as (ItemRow & { stk_items: { code: string } | null })[]).map((r) => ({ ...r, code: r.stk_items?.code ?? null }))} />
        )}
      </div>
    </>
  );
}
