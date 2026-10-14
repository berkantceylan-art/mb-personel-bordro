import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { VoucherEditor } from "../VoucherEditor";

export const dynamic = "force-dynamic";

export default async function NewVoucher() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 2) redirect("/muhasebe");
  const supabase = await createClient();
  const { data } = await supabase.from("gl_accounts").select("code, name").eq("postable", true).eq("is_active", true).order("code").limit(5000);
  return (
    <>
      <PageHeader title="Elle muhasebe fişi" subtitle="Mahsup, tahsil, tediye, açılış ya da kapanış fişi; kayıt en alt hesaplara yapılır" actions={<Link href="/muhasebe/fisler" className="text-sm font-semibold text-brand-700">Fişler</Link>} />
      <div className={page}><VoucherEditor accounts={(data ?? []) as Array<{ code: string; name: string }>} /></div>
    </>
  );
}
