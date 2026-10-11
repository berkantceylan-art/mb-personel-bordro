import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { buyListCancel } from "@/lib/material-actions";
import { BuyListView, type BuyListData } from "../BuyList";

export const dynamic = "force-dynamic";

/** Alım listesi ayrıntısı (satın alma / depo); yazdırılabilir */
export default async function BuyListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.stock ?? 0) < 1) redirect(`/alim/${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_buy_list_get", { p_list: id });
  if (error || !data) notFound();
  const list = data as BuyListData;
  const canEdit = (s.modules.purchases ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  return (
    <>
      <PageHeader title={`Alım listesi ${list.no}`} subtitle={`Hazırlayan: ${list.created_by}`}
        actions={list.status === "open" && (s.modules.purchases ?? 0) >= 2 ? <form action={buyListCancel}><input type="hidden" name="id" value={id} /><button className="text-sm font-semibold text-bad print:hidden">Listeyi iptal et</button></form> : undefined} />
      <div className={`${page} max-w-[900px]`}>
        <Link href="/stok/talepler/alim" className="text-sm font-semibold text-brand-700 print:hidden">← Alım listeleri</Link>
        <BuyListView list={list} canEdit={canEdit} />
      </div>
    </>
  );
}
