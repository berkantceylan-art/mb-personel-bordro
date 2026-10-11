import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/portal/PrintButton";
import { fmtMoney } from "@/lib/portal-account-ui";
import { formatDate, portalContext, portalLocale } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Invoice" };

const L = {
  tr: { title: "FATURA", sub: "Aylık toplu fatura", no: "No", date: "Tarih", period: "Dönem", due: "Son ödeme", wb: "İrsaliye", job: "İş", patient: "Hasta", work: "Yapılan iş", amount: "Tutar", total: "Genel toplam", jobs: "iş", bank: "Banka bilgileri", back: "Hesabım" },
  en: { title: "INVOICE", sub: "Monthly invoice", no: "No", date: "Date", period: "Period", due: "Due date", wb: "Delivery note", job: "Case", patient: "Patient", work: "Work", amount: "Amount", total: "Total", jobs: "cases", bank: "Bank details", back: "My account" },
  fr: { title: "FACTURE", sub: "Facture mensuelle", no: "N°", date: "Date", period: "Période", due: "Échéance", wb: "Bon de livraison", job: "Cas", patient: "Patient", work: "Travail", amount: "Montant", total: "Total", jobs: "cas", bank: "Coordonnées bancaires", back: "Mon compte" },
};

/** Portal: klinik / hekim kendi aylık faturasını görür ve yazdırır */
export default async function PortalStatement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const supabase = await createClient();
  const { data: st } = await supabase.from("lab_statements").select("*").eq("id", id).maybeSingle();
  if (!st) notFound();
  const lang = (["tr", "en", "fr"].includes(st.lang) ? st.lang : locale) as "tr" | "en" | "fr";
  const t = L[lang];
  const [{ data: wbs }, { data: banks }] = await Promise.all([
    supabase.from("lab_waybills").select("id, year, no, ship_date, total").eq("statement_id", id).order("ship_date"),
    supabase.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const ids = (wbs ?? []).map((w) => w.id as string);
  const { data: jobs } = ids.length ? await supabase.from("jobs").select("id, no, patient, waybill_id, total, job_items(name, amount)").in("waybill_id", ids).order("no") : { data: [] };
  type J = { id: string; no: number; patient: string | null; waybill_id: string; total: number; job_items: { name: string; amount: number }[] };
  const cell = "border border-gypsum px-2 py-1 align-top";
  return (
    <>
      <div className="mb-4 flex items-center gap-3 print:hidden"><Link href="/portal/hesap?sekme=belgeler" className="text-sm font-semibold text-slate hover:text-navy">← {t.back}</Link><PrintButton label="PDF" /></div>
      <article className="mx-auto max-w-[190mm] rounded-3xl bg-white p-8 text-[12px] text-ink print:rounded-none print:p-0">
        <header className="flex justify-between gap-4 border-b-2 border-navy pb-3">
          <div><div className="text-lg font-bold text-navy">MB DENTAL</div><div className="text-xs text-slate">{t.sub}</div></div>
          <div className="text-right"><div className="text-xl font-bold">{t.title}</div><div>{t.no}: MB-{st.year}-{String(st.no).padStart(4, "0")}</div><div>{t.date}: {formatDate(st.issue_date, locale)}</div><div>{t.period}: {formatDate(st.period_from, locale)} – {formatDate(st.period_to, locale)}</div>{st.due_date && <div>{t.due}: {formatDate(st.due_date, locale)}</div>}</div>
        </header>
        <table className="mt-4 w-full border-collapse">
          <thead><tr className="bg-[#F3F6F9]"><th className={`${cell} text-left`}>{t.wb}</th><th className={`${cell} text-left`}>{t.job} · {t.patient} · {t.work}</th><th className={`${cell} text-right`}>{t.amount}</th></tr></thead>
          <tbody>
            {(wbs ?? []).flatMap((w) => ((jobs ?? []) as J[]).filter((j) => j.waybill_id === w.id).map((j, k) => (
              <tr key={j.id}><td className={cell}>{k === 0 ? <><b>İRS-{w.year as number}-{String(w.no).padStart(5, "0")}</b><div className="text-[10px]">{formatDate(w.ship_date as string, locale)}</div></> : null}</td><td className={cell}><b>#{j.no}</b>{j.patient ? ` · ${j.patient}` : ""}<div className="text-[10px] text-slate">{j.job_items.filter((i) => i.amount > 0).map((i) => i.name).join(", ")}</div></td><td className={`${cell} text-right`}>{fmtMoney(Number(j.total), st.currency, locale)}</td></tr>
            )))}
          </tbody>
          <tfoot><tr><td colSpan={2} className={`${cell} text-right font-bold`}>{st.job_count} {t.jobs} · {t.total}</td><td className={`${cell} text-right text-sm font-bold`}>{fmtMoney(Number(st.total), st.currency, locale)}</td></tr></tfoot>
        </table>
        {(banks ?? []).length > 0 && <div className="mt-4 text-[11px]"><b>{t.bank}:</b>{(banks ?? []).map((b, i) => <div key={i}>{b.value as string}</div>)}</div>}
      </article>
    </>
  );
}
