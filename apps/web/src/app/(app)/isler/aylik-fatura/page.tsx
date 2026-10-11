import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { LANGS, stNo, waybillError } from "@/lib/waybill";
import { cancelStatement, createStatements } from "@/lib/waybill-actions";

export const dynamic = "force-dynamic";

type O = { customer_id: string; name: string; currency: string; internal_book: boolean; doc_lang: string; waybills: number; open_jobs: number; open_total: number; loose_jobs: number; loose_total: number; statements: number; statement_total: number; last_statement: string | null };
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Aylık faturalama: dönemin irsaliyelerini müşteri başına tek faturada topla (iç hesap) */
export default async function MonthlyBilling({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const ym = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : now.toISOString().slice(0, 7);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const from = `${ym}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const supabase = await createClient();
  const [{ data: od, error }, { data: sts }] = await Promise.all([
    supabase.rpc("lab_billing_overview", { p_from: from, p_to: to }),
    supabase.from("lab_statements").select("id, year, no, customer_id, period_from, period_to, issue_date, currency, job_count, unit_count, total, status, lang, lab_customers(name)").lte("period_from", to).gte("period_to", from).order("no", { ascending: false }),
  ]);
  const rows = (od ?? []) as O[];
  const ready = rows.filter((r) => r.open_jobs + r.loose_jobs > 0);
  const statements = (sts ?? []) as unknown as { id: string; year: number; no: number; customer_id: string; period_from: string; period_to: string; issue_date: string; currency: string; job_count: number; unit_count: number; total: number; status: string; lang: string; lab_customers: { name: string } | null }[];
  const tot = (cur: string, f: (r: O) => number) => rows.filter((r) => r.currency === cur).reduce((a, r) => a + f(r), 0);

  return (
    <>
      <PageHeader title="Aylık faturalama" subtitle="Ay boyunca her gün kesilen irsaliyeler ay sonunda müşteri başına tek faturada toplanır. Fatura müşterinin dilinde (TR / EN / FR) basılır."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/isler/irsaliye" className="text-brand-700">Günlük irsaliyeler</Link><Link href="/isler/cari" className="text-brand-700">Cari hesaplar</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">{waybillError(error.message)}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/isler/aylik-fatura?ay=${prev}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Önceki ay">‹</Link>
          <b className="font-display text-xl min-w-40 text-center">{MONTHS[m - 1]} {y}</b>
          <Link href={`/isler/aylik-fatura?ay=${next}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Sonraki ay">›</Link>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            ["Faturalanacak müşteri", String(ready.length)],
            ["Faturalanmamış (€)", money(tot("EUR", (r) => Number(r.open_total) + Number(r.loose_total)), "EUR")],
            ["Faturalanmamış (TL)", money(tot("TRY", (r) => Number(r.open_total) + Number(r.loose_total)), "TRY")],
            ["Kesilen fatura", String(statements.filter((x) => x.status === "issued").length)],
          ].map(([l, v]) => <div key={l} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>)}
        </div>

        <form action={createStatements} className="rounded-[18px] border border-line bg-white overflow-hidden">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
            <h2 className="font-display text-lg font-bold mr-auto">Faturalanacaklar</h2>
            <label className="flex items-center gap-2 text-sm">Fatura tarihi<input type="date" name="issue" defaultValue={to} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <input name="note" placeholder="Faturaya not (isteğe bağlı)" className="h-10 w-64 rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Seçilenleri faturala</PendingSubmit>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-left text-xs text-muted"><th className="p-3 w-10" /><th className="p-3">Müşteri</th><th className="p-3">İrsaliye</th><th className="p-3 text-right">Faturalanmamış iş</th><th className="p-3 text-right">Tutar</th><th className="p-3">Bu ay kesilen</th><th className="p-3">Dil</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const n = r.open_jobs + r.loose_jobs;
                  return (
                    <tr key={r.customer_id} className={`border-t border-[#EEF2F6] ${n ? "" : "opacity-60"}`}>
                      <td className="p-3">{n > 0 && <input type="checkbox" name="customer_id" value={r.customer_id} defaultChecked aria-label={r.name} className="w-4 h-4" />}</td>
                      <td className="p-3"><Link href={`/isler/hekimler/${r.customer_id}`} className="font-semibold text-brand-700">{r.name}</Link>{!r.internal_book && <span className="ml-2 text-[11px] text-muted">iç hesap kapalı</span>}</td>
                      <td className="p-3">{r.waybills}{r.loose_jobs > 0 && <span className="block text-[11px] text-warn font-semibold">{r.loose_jobs} iş irsaliyesiz — faturalarken irsaliyesi açılır</span>}</td>
                      <td className="p-3 text-right">{n}</td>
                      <td className="p-3 text-right num font-semibold">{money(Number(r.open_total) + Number(r.loose_total), r.currency)}</td>
                      <td className="p-3">{r.statements ? <Link href={`/yazdir/ic-fatura/${r.last_statement}`} className="text-brand-700 font-semibold">{r.statements} fatura · {money(r.statement_total, r.currency)}</Link> : <span className="text-muted">—</span>}</td>
                      <td className="p-3 text-xs">{LANGS[r.doc_lang] ?? r.doc_lang}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted">Bu ay iç hesap kullanan müşteri ya da irsaliye yok. Müşteri kartında “İç hesap kullanır” işaretleyin.</td></tr>}
              </tbody>
            </table>
          </div>
        </form>

        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <h2 className="font-display text-lg font-bold px-4 pt-4">Bu dönemin faturaları</h2>
          <table className="w-full text-sm min-w-[820px] mt-2">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">No</th><th className="p-3">Müşteri</th><th className="p-3">Dönem</th><th className="p-3 text-right">İş / birim</th><th className="p-3 text-right">Tutar</th><th className="p-3" /></tr></thead>
            <tbody>
              {statements.map((x) => (
                <tr key={x.id} className={`border-t border-[#EEF2F6] ${x.status === "cancelled" ? "opacity-50 line-through" : ""}`}>
                  <td className="p-3 font-mono font-semibold">{stNo(x.year, x.no)}</td>
                  <td className="p-3">{x.lab_customers?.name}</td>
                  <td className="p-3 text-xs">{formatDate(x.period_from)} – {formatDate(x.period_to)}</td>
                  <td className="p-3 text-right">{x.job_count} / {Number(x.unit_count)}</td>
                  <td className="p-3 text-right num font-semibold">{money(x.total, x.currency)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {x.status === "issued" && <><Link href={`/yazdir/ic-fatura/${x.id}`} className="text-sm font-semibold text-brand-700 mr-4">Yazdır / PDF</Link><form action={cancelStatement} className="inline"><input type="hidden" name="id" value={x.id} /><ConfirmSubmit label="İptal" question="Fatura iptal edilsin mi? İrsaliyeleri yeniden faturalanabilir." /></form></>}
                  </td>
                </tr>
              ))}
              {statements.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted">Henüz fatura yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
