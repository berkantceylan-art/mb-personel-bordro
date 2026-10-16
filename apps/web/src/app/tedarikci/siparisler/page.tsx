import Link from "next/link";
import { money } from "@/lib/jobs";
import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { dmy, portalCtx, portalHome, withQ } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

const TABS: [string, string, string[]][] = [
  ["yeni", "Onay bekleyen", ["approved", "sent"]], ["acik", "Açık", ["approved", "sent", "partial"]], ["tamam", "Tamamlanan", ["received", "invoiced"]], ["hepsi", "Hepsi", ["approved", "sent", "partial", "received", "invoiced"]],
];

/** Tedarikçinin siparişleri: onay, termin, sevk durumu; okundu bilgisi laboratuvara gider */
export default async function SupplierOrders({ searchParams }: { searchParams: Promise<{ cari?: string; s?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalCtx(sp, "/tedarikci/siparisler");
  if (!ctx) return <NotLinked />;
  const { badges } = await portalHome(ctx);
  const tab = TABS.find((t) => t[0] === sp.s) ?? TABS[1];
  let q = ctx.sb.from("pur_orders")
    .select("id, year, no, order_date, expected_date, status, currency, total, supplier_token, sup_seen_at, sup_ack_at, sup_promised_date, sup_shipped_at, sup_waybill, sup_declined_at")
    .eq("party_id", ctx.party.id).in("status", tab[2]).order("created_at", { ascending: false }).limit(300);
  if (tab[0] === "yeni") q = q.is("sup_ack_at", null).is("sup_declined_at", null);
  const { data } = await q;
  type O = { id: string; year: number; no: number; order_date: string; expected_date: string | null; status: string; currency: string; total: number; supplier_token: string; sup_seen_at: string | null; sup_ack_at: string | null; sup_promised_date: string | null; sup_shipped_at: string | null; sup_waybill: string | null; sup_declined_at: string | null };
  const list = (data ?? []) as O[];
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  const step = (o: O) => [
    ["Alındı", !!o.sup_seen_at], ["Onaylandı", !!o.sup_ack_at], ["Sevk", !!o.sup_shipped_at || ["partial", "received", "invoiced"].includes(o.status)], ["Teslim", ["received", "invoiced"].includes(o.status)],
  ] as [string, boolean][];

  return (
    <PortalShell ctx={ctx} active="/tedarikci/siparisler" badges={badges}>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => <Link key={k} href={withQ(`/tedarikci/siparisler?s=${k}`, ctx.q)} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold border ${tab[0] === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line text-brand-800"}`}>{l}</Link>)}
      </div>
      <section className="flex flex-col gap-3">
        {list.map((o) => {
          const late = ["sent", "partial"].includes(o.status) && (o.sup_promised_date ?? o.expected_date ?? "9999") < today;
          const fresh = ["approved", "sent"].includes(o.status) && !o.sup_ack_at && !o.sup_declined_at;
          return (
            <Link key={o.id} href={`/tedarikci/siparis/${o.supplier_token}`} className={`rounded-[20px] border bg-white p-4 md:p-5 flex flex-wrap items-center gap-4 hover:shadow-md transition ${fresh ? "border-warn ring-4 ring-warn/10" : late ? "border-bad" : "border-line"}`}>
              <div className="min-w-[150px]">
                <div className="font-mono text-lg font-bold text-brand-700">SA-{o.year}-{String(o.no).padStart(4, "0")}</div>
                <div className="text-xs text-muted">{dmy(o.order_date)}{o.expected_date ? ` · istenen ${dmy(o.expected_date)}` : ""}{o.sup_promised_date ? ` · termininiz ${dmy(o.sup_promised_date)}` : ""}</div>
              </div>
              <ol className="flex items-center gap-1 flex-1 min-w-[260px]">
                {step(o).map(([l, on], i) => (
                  <li key={l} className="flex items-center gap-1 flex-1">
                    <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold ${on ? "bg-ok text-white" : "bg-[#EEF2F6] text-muted"}`}>{on ? "✓" : i + 1}</span>
                    <span className={`text-xs ${on ? "font-semibold" : "text-muted"}`}>{l}</span>
                    {i < 3 && <span className={`flex-1 h-0.5 ${on ? "bg-ok" : "bg-[#EEF2F6]"}`} />}
                  </li>
                ))}
              </ol>
              <div className="text-right ml-auto">
                <div className="font-display text-xl font-bold tabular-nums">{money(o.total, o.currency)}</div>
                <div className={`text-xs font-semibold ${o.sup_declined_at ? "text-bad" : fresh ? "text-warn" : late ? "text-bad" : "text-muted"}`}>{o.sup_declined_at ? "Karşılayamıyorsunuz" : fresh ? "Onayınızı bekliyor →" : late ? "Termin geçti" : o.sup_waybill ? `İrsaliye ${o.sup_waybill}` : "Ayrıntı →"}</div>
              </div>
            </Link>
          );
        })}
        {!list.length && <div className="rounded-[20px] border border-line bg-white p-10 text-center text-muted">Bu sekmede sipariş yok.</div>}
      </section>
    </PortalShell>
  );
}
