import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DOC, docDate, docMoney, stNo, wbNo } from "@/lib/waybill";

export const dynamic = "force-dynamic";

/** Ay sonu fatura (A4): dönemin irsaliyeleri ve işleri, müşterinin dilinde. ?dil=tr|en|fr ?ozet=1 (yalnız irsaliye toplamları) */
export default async function StatementPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dil?: string; ozet?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: st } = await supabase.from("lab_statements").select("*, lab_customers(name, address, city, country, tax_office, tax_no)").eq("id", id).maybeSingle();
  if (!st) notFound();
  const c = st.lab_customers as { name: string; address: string | null; city: string | null; country: string | null; tax_office: string | null; tax_no: string | null } | null;
  const lang = ["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil! : st.lang;
  const t = DOC[lang]!;
  const brief = sp.ozet === "1";
  const [{ data: wbs }, { data: co }, { data: banks }] = await Promise.all([
    supabase.from("lab_waybills").select("id, year, no, ship_date, job_count, unit_count, total").eq("statement_id", id).order("ship_date"),
    supabase.from("companies").select("name, address, phone, tax_office, tax_no").eq("id", s.companyId).maybeSingle(),
    supabase.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const ids = (wbs ?? []).map((w) => w.id as string);
  const { data: jobs } = ids.length && !brief ? await supabase.from("jobs").select("id, no, patient, waybill_id, total, job_items(name, qty, amount, sort)").in("waybill_id", ids).order("no") : { data: [] };
  type J = { id: string; no: number; patient: string | null; waybill_id: string; total: number; job_items: { name: string; qty: number; amount: number; sort: number }[] };
  const byWb = new Map<string, J[]>();
  for (const j of (jobs ?? []) as J[]) byWb.set(j.waybill_id, [...(byWb.get(j.waybill_id) ?? []), j]);
  const cell = "border border-[#9AA7B4] px-2 py-1 align-top";
  const qs = (p: Record<string, string>) => `/yazdir/ic-fatura/${id}?${new URLSearchParams({ dil: lang, ...(brief ? { ozet: "1" } : {}), ...p })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href="/isler/aylik-fatura" className="font-semibold text-[#0A3D73]">← Aylık faturalama</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}</span>
        <Link href={brief ? `/yazdir/ic-fatura/${id}?dil=${lang}` : qs({ ozet: "1" })} className="text-sm font-semibold text-[#0A3D73]">{brief ? "Ayrıntılı" : "Yalnız irsaliye toplamları"}</Link>
        {st.status === "cancelled" && <span className="text-sm font-bold text-[#B42318]">İPTAL EDİLDİ</span>}
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex gap-3 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-12 h-12 object-contain" />
            <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[70mm]">{co?.address ?? ""}{co?.phone ? ` · ${co.phone}` : ""}</div>{co?.tax_no && <div className="text-[10px]">{t.tax}: {co.tax_office ?? ""} {co.tax_no}</div>}</div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold tracking-wide">{t.invoice}</div>
            <div className="text-[10px] text-[#444]">{t.page_sub_inv}</div>
            <div className="mt-1"><b>{t.no}:</b> {stNo(st.year, st.no)}</div>
            <div><b>{t.date}:</b> {docDate(st.issue_date, lang)}</div>
            <div><b>{t.period}:</b> {docDate(st.period_from, lang)} – {docDate(st.period_to, lang)}</div>
            {st.due_date && <div><b>{t.due}:</b> {docDate(st.due_date, lang)}</div>}
          </div>
        </header>
        <section>
          <div className="text-[10px] uppercase tracking-wider text-[#666]">{t.customer}</div>
          <div className="text-[14px] font-bold">{c?.name}</div>
          <div>{[c?.address, c?.city, c?.country].filter(Boolean).join(", ")}</div>
          {c?.tax_no && <div>{t.tax}: {c.tax_office ?? ""} {c.tax_no}</div>}
        </section>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left w-32`}>{t.waybills}</th><th className={`${cell} text-left`}>{t.job} · {t.patient} · {t.work}</th><th className={`${cell} text-right w-16`}>{t.qty}</th><th className={`${cell} text-right w-28`}>{t.amount}</th></tr></thead>
          <tbody>
            {(wbs ?? []).map((w) => (
              brief ? (
                <tr key={w.id as string}><td className={cell}><b>{wbNo(w.year as number, w.no as number)}</b><div className="text-[10px]">{docDate(w.ship_date as string, lang)}</div></td><td className={cell}>{w.job_count as number} {t.jobs}</td><td className={`${cell} text-right`}>{Number(w.unit_count)}</td><td className={`${cell} text-right font-semibold`}>{docMoney(w.total as number, st.currency, lang)}</td></tr>
              ) : (
                (byWb.get(w.id as string) ?? []).map((j, k, arr) => {
                  const items = j.job_items.filter((i) => i.amount > 0).sort((a, b) => a.sort - b.sort);
                  return (
                    <tr key={j.id} className="break-inside-avoid">
                      {k === 0 && <td className={cell} rowSpan={arr.length}><b>{wbNo(w.year as number, w.no as number)}</b><div className="text-[10px]">{docDate(w.ship_date as string, lang)}</div><div className="text-[10px] text-[#555]">{t.subtotal}: {docMoney(w.total as number, st.currency, lang)}</div></td>}
                      <td className={cell}><b>#{j.no}</b>{j.patient ? ` · ${j.patient}` : ""}<div className="text-[10px]">{items.map((i) => i.name).join(", ")}</div></td>
                      <td className={`${cell} text-right`}>{items.reduce((a, i) => a + Number(i.qty), 0)}</td>
                      <td className={`${cell} text-right`}>{docMoney(j.total, st.currency, lang)}</td>
                    </tr>
                  );
                })
              )
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} className={`${cell} text-right font-bold`}>{st.job_count} {t.jobs}</td><td className={`${cell} text-right font-bold`}>{Number(st.unit_count)}</td><td className={`${cell} text-right text-[14px] font-bold`}>{docMoney(st.total, st.currency, lang)}</td></tr>
          </tfoot>
        </table>
        {st.note && <p><b>{t.note}:</b> {st.note}</p>}
        {(banks ?? []).length > 0 && <div className="text-[10.5px]"><b>{t.bank}:</b>{(banks ?? []).map((b, i) => <div key={i}>{b.value as string}</div>)}</div>}
        <p className="text-center text-[10px] text-[#555] pt-4">{t.thanks}</p>
      </div>
    </main>
  );
}
