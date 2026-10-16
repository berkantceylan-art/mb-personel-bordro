import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { wbNo } from "@/lib/waybill";
import { waLink, waWaybillText } from "@/lib/wa";
import type { DocMarks } from "@/components/DocActions";
import { WaybillWizard, type WCust, type WIssue, type WJob, type WWaybill } from "./WaybillWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "İrsaliye sihirbazı" };

/** Günlük irsaliye sihirbazı: teslimler → kontroller → irsaliye kes → yazdır / gönder */
export default async function WaybillWizardPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : today;
  const sb = await createClient();
  const [{ data: js }, { data: ws }] = await Promise.all([
    sb.from("jobs").select("id, no, patient, total, currency, customer_id, waybill_id, job_items(amount)").eq("status", "delivered").gte("delivered_at", `${day}T00:00:00+03:00`).lte("delivered_at", `${day}T23:59:59+03:00`).order("no").limit(2000),
    sb.from("lab_waybills").select("id, year, no, customer_id, status, currency, job_count, total, statement_id").eq("ship_date", day).neq("status", "cancelled").order("created_at"),
  ]);
  const jobsRaw = (js ?? []) as { id: string; no: number; patient: string | null; total: number; currency: string; customer_id: string; waybill_id: string | null; job_items: { amount: number }[] }[];
  const wbRaw = (ws ?? []) as { id: string; year: number; no: number; customer_id: string; status: string; currency: string; job_count: number; total: number; statement_id: string | null }[];
  const custIds = [...new Set([...jobsRaw.map((j) => j.customer_id), ...wbRaw.map((w) => w.customer_id)])];
  const [{ data: cs }, { data: ev }, { data: wjs }] = await Promise.all([
    custIds.length ? sb.from("lab_customers").select("id, name, currency, address, tax_no, email, phone, doc_lang").in("id", custIds) : Promise.resolve({ data: [] }),
    wbRaw.length ? sb.from("lab_doc_events").select("doc_id, action, at").eq("doc_kind", "waybill").in("doc_id", wbRaw.map((w) => w.id)).order("at") : Promise.resolve({ data: [] }),
    wbRaw.length ? sb.from("jobs").select("no, patient, waybill_id").in("waybill_id", wbRaw.map((w) => w.id)).order("no") : Promise.resolve({ data: [] }),
  ]);
  const custs = new Map(((cs ?? []) as WCust[]).map((c) => [c.id, c]));
  const marks: Record<string, DocMarks> = {};
  for (const e of (ev ?? []) as { doc_id: string; action: keyof DocMarks; at: string }[]) (marks[e.doc_id] ??= {})[e.action] = e.at;

  const jobs: WJob[] = jobsRaw.map((j) => ({ id: j.id, no: j.no, patient: j.patient, total: Number(j.total), currency: j.currency, customer_id: j.customer_id, waybill_id: j.waybill_id, items: j.job_items.length, totalLabel: money(j.total, j.currency) }));
  const issues: WIssue[] = [];
  for (const j of jobs) {
    const c = custs.get(j.customer_id);
    if (c && j.currency !== c.currency) issues.push({ key: `cur-${j.id}`, level: "error", text: `#${j.no} para birimi (${j.currency}) müşterinin para biriminden (${c.currency}) farklı`, href: `/isler/${j.id}` });
    if (!j.total) issues.push({ key: `zero-${j.id}`, level: "warn", text: `#${j.no} tutarı 0 (ücretsiz / prova ise sorun değil)`, href: `/isler/${j.id}` });
    if (!j.items) issues.push({ key: `item-${j.id}`, level: "warn", text: `#${j.no} ürün satırı yok`, href: `/isler/${j.id}` });
    if (!j.patient?.trim()) issues.push({ key: `pat-${j.id}`, level: "warn", text: `#${j.no} hasta adı boş`, href: `/isler/${j.id}` });
  }
  for (const cid of custIds) {
    const c = custs.get(cid);
    if (!c) continue;
    if (!c.address?.trim()) issues.push({ key: `adr-${cid}`, level: "warn", text: `${c.name}: adres eksik (irsaliyede görünmez)`, href: `/isler/hekimler/${cid}` });
    if (!c.email?.trim()) issues.push({ key: `mail-${cid}`, level: "info", text: `${c.name}: e-posta adresi yok — e-postayla gönderilemez`, href: `/isler/hekimler/${cid}` });
    if (!c.phone?.trim()) issues.push({ key: `tel-${cid}`, level: "info", text: `${c.name}: telefon yok — WhatsApp gönderilemez`, href: `/isler/hekimler/${cid}` });
  }
  const wjobs = (wjs ?? []) as { no: number; patient: string | null; waybill_id: string }[];
  const waybills: WWaybill[] = wbRaw.map((w) => {
    const c = custs.get(w.customer_id);
    const no = wbNo(w.year, w.no);
    return { id: w.id, no, customer_id: w.customer_id, customer: c?.name ?? "—", status: w.status, billed: !!w.statement_id, job_count: w.job_count, totalLabel: money(w.total, w.currency), email: c?.email?.trim() || null,
      waHref: waLink(c?.phone, waWaybillText({ lang: c?.doc_lang, customer: c?.name ?? "", no, jobs: wjobs.filter((x) => x.waybill_id === w.id), total: money(w.total, w.currency), company: s.companyName })), marks: marks[w.id] ?? {} };
  });
  const shift = (n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="İrsaliye sihirbazı" subtitle="Günün teslimlerini adım adım kontrol edin, irsaliyeleri kesin, yazdırın ve gönderin"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/isler/irsaliye?gun=${day}`} className="text-brand-700">Klasik görünüm</Link><Link href="/isler/aylik-fatura/sihirbaz" className="text-brand-700">Fatura sihirbazı</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/isler/irsaliye/sihirbaz?gun=${shift(-1)}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Önceki gün">‹</Link>
          <form className="flex gap-2"><input type="date" name="gun" defaultValue={day} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3" aria-label="Gün" /><button className="h-10 px-3 rounded-[10px] border border-line bg-white text-sm font-semibold">Git</button></form>
          <Link href={`/isler/irsaliye/sihirbaz?gun=${shift(1)}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Sonraki gün">›</Link>
          {day !== today && <Link href="/isler/irsaliye/sihirbaz" className="text-sm font-semibold text-brand-700">Bugün</Link>}
        </div>
        <WaybillWizard key={day} day={day} jobs={jobs} customers={[...custs.values()]} issues={issues} waybills={waybills} />
      </div>
    </>
  );
}
