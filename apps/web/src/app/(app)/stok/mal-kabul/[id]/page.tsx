import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { RCV_STATUS, rcvNo } from "@/lib/barcode";
import { rcvCancel, rcvMatch } from "@/lib/barcode-actions";
import { ReceiveScreen, type RLine } from "./ReceiveScreen";

export const dynamic = "force-dynamic";

type R = { id: string; year: number; no: number; status: string; supplier_doc: string | null; add_to_stock: boolean | null; invoice_id: string | null; note: string | null; signer_name: string | null; confirmed_at: string | null; created_at: string; po_id: string | null; fin_parties: { name: string } | null; stk_warehouses: { name: string } | null; pur_orders: { year: number; no: number } | null };
const fmt = (n: number) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Mal kabul: açıkken okutma ekranı; onaylıysa tutanak ve fatura karşılaştırması */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: r0 }, { data: ln }] = await Promise.all([
    supabase.from("stk_receipts").select("id, year, no, status, supplier_doc, add_to_stock, invoice_id, note, signer_name, confirmed_at, created_at, po_id, fin_parties(name), stk_warehouses(name), pur_orders(year, no)").eq("id", id).maybeSingle(),
    supabase.from("stk_receipt_lines").select("id, name, unit, expected, qty, damaged, lot_no, expiry_date, note, item_id, po_line_id, sort, stk_items(code, track_lot, track_expiry)").eq("receipt_id", id).order("sort"),
  ]);
  if (!r0) notFound();
  const r = r0 as unknown as R;
  const lines: RLine[] = ((ln ?? []) as unknown as (Omit<RLine, "track_lot" | "track_expiry" | "code"> & { stk_items: { code: string; track_lot: boolean; track_expiry: boolean } | null })[]).map((l) => ({
    ...l, expected: Number(l.expected), qty: Number(l.qty), damaged: Number(l.damaged), track_lot: !!l.stk_items?.track_lot, track_expiry: !!l.stk_items?.track_expiry, code: l.stk_items?.code ?? null,
  }));
  const [label, cls] = RCV_STATUS[r.status] ?? RCV_STATUS.open!;
  const { data: invL } = r.invoice_id ? await supabase.from("inv_lines").select("item_id, name, qty, unit").eq("invoice_id", r.invoice_id) : { data: [] };
  const inv = (invL ?? []) as { item_id: string | null; name: string; qty: number; unit: string }[];
  const { data: invH } = r.invoice_id ? await supabase.from("inv_invoices").select("id, doc_no, no").eq("id", r.invoice_id).maybeSingle() : { data: null };
  // Okutulan ↔ fatura karşılaştırması (stok kartına, yoksa ada göre)
  const keyOf = (x: { item_id: string | null; name: string }) => x.item_id ?? `n:${x.name.toLocaleLowerCase("tr").trim()}`;
  const cmp = new Map<string, { name: string; unit: string; got: number; billed: number }>();
  for (const l of lines) { const k = keyOf(l); const c = cmp.get(k) ?? { name: l.name, unit: l.unit, got: 0, billed: 0 }; c.got += l.qty - l.damaged; cmp.set(k, c); }
  for (const l of inv) { const k = keyOf(l); const c = cmp.get(k) ?? { name: l.name, unit: l.unit, got: 0, billed: 0 }; c.billed += Number(l.qty); cmp.set(k, c); }

  return (
    <>
      <PageHeader title={`Mal kabul ${rcvNo(r)}`} subtitle={[r.fin_parties?.name, r.supplier_doc ? `belge ${r.supplier_doc}` : null, r.pur_orders ? `sipariş SA-${r.pur_orders.year}-${String(r.pur_orders.no).padStart(4, "0")}` : null, r.stk_warehouses?.name].filter(Boolean).join(" · ")}
        actions={r.status === "open" && (s.modules.stock ?? 0) >= 2 ? <form action={rcvCancel}><input type="hidden" name="id" value={id} /><button className="text-sm font-semibold text-bad">İptal et</button></form> : undefined} />
      <div className={`${page} max-w-[1000px]`}>
        <Link href="/stok/mal-kabul" className="text-sm font-semibold text-brand-700">← Mal kabul</Link>
        {r.status === "open" && (s.modules.stock ?? 0) >= 2 ? (
          <ReceiveScreen id={id} lines={lines} signer={s.email?.split("@")[0] ?? ""} />
        ) : (
          <>
            <section className="bg-white border border-line rounded-[16px] p-4 md:p-5 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${cls}`}>{label}</span>
                {r.status === "confirmed" && <span className="text-sm">{r.add_to_stock ? "📦 Stoğa girdi (faturasız)" : r.invoice_id ? `🧾 Faturayla eşleşti: ${invH?.doc_no ?? `#${invH?.no ?? ""}`}` : "🧾 Fatura bekleniyor (stok e-faturayla girecek)"}</span>}
                {r.confirmed_at && <span className="text-sm text-muted">· {dt(r.confirmed_at)} · teslim alan {r.signer_name}</span>}
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Ürün</th><th className="py-1.5 text-right">Beklenen</th><th className="py-1.5 text-right">Gelen</th><th className="py-1.5 text-right">Hasarlı</th><th className="py-1.5">Lot / SKT</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-[#EEF2F6]">
                      <td className="py-2">{l.name}{l.expected === 0 && <span className="ml-1 text-xs text-[#6D28D9]">(siparişte yok)</span>}</td>
                      <td className="py-2 text-right num">{l.expected ? fmt(l.expected) : "—"}</td>
                      <td className={`py-2 text-right num font-semibold ${l.expected && l.qty < l.expected ? "text-bad" : l.expected && l.qty > l.expected ? "text-warn" : ""}`}>{fmt(l.qty)} {l.unit}</td>
                      <td className="py-2 text-right num">{l.damaged ? fmt(l.damaged) : "—"}</td>
                      <td className="py-2 text-xs text-muted">{[l.lot_no, l.expiry_date].filter(Boolean).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.note && <p className="text-sm"><b>Not:</b> {r.note}</p>}
            </section>
            {r.invoice_id && (
              <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
                <div className="mb-2 flex items-center gap-3"><h2 className="flex-1 font-display font-semibold">Okutulan ↔ fatura karşılaştırması</h2>
                  <form action={rcvMatch}><input type="hidden" name="id" value={id} /><button className="text-xs font-semibold text-bad">Eşleşmeyi kaldır</button></form></div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Ürün</th><th className="py-1.5 text-right">Okutulan (sağlam)</th><th className="py-1.5 text-right">Faturada</th><th className="py-1.5 text-right">Fark</th></tr></thead>
                  <tbody>
                    {[...cmp.values()].map((c, i) => {
                      const d = c.billed - c.got;
                      return <tr key={i} className="border-t border-[#EEF2F6]"><td className="py-2">{c.name}</td><td className="py-2 text-right num">{fmt(c.got)}</td><td className="py-2 text-right num">{fmt(c.billed)}</td><td className={`py-2 text-right num font-semibold ${d ? "text-bad" : "text-ok"}`}>{d ? (d > 0 ? `+${fmt(d)}` : fmt(d)) : "✓"}</td></tr>;
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Fark: faturada olup gelmeyen (+) ya da gelip faturada olmayan (−) miktar.</p>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
