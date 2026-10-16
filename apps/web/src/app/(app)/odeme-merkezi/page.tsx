import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { PayCenter } from "@/components/paycenter/PayCenter";
import type { View } from "@/lib/pay-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ödeme merkezi" };

/** Ödeme merkezi: tedarikçi, maaş, avans, vergi / SGK, kredi, kart ve masraf ödemeleri — günlük / haftalık / aylık / acil */
export default async function PaymentCenterPage({ searchParams }: { searchParams: Promise<{ g?: string; t?: string; k?: string }> }) {
  const s = await getSession();
  const pay = canManagePay(s.role) || s.boss;
  const fin = (s.modules.finance ?? 0) >= 1 || (s.modules.purchases ?? 0) >= 1;
  if (!pay && !fin) redirect("/");
  const sp = await searchParams;
  const view: View = (["gun", "hafta", "ay", "acil"] as const).find((v) => v === sp.g) ?? "hafta";
  return (
    <>
      <PageHeader title="Ödeme merkezi" subtitle="Şirketten çıkacak her ödeme tek listede: tedarikçi, maaş, avans, vergi / SGK, kredi, kart, kira ve masraflar"
        actions={<span className="flex flex-wrap gap-4 text-sm font-semibold"><Link href="/satinalma/odeme-takvimi" className="text-brand-700">Tedarikçi takvimi</Link><Link href="/maas-plani" className="text-brand-700">Maaş planı</Link>{s.boss && <Link href="/patron?sekme=odeme" className="text-brand-700">Patron ekranı</Link>}</span>} />
      <div className="p-4 md:p-6 max-w-[1300px]">
        <PayCenter sb={await createClient()} view={view} t={sp.t} k={sp.k} base="/odeme-merkezi" canEdit={(s.modules.finance ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2 || canManagePay(s.role)} canPay={canManagePay(s.role)} />
      </div>
    </>
  );
}
