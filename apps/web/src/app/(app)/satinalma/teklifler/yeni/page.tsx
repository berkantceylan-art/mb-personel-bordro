import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { RfqForm } from "./RfqForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Yeni teklif isteği" };

/** Yeni teklif isteği: ?satir= ile onaylı istek satırları hazır gelir */
export default async function NewRfq({ searchParams }: { searchParams: Promise<{ satir?: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.stock ?? 0) < 2) redirect("/satinalma/teklifler");
  const sp = await searchParams;
  const ids = (sp.satir ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  const sb = await createClient();
  const [{ data: parties }, { data: items }, { data: rl }, { data: scores }] = await Promise.all([
    sb.from("fin_parties").select("id, name, email, order_email, phone").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
    sb.from("stk_items").select("id, code, name, unit").eq("is_active", true).order("name").limit(5000),
    ids.length ? sb.from("stk_request_lines").select("id, name, qty, issued_qty, unit, item_id").in("id", ids) : Promise.resolve({ data: [] }),
    sb.rpc("pur_supplier_scores"),
  ]);
  const sc = new Map(((scores ?? []) as { party_id: string; score: number }[]).map((x) => [x.party_id, x.score]));
  const initial = ((rl ?? []) as { id: string; name: string; qty: number; issued_qty: number; unit: string; item_id: string | null }[]).map((l) => ({ name: l.name, qty: String(Number(l.qty) - Number(l.issued_qty ?? 0)), unit: l.unit, item_id: l.item_id ?? "", req: l.id }));
  return (
    <>
      <PageHeader title="Yeni teklif isteği" subtitle="Kalemleri yazın, teklif istenecek tedarikçileri seçin; her tedarikçiye kendi teklif bağlantısı oluşur" actions={<Link href="/satinalma/teklifler" className="text-sm font-semibold text-brand-700">← Teklifler</Link>} />
      <div className="p-4 md:p-6 max-w-[1100px]">
        <RfqForm initial={initial} items={(items ?? []) as { id: string; code: string; name: string; unit: string }[]}
          parties={((parties ?? []) as { id: string; name: string; email: string | null; order_email: string | null; phone: string | null }[]).map((p) => ({ id: p.id, name: p.name, contact: !!(p.order_email || p.email || p.phone), score: sc.get(p.id) ?? null }))} />
      </div>
    </>
  );
}
