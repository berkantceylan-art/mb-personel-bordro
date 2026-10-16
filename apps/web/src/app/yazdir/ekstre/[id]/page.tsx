import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { LANGS, docDate, docMoney } from "@/lib/waybill";
import { buildLedger, internalPays, type LedgerJob, type LedgerPayment } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const TXT: Record<string, Record<string, string>> = {
  tr: { title: "Cari hesap ekstresi", tax: "VD", period: "Dönem", start: "başlangıç", date: "Tarih", desc: "Açıklama", debit: "Borç", credit: "Alacak", balance: "Bakiye", total: "Toplam", bank: "Banka bilgileri", foot: "Bu ekstre {d} tarihinde MB Dental ERP ile hazırlanmıştır.", back: "← Hekim kartı", apply: "Uygula", due: "Ödenecek bakiye", adv: "Alacak bakiyesi" },
  fr: { title: "Relevé de compte", tax: "N° TVA", period: "Période", start: "début", date: "Date", desc: "Libellé", debit: "Débit", credit: "Crédit", balance: "Solde", total: "Total", bank: "Coordonnées bancaires", foot: "Relevé établi le {d} par MB Dental ERP.", back: "← Fiche client", apply: "Appliquer", due: "Solde à régler", adv: "Solde créditeur" },
  en: { title: "Statement of account", tax: "Tax ID", period: "Period", start: "start", date: "Date", desc: "Description", debit: "Debit", credit: "Credit", balance: "Balance", total: "Total", bank: "Bank details", foot: "Statement prepared on {d} by MB Dental ERP.", back: "← Customer card", apply: "Apply", due: "Balance due", adv: "Credit balance" },
};
const LOC: Record<string, string> = { tr: "tr-TR", fr: "fr-FR", en: "en-GB" };

/** Cari hesap ekstresi (A4) — ?bas=YYYY-MM-DD&bit=YYYY-MM-DD&dil=tr|fr|en (varsayılan: müşterinin belge dili) */
export default async function StatementPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string; dil?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.bas ?? "") ? sp.bas! : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.bit ?? "") ? sp.bit! : null;
  const supabase = await createClient();
  const { data: c } = await supabase.from("lab_customers").select("id, name, currency, address, city, country, tax_office, tax_no, phone, internal_book, internal_opening, internal_opening_date, doc_lang").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: jobs }, { data: pays }, { data: banks }] = await Promise.all([
    supabase.from("jobs").select("id, no, in_date, patient, total, status, delivered_at").eq("customer_id", id).limit(20000),
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref, note, book").eq("customer_id", id).limit(20000),
    supabase.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const ib = (c as { internal_book?: boolean }).internal_book === true;
  const lang = sp.dil && TXT[sp.dil] ? sp.dil : TXT[(c as { doc_lang?: string }).doc_lang ?? ""] ? (c as { doc_lang?: string }).doc_lang! : "tr";
  const t = TXT[lang]!;
  const m = (v: number) => docMoney(v, c.currency, lang);
  const d = (iso: string) => docDate(iso, lang);
  const qs = (l: string) => `?${new URLSearchParams({ ...(from ? { bas: from } : {}), ...(to ? { bit: to } : {}), dil: l })}`;
  const led = buildLedger((jobs ?? []) as LedgerJob[], internalPays((pays ?? []) as LedgerPayment[], ib), from, to, ib ? { amount: Number((c as { internal_opening?: number }).internal_opening ?? 0), date: (c as { internal_opening_date?: string | null }).internal_opening_date ?? null } : null, lang);
  const cell = "border border-[#9AA7B4] px-2 py-1";

  return (
    <main lang={lang} className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/hekimler/${c.id}`} className="font-semibold text-[#0A3D73]">{t.back}</Link>
        <form className="flex items-center gap-2 text-sm">
          <input type="date" name="bas" defaultValue={from ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Bitiş" />
          <input type="hidden" name="dil" value={lang} />
          <button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">{t.apply}</button>
        </form>
        <div className="flex rounded-lg border border-[#D5DEE8] overflow-hidden text-sm font-semibold" role="group" aria-label="Dil">
          {Object.entries(LANGS).map(([k, v]) => <Link key={k} href={qs(k)} className={`px-3 h-9 inline-flex items-center ${k === lang ? "bg-[#0A3D73] text-white" : "bg-white text-[#0A3D73]"}`}>{v}</Link>)}
        </div>
        <PrintButton />
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <div className="text-[16px] font-bold">MB DENTAL</div>
            <div className="text-[11px]">{t.title}</div>
          </div>
          <div className="text-right text-[11px]">
            <div className="font-bold text-[13px]">{c.name}</div>
            {[c.address, c.city, c.country].filter(Boolean).join(", ")}
            {c.tax_no && <div>{t.tax}: {lang === "tr" ? `${c.tax_office ?? ""} · ` : ""}{c.tax_no}</div>}
            <div>{t.period}: {from ? d(from) : t.start} – {to ? d(to) : d(new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10))}</div>
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left w-24`}>{t.date}</th><th className={`${cell} text-left`}>{t.desc}</th><th className={`${cell} text-right`}>{t.debit}</th><th className={`${cell} text-right`}>{t.credit}</th><th className={`${cell} text-right`}>{t.balance}</th></tr></thead>
          <tbody>
            {led.rows.map((r) => (
              <tr key={r.key}>
                <td className={cell}>{r.date ? d(r.date) : ""}</td>
                <td className={cell}>{r.label}</td>
                <td className={`${cell} text-right`}>{r.debit ? m(r.debit) : ""}</td>
                <td className={`${cell} text-right`}>{r.credit ? m(r.credit) : ""}</td>
                <td className={`${cell} text-right`}>{m(r.balance)}</td>
              </tr>
            ))}
            <tr className="font-bold"><td colSpan={2} className={`${cell} text-right`}>{t.total}</td><td className={`${cell} text-right`}>{m(led.debit)}</td><td className={`${cell} text-right`}>{m(led.credit)}</td><td className={`${cell} text-right`}>{m(led.balance)}</td></tr>
          </tbody>
        </table>
        <div className="self-end text-[13px] font-bold border-2 border-black px-3 py-1.5">{led.balance >= 0 ? t.due : t.adv}: {m(Math.abs(led.balance))}</div>
        {(banks ?? []).length > 0 && (
          <div className="text-[11px]"><b>{t.bank}:</b>{(banks ?? []).map((b, i) => <div key={i}>{b.value as string}</div>)}</div>
        )}
        <footer className="text-[9px] text-[#55606B] border-t border-[#B5C0CB] pt-1">{t.foot.replace("{d}", new Date().toLocaleString(LOC[lang], { timeZone: "Europe/Istanbul" }))}</footer>
      </div>
    </main>
  );
}
