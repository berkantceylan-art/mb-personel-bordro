import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { BuyListView, type BuyListData } from "../../stok/talepler/alim/BuyList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alım listesi" };

/** Kurye (telefon): kendisine atanan alım listesi; aldıkça işaretler, bitince depoya teslim eder */
export default async function CourierBuyListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_buy_list_get", { p_list: id });
  if (error || !data) notFound();
  const list = data as BuyListData & { courier_user: string | null };
  const canEdit = list.courier_user === s.userId || (s.modules.purchases ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  return (
    <>
      <PageHeader title={`Alım listesi ${list.no}`} subtitle="Aldığınız kalemi işaretleyin, ödediğiniz tutarı yazın; bitince depoya teslim edin." />
      <div className="p-4 md:p-6 max-w-[800px]"><BuyListView list={list} canEdit={canEdit} /></div>
    </>
  );
}
