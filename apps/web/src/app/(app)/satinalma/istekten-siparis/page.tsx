import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { mrNo, qtyFmt } from "@/lib/material";
import { RequestToPO, type RLine } from "./RequestToPO";

export const dynamic = "force-dynamic";
export const metadata = { title: "İstekten sipariş" };

/** Onaylı istek satırlarını tedarikçiye göre gruplayıp tek tıkla taslak satın alma siparişi */
export default async function RequestToOrder() {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.stock ?? 0) < 2) redirect("/satinalma");
  const sb = await createClient();
  const [{ data, error }, { data: parties }] = await Promise.all([
    sb.from("stk_request_lines").select("id, name, qty, issued_qty, unit, vendor, est_price, item_id, request_id, po_id, buy_list_id, to_purchase, stk_requests!inner(id, year, no, kind, status, needed_by, employees(first_name, last_name)), stk_items(supplier_party_id, purchase_price)")
      .eq("to_purchase", true).is("po_id", null).is("buy_list_id", null).in("stk_requests.status", ["approved"]).limit(1000),
    sb.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
  ]);
  type Raw = { id: string; name: string; qty: number; issued_qty: number; unit: string; vendor: string | null; est_price: number | null; item_id: string | null;
    stk_requests: { id: string; year: number; no: number; kind: string; needed_by: string | null; employees: { first_name: string; last_name: string } | null }; stk_items: { supplier_party_id: string | null; purchase_price: number | null } | null };
  const ps = (parties ?? []) as { id: string; name: string }[];
  const byName = new Map(ps.map((p) => [p.name.toLocaleLowerCase("tr"), p.id]));
  const lines: RLine[] = ((data ?? []) as unknown as Raw[]).map((l) => {
    const sup = l.stk_items?.supplier_party_id ?? (l.vendor ? byName.get(l.vendor.toLocaleLowerCase("tr")) ?? null : null);
    return { id: l.id, name: l.name, qty: qtyFmt(Number(l.qty) - Number(l.issued_qty ?? 0)), unit: l.unit, vendor: l.vendor, supplierId: sup, price: l.est_price ?? l.stk_items?.purchase_price ?? null,
      req: mrNo(l.stk_requests), reqId: l.stk_requests.id, who: l.stk_requests.employees ? `${l.stk_requests.employees.first_name} ${l.stk_requests.employees.last_name}` : "", needed: l.stk_requests.needed_by ? formatDate(l.stk_requests.needed_by) : null };
  });

  return (
    <>
      <PageHeader title="İstekten sipariş" subtitle="Satın alma onayı almış istek satırları · tedarikçiye göre gruplanır, seçtikleriniz tek siparişe dönüşür"
        actions={<Link href="/satinalma" className="text-sm font-semibold text-brand-700">← Satın alma</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/po_id|schema cache/.test(error.message) ? "Supabase'de mbdental-satinalma-1.sql çalıştırılmalı." : error.message}</p>}
        <RequestToPO lines={lines} parties={ps} />
      </div>
    </>
  );
}
