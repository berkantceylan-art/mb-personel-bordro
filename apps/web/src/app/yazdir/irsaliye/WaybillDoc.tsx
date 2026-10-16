import { createClient } from "@/lib/supabase/server";
import { DOC, docDate, docMoney, wbNo } from "@/lib/waybill";

/** Tek sevk irsaliyesinin A4 gövdesi (tekli ve toplu yazdırmada ortak). lang verilmezse müşterinin dili */
export async function WaybillDoc({ id, companyId, lang: forced, price, breakAfter }: { id: string; companyId: string; lang?: string | null; price: boolean; breakAfter?: boolean }) {
  const supabase = await createClient();
  const { data: w } = await supabase.from("lab_waybills").select("*, lab_customers(name, address, city, country, tax_office, tax_no, phone, doc_lang)").eq("id", id).maybeSingle();
  if (!w) return null;
  const c = w.lab_customers as { name: string; address: string | null; city: string | null; country: string | null; tax_office: string | null; tax_no: string | null; phone: string | null; doc_lang: string | null } | null;
  const lang = ["tr", "en", "fr"].includes(forced ?? "") ? forced! : (c?.doc_lang ?? "tr");
  const t = DOC[lang] ?? DOC.tr!;
  const [{ data: jobs }, { data: co }] = await Promise.all([
    supabase.from("jobs").select("id, no, patient, doctor_name, total, shade, job_items(name, qty, unit_price, amount, sort)").eq("waybill_id", id).order("no"),
    supabase.from("companies").select("name, address, phone, tax_office, tax_no").eq("id", companyId).maybeSingle(),
  ]);
  const rows = (jobs ?? []) as { id: string; no: number; patient: string | null; doctor_name: string | null; total: number; shade: string | null; job_items: { name: string; qty: number; unit_price: number; amount: number; sort: number }[] }[];
  const cell = "border border-[#9AA7B4] px-2 py-1 align-top";
  return (
      <div className={`max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4 ${breakAfter ? "break-after-page" : ""}`}>
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex gap-3 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-12 h-12 object-contain" />
            <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[70mm]">{co?.address ?? ""}{co?.phone ? ` · ${co.phone}` : ""}</div>{co?.tax_no && <div className="text-[10px]">{t.tax}: {co.tax_office ?? ""} {co.tax_no}</div>}</div>
          </div>
          <div className="text-right">
            <div className="text-[17px] font-bold tracking-wide">{t.waybill}</div>
            <div className="text-[10px] text-[#444]">{t.page_sub_wb}</div>
            <div className="mt-1"><b>{t.no}:</b> {wbNo(w.year, w.no)}</div>
            <div><b>{t.date}:</b> {docDate(w.ship_date, lang)}</div>
          </div>
        </header>
        <section className="text-[11px]">
          <div className="text-[10px] uppercase tracking-wider text-[#666]">{t.customer}</div>
          <div className="text-[14px] font-bold">{c?.name}</div>
          <div>{[c?.address, c?.city, c?.country].filter(Boolean).join(", ")}</div>
          {c?.tax_no && <div>{t.tax}: {c.tax_office ?? ""} {c.tax_no}</div>}
        </section>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left w-14`}>{t.job}</th><th className={`${cell} text-left`}>{t.patient} / {t.doctor}</th><th className={`${cell} text-left`}>{t.work}</th><th className={`${cell} text-right w-12`}>{t.qty}</th>{price && <th className={`${cell} text-right w-28`}>{t.amount}</th>}</tr></thead>
          <tbody>
            {rows.map((j) => {
              const items = j.job_items.filter((i) => i.amount > 0).sort((a, b) => a.sort - b.sort);
              return (
                <tr key={j.id} className="break-inside-avoid">
                  <td className={`${cell} font-bold`}>#{j.no}</td>
                  <td className={cell}>{j.patient ?? "—"}{j.doctor_name && <div className="text-[10px] text-[#555]">{j.doctor_name}</div>}</td>
                  <td className={cell}>{items.map((i, k) => <div key={k}>{i.name}{price && i.qty > 1 ? <span className="text-[10px] text-[#555]"> · {docMoney(i.unit_price, w.currency, lang)}</span> : null}</div>)}{j.shade && <div className="text-[10px] text-[#555]">{t.shade}: {j.shade}</div>}</td>
                  <td className={`${cell} text-right`}>{items.map((i, k) => <div key={k}>{Number(i.qty)}</div>)}</td>
                  {price && <td className={`${cell} text-right font-semibold`}>{docMoney(j.total, w.currency, lang)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className={`${cell} text-right font-bold`}>{w.job_count} {t.jobs} · {Number(w.unit_count)} {t.units}</td><td className={cell} />{price && <td className={`${cell} text-right text-[13px] font-bold`}>{docMoney(w.total, w.currency, lang)}</td>}</tr>
          </tfoot>
        </table>
        {w.note && <p><b>{t.note}:</b> {w.note}</p>}
        <div className="grid grid-cols-2 gap-8 pt-10 text-center text-[11px]">
          <div className="border-t border-black pt-1">{t.delivered_by}</div>
          <div className="border-t border-black pt-1">{t.received_by}{w.delivered_to && <div className="font-semibold">{w.delivered_to}</div>}{w.signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.signature} alt="" className="mx-auto h-16 object-contain" />
          )}{w.delivered_at && <div className="text-[10px] text-[#555]">{new Date(w.delivered_at).toLocaleString(lang === "fr" ? "fr-FR" : lang === "en" ? "en-GB" : "tr-TR", { timeZone: "Europe/Istanbul" })}</div>}</div>
        </div>
      </div>
  );
}
