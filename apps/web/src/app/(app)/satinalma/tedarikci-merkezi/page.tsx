import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { daysTo, dmy, portalError } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tedarikçi merkezi" };

type Row = { party_id: string; name: string; phone: string | null; email: string | null; portal_users: number; last_seen: string | null; unread: number; docs_new: number; prices_pending: number; orders_open: number; orders_unseen: number; invoice_balance: number; slip_balance: number | null; currency: string; next_due: string | null; next_amount: number | null; last_order: string | null };

/** Tedarikçi merkezi: okunmamış mesaj, yeni belge, fiyat listesi, açık sipariş, bakiye ve sıradaki ödeme — tedarikçi bazında */
export default async function SupplierCenter({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const s = await getSession();
  if (Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { data, error } = await (await createClient()).rpc("sup_center");
  let rows = (data ?? []) as Row[];
  const total = { unread: rows.reduce((a, r) => a + r.unread, 0), docs: rows.reduce((a, r) => a + r.docs_new, 0), prices: rows.reduce((a, r) => a + r.prices_pending, 0), portal: rows.filter((r) => r.portal_users > 0).length, week: rows.filter((r) => r.next_due && daysTo(r.next_due) <= 7).length };
  if (sp.q) rows = rows.filter((r) => r.name.toLocaleLowerCase("tr").includes(sp.q!.toLocaleLowerCase("tr")));
  if (sp.f === "bekleyen") rows = rows.filter((r) => r.unread || r.docs_new || r.prices_pending);
  if (sp.f === "odeme") rows = rows.filter((r) => r.next_due && daysTo(r.next_due) <= 7);
  if (sp.f === "portal") rows = rows.filter((r) => r.portal_users > 0);

  return (
    <>
      <PageHeader title="Tedarikçi merkezi" subtitle="Portal yazışmaları, belgeler, fiyat listeleri, cari ve ödemeler — tedarikçi bazında tek ekran"
        actions={<span className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/satinalma/odeme-takvimi" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white">Ödeme takvimi</Link>
          <Link href="/alis/tedarikci-kullanicilari" className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-brand-700">Portal kullanıcıları</Link>
        </span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p>}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {([["Okunmamış mesaj", total.unread, "bekleyen", true], ["Yeni belge", total.docs, "bekleyen", true], ["Onay bekleyen fiyat listesi", total.prices, "bekleyen", true], ["7 gün içinde ödeme", total.week, "odeme", false], ["Portalı kullanan", total.portal, "portal", false]] as const).map(([l, n, f, hot]) => (
            <Link key={l} href={`?f=${f}`} className={`rounded-[16px] border bg-white p-4 hover:border-brand-600 ${hot && n ? "border-warn" : "border-line"}`}>
              <div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-3xl font-bold ${hot && n ? "text-warn" : ""}`}>{n}</div>
            </Link>
          ))}
        </section>
        <form className="flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={sp.q} placeholder="Tedarikçi ara" className="h-10 w-64 rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
          {sp.f && <input type="hidden" name="f" value={sp.f} />}
          <button className="h-10 px-3 rounded-[10px] border border-line bg-white text-sm font-semibold">Ara</button>
          {(sp.f || sp.q) && <Link href="?" className="text-sm text-muted">Temizle</Link>}
        </form>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const d = r.next_due ? daysTo(r.next_due) : null;
            const ping = r.unread + r.docs_new + r.prices_pending;
            return (
              <Link key={r.party_id} href={`/satinalma/tedarikci/${r.party_id}`} className={`rounded-[20px] border bg-white p-4 flex flex-col gap-3 hover:shadow-md hover:-translate-y-0.5 transition ${ping ? "border-warn" : "border-line"}`}>
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0a3d73] to-[#1a86c7] text-white grid place-items-center font-display font-bold">{r.name.slice(0, 2).toLocaleUpperCase("tr")}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{r.name}</div>
                    <div className="text-xs text-muted truncate">{r.portal_users ? `🟢 Portal · ${r.portal_users} kullanıcı${r.last_seen ? ` · son giriş ${dmy(r.last_seen)}` : ""}` : "Portal kullanıcısı yok"}</div>
                  </div>
                  {ping > 0 && <span className="min-w-6 h-6 px-1.5 rounded-full bg-bad text-white text-xs font-bold grid place-items-center">{ping}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {r.unread > 0 && <span className="rounded-full bg-warn-bg text-warn px-2 py-0.5 font-semibold">✉ {r.unread} mesaj</span>}
                  {r.docs_new > 0 && <span className="rounded-full bg-warn-bg text-warn px-2 py-0.5 font-semibold">⎘ {r.docs_new} belge</span>}
                  {r.prices_pending > 0 && <span className="rounded-full bg-warn-bg text-warn px-2 py-0.5 font-semibold">₺ fiyat listesi</span>}
                  {r.orders_open > 0 && <span className="rounded-full bg-[#EEF4FB] text-brand-700 px-2 py-0.5 font-semibold">{r.orders_open} açık sipariş</span>}
                  {r.orders_unseen > 0 && <span className="rounded-full bg-bad-bg text-bad px-2 py-0.5 font-semibold">{r.orders_unseen} sipariş okunmadı</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm border-t border-[#EEF2F6] pt-3">
                  <div><div className="text-[11px] text-muted">Faturalı borcumuz</div><div className="font-semibold tabular-nums">{money(Number(r.invoice_balance ?? 0), r.currency)}</div>{r.slip_balance != null && <div className="text-[11px] text-muted">Fişli: {money(Number(r.slip_balance), r.currency)}</div>}</div>
                  <div><div className="text-[11px] text-muted">Sıradaki ödeme</div>{r.next_due ? <div className={`font-semibold tabular-nums ${d! < 0 ? "text-bad" : d! <= 3 ? "text-warn" : ""}`}>{money(Number(r.next_amount ?? 0), r.currency)} <span className="text-[11px]">{d! < 0 ? `${-d!} gün geçti` : d === 0 ? "bugün" : `${d} gün`}</span></div> : <div className="text-muted">—</div>}</div>
                </div>
              </Link>
            );
          })}
          {!rows.length && !error && <p className="text-muted text-sm">Tedarikçi yok.</p>}
        </section>
      </div>
    </>
  );
}
