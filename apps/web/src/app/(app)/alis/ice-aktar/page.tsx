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
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ gelen?: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.sales ?? 0) < 2) redirect("/alis");
  const supabase = await createClient();
  const gelen = (await searchParams).gelen ?? "";
  const ids = gelen.split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 50);
  const { data: pre } = ids.length ? await supabase.from("einv_inbox").select("doc_no, sender_name, xml").in("id", ids).not("xml", "is", null) : { data: [] };
  const [{ data: items }, cats, { data: whs }] = await Promise.all([
    supabase.from("stk_items").select("id, code, name, unit").eq("is_active", true).order("name").limit(5000),
    loadCategories(["expense", "stock"]),
    supabase.from("stk_warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false }).order("name"),
  ]);
  return (
    <>
      <PageHeader title="e-Fatura içe aktar" subtitle="Gelen e-faturaların XML'ini yükleyin: cari, kalemler, KDV ve stok girişi otomatik. Kendi kestiğiniz (portaldan) satış faturaları da aktarılabilir." actions={<span className="flex gap-4"><Link href="/alis/gelen-efatura" className="text-sm font-semibold text-brand-700">Gelen e-belgeler</Link><Link href="/alis/faturalar" className="text-sm font-semibold text-brand-700">← Alış faturaları</Link></span>} />
      <div className={page}>
        <ImportClient items={(items ?? []) as { id: string; code: string; name: string; unit: string }[]} categories={cats.filter((c) => c.is_active)} warehouses={(whs ?? []) as { id: string; name: string }[]} preload={((pre ?? []) as Array<{ doc_no: string | null; sender_name: string | null; xml: string }>).map((x) => ({ file: `Gelen kutusu · ${x.sender_name ?? ""} ${x.doc_no ?? ""}`, xml: x.xml }))} />
      </div>
    </>
  );
}
