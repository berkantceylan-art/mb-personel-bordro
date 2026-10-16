import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { WB_STATUS, waybillError, wbNo } from "@/lib/waybill";
import { cancelWaybill, createAllWaybills, createWaybill, issueAllWaybills, issueWaybill } from "@/lib/waybill-actions";
import { waLink, waWaybillText } from "@/lib/wa";

export const dynamic = "force-dynamic";

type W = { id: string; year: number; no: number; customer_id: string; ship_date: string; status: string; currency: string; job_count: number; unit_count: number; total: number; statement_id: string | null; auto: boolean; lab_customers: { name: string; internal_book: boolean; phone: string | null; doc_lang: string | null } | null };

const shift = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Günlük irsaliyeler: o gün her müşteriye giden işler; yazdır, kesildi, iptal. İrsaliyesiz teslimler için tek tuşla irsaliye */
export default async function WaybillsPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : today;
  const supabase = await createClient();
  const [{ data: wd, error }, { data: loose }] = await Promise.all([
    supabase.from("lab_waybills").select("id, year, no, customer_id, ship_date, status, currency, job_count, unit_count, total, statement_id, auto, lab_customers(name, internal_book, phone, doc_lang)").eq("ship_date", day).neq("status", "cancelled").order("created_at"),
    supabase.from("jobs").select("id, no, patient, total, currency, customer_id, delivered_at, lab_customers(name)").eq("status", "delivered").is("waybill_id", null).gte("delivered_at", `${day}T00:00:00+03:00`).lte("delivered_at", `${day}T23:59:59+03:00`).order("no"),
  ]);
  const wbs = (wd ?? []) as unknown as W[];
  const { data: wj } = wbs.length ? await supabase.from("jobs").select("no, patient, waybill_id").in("waybill_id", wbs.map((w) => w.id)).order("no") : { data: [] };
  const jobsOf = (id: string) => ((wj ?? []) as { no: number; patient: string | null; waybill_id: string }[]).filter((j) => j.waybill_id === id);
  const looseRows = (loose ?? []) as unknown as { id: string; no: number; patient: string | null; total: number; currency: string; customer_id: string; lab_customers: { name: string } | null }[];
  const byCust = new Map<string, typeof looseRows>();
  for (const j of looseRows) byCust.set(j.customer_id, [...(byCust.get(j.customer_id) ?? []), j]);
  const sum = (cur: string) => wbs.filter((w) => w.currency === cur).reduce((a, w) => a + Number(w.total), 0);

  return (
    <>
      <PageHeader title="Günlük irsaliyeler" subtitle="İç hesap kullanan müşterilerde kutu çıkışında iş o günün irsaliyesine kendiliğinden eklenir. Ay sonunda Aylık faturalama ekranından tek faturada toplanır."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/isler/aylik-fatura" className="text-brand-700">Aylık faturalama</Link><Link href="/isler/cari" className="text-brand-700">Cari hesaplar</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">{waybillError(error.message)}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/isler/irsaliye?gun=${shift(day, -1)}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Önceki gün">‹</Link>
          <form className="flex gap-2"><input type="date" name="gun" defaultValue={day} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3" aria-label="Gün" /><button className="h-10 px-3 rounded-[10px] border border-line bg-white text-sm font-semibold">Git</button></form>
          <Link href={`/isler/irsaliye?gun=${shift(day, 1)}`} className="h-10 w-10 grid place-items-center rounded-[10px] border border-line bg-white font-bold" aria-label="Sonraki gün">›</Link>
          {day !== today && <Link href="/isler/irsaliye" className="text-sm font-semibold text-brand-700">Bugün</Link>}
          <span className="ml-auto text-sm text-muted">{formatDate(day)} · {wbs.length} irsaliye · {wbs.reduce((a, w) => a + w.job_count, 0)} iş{sum("TRY") ? ` · ${money(sum("TRY"), "TRY")}` : ""}{sum("EUR") ? ` · ${money(sum("EUR"), "EUR")}` : ""}</span>
        </div>

        {(wbs.length > 0 || byCust.size > 0) && (
          <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-white p-3">
            <b className="text-sm mr-2">Toplu işlemler</b>
            {byCust.size > 0 && <form action={createAllWaybills}><input type="hidden" name="date" value={day} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">İrsaliyesiz {looseRows.length} işe toplu irsaliye kes ({byCust.size} müşteri)</PendingSubmit></form>}
            {wbs.some((w) => w.status === "open") && <form action={issueAllWaybills}><input type="hidden" name="date" value={day} /><PendingSubmit className="h-10 px-4 rounded-[10px] border border-ok text-ok text-sm font-semibold">Açık {wbs.filter((w) => w.status === "open").length} irsaliyeyi “kesildi” yap</PendingSubmit></form>}
            {wbs.length > 0 && <Link href={`/yazdir/irsaliye/toplu?gun=${day}`} className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold text-brand-700">🖨 Hepsini yazdır ({wbs.length})</Link>}
            {wbs.length > 0 && <Link href={`/yazdir/irsaliye/toplu?gun=${day}&fiyat=0`} className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold text-brand-700">Hepsini fiyatsız yazdır</Link>}
          </div>
        )}
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {wbs.map((w) => (
            <article key={w.id} className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <Link href={`/isler/irsaliye/${w.id}`} className="font-display text-lg font-bold text-brand-700">{w.lab_customers?.name ?? "—"}</Link>
                  <div className="text-xs text-muted font-mono">{wbNo(w.year, w.no)}{w.auto ? "" : " · elle"}</div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${WB_STATUS[w.status]?.[1]}`}>{w.statement_id ? "Faturalandı" : WB_STATUS[w.status]?.[0]}</span>
              </div>
              <div className="flex items-baseline gap-3"><b className="font-display text-2xl">{money(w.total, w.currency)}</b><span className="text-sm text-muted">{w.job_count} iş · {Number(w.unit_count)} birim</span></div>
              <div className="flex flex-wrap gap-2 pt-1 mt-auto border-t border-[#EEF2F6]">
                <Link href={`/yazdir/irsaliye/${w.id}`} className="h-9 px-3 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Yazdır</Link>
                <Link href={`/yazdir/irsaliye/${w.id}?fiyat=0`} className="h-9 px-3 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold">Fiyatsız</Link>
                {(() => { const l = waLink(w.lab_customers?.phone, waWaybillText({ lang: w.lab_customers?.doc_lang, customer: w.lab_customers?.name ?? "", no: wbNo(w.year, w.no), jobs: jobsOf(w.id), total: money(w.total, w.currency), company: s.companyName })); return l ? <a href={l} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center rounded-[10px] border border-[#25D366] text-[#128C7E] text-sm font-semibold">WhatsApp</a> : null; })()}
                <Link href={`/yazdir/beyan?irsaliye=${w.id}`} className="h-9 px-3 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold">Beyanlar</Link>
                {w.status === "open" && <form action={issueWaybill}><input type="hidden" name="id" value={w.id} /><PendingSubmit className="h-9 px-3 rounded-[10px] border border-ok text-ok text-sm font-semibold">Kesildi</PendingSubmit></form>}
                {!w.statement_id && <form action={cancelWaybill} className="ml-auto self-center"><input type="hidden" name="id" value={w.id} /><ConfirmSubmit label="İptal" question="İrsaliye iptal edilsin mi? İşler irsaliyesiz kalır." /></form>}
              </div>
            </article>
          ))}
          {wbs.length === 0 && <p className="md:col-span-2 xl:col-span-3 rounded-[16px] border border-dashed border-[#C5D0DB] p-8 text-center text-muted">Bu gün irsaliye yok.</p>}
        </section>

        {byCust.size > 0 && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">İrsaliyesiz teslim edilenler <span className="text-sm font-normal text-muted">(iç hesap kullanmayan müşteriler)</span></h2>
            {[...byCust.entries()].map(([cid, js]) => (
              <form key={cid} action={createWaybill} className="flex flex-wrap items-center gap-3 border-t border-[#EEF2F6] pt-3">
                <input type="hidden" name="customer_id" value={cid} />
                <input type="hidden" name="date" value={day} />
                <b className="min-w-48">{js[0]!.lab_customers?.name ?? "—"}</b>
                <span className="flex flex-wrap gap-2 flex-1">
                  {js.map((j) => <label key={j.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><input type="checkbox" name="job_id" value={j.id} defaultChecked />#{j.no}{j.patient ? ` ${j.patient}` : ""} · {money(j.total, j.currency)}</label>)}
                </span>
                <PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">İrsaliye kes</PendingSubmit>
              </form>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
