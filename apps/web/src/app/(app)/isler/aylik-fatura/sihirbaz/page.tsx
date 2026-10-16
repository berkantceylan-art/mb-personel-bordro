import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { LANGS, stNo, wbNo } from "@/lib/waybill";
import { waLink, waStatementText } from "@/lib/wa";
import type { DocMarks } from "@/components/DocActions";
import { StatementWizard, type SCust, type SStatement, type SWaybill } from "./StatementWizard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Fatura sihirbazı" };
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Aylık fatura sihirbazı: dönem → müşteriler → irsaliye seçimi → kontrol listesi → kes ve gönder */
export default async function StatementWizardPage({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const ym = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const from = `${ym}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const sb = await createClient();
  const [{ data: ws }, { data: lj }, { data: ss }, { data: banks }] = await Promise.all([
    sb.from("lab_waybills").select("id, year, no, customer_id, ship_date, job_count, total, currency, status").is("statement_id", null).neq("status", "cancelled").gt("job_count", 0).gte("ship_date", from).lte("ship_date", to).order("ship_date").limit(5000),
    sb.from("jobs").select("customer_id").eq("status", "delivered").is("waybill_id", null).gte("delivered_at", `${from}T00:00:00+03:00`).lte("delivered_at", `${to}T23:59:59+03:00`).limit(10000),
    sb.from("lab_statements").select("id, year, no, customer_id, period_from, period_to, issue_date, currency, job_count, total, status").eq("status", "issued").lte("period_from", to).gte("period_to", from).order("no"),
    sb.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const wbRaw = (ws ?? []) as { id: string; year: number; no: number; customer_id: string; ship_date: string; job_count: number; total: number; currency: string; status: string }[];
  const stRaw = (ss ?? []) as { id: string; year: number; no: number; customer_id: string; period_from: string; period_to: string; issue_date: string; currency: string; job_count: number; total: number; status: string }[];
  const looseBy = new Map<string, number>();
  for (const j of (lj ?? []) as { customer_id: string }[]) looseBy.set(j.customer_id, (looseBy.get(j.customer_id) ?? 0) + 1);
  const custIds = [...new Set([...wbRaw.map((w) => w.customer_id), ...stRaw.map((x) => x.customer_id), ...looseBy.keys()])];
  const [{ data: cs }, { data: ev }] = await Promise.all([
    custIds.length ? sb.from("lab_customers").select("id, name, currency, address, tax_no, email, phone, doc_lang, internal_book").in("id", custIds) : Promise.resolve({ data: [] }),
    stRaw.length ? sb.from("lab_doc_events").select("doc_id, action, at").eq("doc_kind", "statement").in("doc_id", stRaw.map((x) => x.id)).order("at") : Promise.resolve({ data: [] }),
  ]);
  const cmap = new Map(((cs ?? []) as (Omit<SCust, "loose" | "billed" | "langLabel"> & { internal_book: boolean })[]).map((c) => [c.id, c]));
  const marks: Record<string, DocMarks> = {};
  for (const e of (ev ?? []) as { doc_id: string; action: keyof DocMarks; at: string }[]) (marks[e.doc_id] ??= {})[e.action] = e.at;
  const customers: SCust[] = custIds.map((id) => {
    const c = cmap.get(id);
    return { id, name: c?.name ?? "—", currency: c?.currency ?? "TRY", address: c?.address ?? null, tax_no: c?.tax_no ?? null, email: c?.email?.trim() || null, phone: c?.phone ?? null, doc_lang: c?.doc_lang ?? "tr",
      langLabel: LANGS[c?.doc_lang ?? "tr"] ?? "Türkçe", loose: looseBy.get(id) ?? 0, billed: stRaw.filter((x) => x.customer_id === id).map((x) => stNo(x.year, x.no)) };
  }).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const waybills: SWaybill[] = wbRaw.map((w) => ({ id: w.id, no: wbNo(w.year, w.no), customer_id: w.customer_id, date: w.ship_date, dateLabel: formatDate(w.ship_date), job_count: w.job_count, total: Number(w.total), currency: w.currency, totalLabel: money(w.total, w.currency), open: w.status === "open" }));
  const bankList = (banks ?? []).map((b) => b.value as string);
  const statements: SStatement[] = stRaw.map((x) => {
    const c = cmap.get(x.customer_id);
    const no = stNo(x.year, x.no);
    return { id: x.id, no, customer: c?.name ?? "—", period: `${formatDate(x.period_from)} – ${formatDate(x.period_to)}`, job_count: x.job_count, totalLabel: money(x.total, x.currency), email: c?.email?.trim() || null,
      waHref: waLink(c?.phone, waStatementText({ lang: c?.doc_lang, customer: c?.name ?? "", no, period: `${formatDate(x.period_from)} – ${formatDate(x.period_to)}`, total: money(x.total, x.currency), jobs: x.job_count, banks: bankList, company: s.companyName })), marks: marks[x.id] ?? {} };
  });

  return (
    <>
      <PageHeader title="Fatura sihirbazı" subtitle="Ay sonunda irsaliyeleri müşteri başına tek faturada toplayın: seçin, kontrol edin, kesin, yazdırın ve gönderin"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/isler/aylik-fatura?ay=${ym}`} className="text-brand-700">Klasik görünüm</Link><Link href="/isler/irsaliye/sihirbaz" className="text-brand-700">İrsaliye sihirbazı</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/isler/aylik-fatura/sihirbaz?ay=${prev}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Önceki ay">‹</Link>
          <b className="font-display text-xl min-w-40 text-center">{MONTHS[m - 1]} {y}</b>
          <Link href={`/isler/aylik-fatura/sihirbaz?ay=${next}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Sonraki ay">›</Link>
        </div>
        <StatementWizard key={ym} ym={ym} from={from} to={to} customers={customers} waybills={waybills} statements={statements} />
      </div>
    </>
  );
}
