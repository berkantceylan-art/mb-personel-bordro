import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCategories } from "@/lib/fin-data";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

/** e-Fatura (UBL-TR XML / ZIP) içe aktarma: tedarikçi yoksa açılır, kalemler stok kartlarıyla eşleşir */
export default async function ImportPage() {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.sales ?? 0) < 2) redirect("/alis");
  const supabase = await createClient();
  const [{ data: items }, cats, { data: whs }] = await Promise.all([
    supabase.from("stk_items").select("id, code, name, unit").eq("is_active", true).order("name").limit(5000),
    loadCategories(["expense", "stock"]),
    supabase.from("stk_warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false }).order("name"),
  ]);
  return (
    <>
      <PageHeader title="e-Fatura içe aktar" subtitle="Gelen e-faturaların XML'ini yükleyin: cari, kalemler, KDV ve stok girişi otomatik. Kendi kestiğiniz (portaldan) satış faturaları da aktarılabilir." actions={<Link href="/alis/faturalar" className="text-sm font-semibold text-brand-700">← Alış faturaları</Link>} />
      <div className={page}>
        <ImportClient items={(items ?? []) as { id: string; code: string; name: string; unit: string }[]} categories={cats.filter((c) => c.is_active)} warehouses={(whs ?? []) as { id: string; name: string }[]} />
      </div>
    </>
  );
}
