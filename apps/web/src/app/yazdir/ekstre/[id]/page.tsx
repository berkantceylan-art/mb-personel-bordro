import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { buildLedger, type LedgerJob, type LedgerPayment } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Cari hesap ekstresi (A4) — ?bas=YYYY-MM-DD&bit=YYYY-MM-DD */
export default async function StatementPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.bas ?? "") ? sp.bas! : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.bit ?? "") ? sp.bit! : null;
  const supabase = await createClient();
  const { data: c } = await supabase.from("lab_customers").select("id, name, currency, address, city, country, tax_office, tax_no, phone").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: jobs }, { data: pays }, { data: banks }] = await Promise.all([
    supabase.from("jobs").select("id, no, in_date, patient, total, status").eq("customer_id", id).limit(20000),
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref, note").eq("customer_id", id).limit(20000),
    supabase.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const led = buildLedger((jobs ?? []) as LedgerJob[], (pays ?? []) as LedgerPayment[], from, to);
  const cell = "border border-[#9AA7B4] px-2 py-1";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/hekimler/${c.id}`} className="font-semibold text-[#0A3D73]">← Hekim kartı</Link>
        <form className="flex items-center gap-2 text-sm">
          <input type="date" name="bas" defaultValue={from ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Bitiş" />
          <button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">Uygula</button>
        </form>
        <PrintButton />
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <div className="text-[16px] font-bold">MB DENTAL</div>
            <div className="text-[11px]">Cari hesap ekstresi</div>
          </div>
          <div className="text-right text-[11px]">
            <div className="font-bold text-[13px]">{c.name}</div>
            {[c.address, c.city, c.country].filter(Boolean).join(", ")}
            {c.tax_no && <div>VD: {c.tax_office ?? ""} · {c.tax_no}</div>}
            <div>Dönem: {from ? formatDate(from) : "başlangıç"} – {to ? formatDate(to) : formatDate(new Date().toISOString().slice(0, 10))}</div>
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left w-24`}>Tarih</th><th className={`${cell} text-left`}>Açıklama</th><th className={`${cell} text-right`}>Borç</th><th className={`${cell} text-right`}>Alacak</th><th className={`${cell} text-right`}>Bakiye</th></tr></thead>
          <tbody>
            {led.rows.map((r) => (
              <tr key={r.key}>
                <td className={cell}>{r.date ? formatDate(r.date) : ""}</td>
                <td className={cell}>{r.label}</td>
                <td className={`${cell} text-right`}>{r.debit ? money(r.debit, c.currency) : ""}</td>
                <td className={`${cell} text-right`}>{r.credit ? money(r.credit, c.currency) : ""}</td>
                <td className={`${cell} text-right`}>{money(r.balance, c.currency)}</td>
              </tr>
            ))}
            <tr className="font-bold"><td colSpan={2} className={`${cell} text-right`}>Toplam</td><td className={`${cell} text-right`}>{money(led.debit, c.currency)}</td><td className={`${cell} text-right`}>{money(led.credit, c.currency)}</td><td className={`${cell} text-right`}>{money(led.balance, c.currency)}</td></tr>
          </tbody>
        </table>
        {(banks ?? []).length > 0 && (
          <div className="text-[11px]"><b>Banka bilgileri:</b>{(banks ?? []).map((b, i) => <div key={i}>{b.value as string}</div>)}</div>
        )}
        <footer className="text-[9px] text-[#55606B] border-t border-[#B5C0CB] pt-1">Bu ekstre {new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} tarihinde MB Dental ERP ile hazırlanmıştır.</footer>
      </div>
    </main>
  );
}
