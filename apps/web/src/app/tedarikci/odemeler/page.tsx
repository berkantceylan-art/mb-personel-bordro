import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { PayCalendar, monthRange } from "@/components/supplier/PayCalendar";
import { portalCtx, portalError, portalHome, type PayItem } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

/** Tedarikçinin ödeme takvimi: fatura vadeleri, verdiğimiz çek / senetler, planlı ödemeler */
export default async function SupplierPayments({ searchParams }: { searchParams: Promise<{ cari?: string; ay?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalCtx(sp, "/tedarikci/odemeler");
  if (!ctx) return <NotLinked />;
  const { badges } = await portalHome(ctx);
  const r = monthRange(sp.ay);
  const horizon = new Date(Date.parse(r.to) + 120 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await ctx.sb.rpc("pay_calendar", { p_from: r.from, p_to: horizon, p_party: ctx.party.id });
  return (
    <PortalShell ctx={ctx} active="/tedarikci/odemeler" badges={badges}>
      <div><h2 className="font-display text-2xl font-bold text-brand-800">Ödeme takvimi</h2><p className="text-sm text-muted">Vadesi gelen faturalarınız, size verdiğimiz çek / senetler ve planladığımız ödemeler.</p></div>
      {error ? <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p> : <PayCalendar items={(data ?? []) as PayItem[]} ay={r.month} base={`/tedarikci/odemeler${ctx.q}`} />}
    </PortalShell>
  );
}
