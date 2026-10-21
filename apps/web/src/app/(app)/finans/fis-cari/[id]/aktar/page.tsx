import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { StmtBook } from "@mb/core";
import { StatementImport } from "./StatementImport";

export const dynamic = "force-dynamic";

/** Tedarikçi cari ekstresi (Excel) → dört cariye aktarım */
export default async function StatementImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) redirect(`/finans/fis-cari/${id}`);
  const supabase = await createClient();
  const { data: p } = await supabase.from("fin_parties").select("id, name, slip_of").eq("id", id).maybeSingle();
  if (!p) notFound();
  if (p.slip_of) redirect(`/finans/fis-cari/${p.slip_of}/aktar`);
  const { data: g, error } = await supabase.rpc("sup_group", { p_party: id });
  const grp = (g ?? {}) as Record<string, { name: string; currency: string } | null>;
  const m = (k: StmtBook) => (grp[k] ? { name: grp[k]!.name, currency: grp[k]!.currency } : null);
  const members: Record<StmtBook, { name: string; currency: string } | null> = { main: m("main"), slip: m("slip"), nodisc: m("nodisc"), vat: m("vat") };
  return (
    <>
      <PageHeader title={`${p.name} · ekstre aktar`} subtitle="Firmanın cari hareket dökümleri (Excel) → faturalı, fişli, iskontosuz fişli ve KDV carisi"
        actions={<Link href={`/finans/fis-cari/${id}`} className="text-sm font-semibold text-brand-700">← Firma</Link>} />
      <div className={`${page} max-w-[1100px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270267000000_supplier_cari_group.sql çalıştırılmalı.</Notice>}
        {!error && (!grp.slip || !grp.nodisc || !grp.vat) && <Notice>Aktarmadan önce <Link href={`/finans/fis-cari/${id}/grup`} className="font-semibold text-brand-700">Grup ayarları</Link>&apos;ndan fişli cariyi (para birimi, iskonto), iskontosuz fişli cariyi ve KDV carisini kurun.</Notice>}
        {!error && <StatementImport main={id} members={members} />}
      </div>
    </>
  );
}
