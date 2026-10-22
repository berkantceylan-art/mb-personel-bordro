import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { partyLedger } from "@/lib/fin-data";
import { PARTY_KIND, dateOk, fmt, type Party } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Cari kart ekstresi (A4) — tedarikçi / müşteri / diğer cariler. ?bas=YYYY-MM-DD&bit=YYYY-MM-DD */
export default async function PartyStatementPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if (!["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 1)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("fin_parties").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as Party;
  const from = dateOk(sp.bas);
  const to = dateOk(sp.bit);
  const [led, { data: co }] = await Promise.all([
    partyLedger(p, from, to),
    supabase.from("companies").select("name, address, phone, tax_office, tax_no").eq("id", s.companyId).maybeSingle(),
  ]);
  const company = co as { name: string; address: string | null; phone: string | null; tax_office: string | null; tax_no: string | null } | null;
  const m = (v: number) => fmt(v, p.currency);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const cell = "border border-[#9AA7B4] px-2 py-1 align-top";
  // Pozitif bakiye: cari bize borçlu; negatif: biz cariye borçluyuz
  const balText = led.balance > 0 ? "Cari bize borçlu" : led.balance < 0 ? (p.kind === "supplier" ? "Tedarikçiye borcumuz" : "Biz cariye borçluyuz") : "Bakiye kapalı";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/finans/cariler/${p.id}`} className="font-semibold text-[#0A3D73]">← Cari kart</Link>
        <form className="flex items-center gap-2 text-sm">
          <input type="date" name="bas" defaultValue={from ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to ?? ""} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Bitiş" />
          <button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">Uygula</button>
        </form>
        <PrintButton />
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div className="text-[11px]">
            <div className="text-[16px] font-bold">{company?.name ?? "MB DENTAL"}</div>
            {company?.address && <div>{company.address}</div>}
            {company?.tax_no && <div>VD: {company.tax_office ? `${company.tax_office} · ` : ""}{company.tax_no}</div>}
            <div className="mt-1 font-semibold text-[12px]">Cari hesap ekstresi</div>
          </div>
          <div className="text-right text-[11px]">
            <div className="font-bold text-[13px]">{p.name}</div>
            <div>{PARTY_KIND[p.kind] ?? p.kind} · {p.currency}</div>
            {[p.address, p.city, p.country].filter(Boolean).join(", ")}
            {p.tax_no && <div>VD: {p.tax_office ? `${p.tax_office} · ` : ""}{p.tax_no}</div>}
            <div>Dönem: {from ? formatDate(from) : "başlangıç"} – {formatDate(to ?? today)}</div>
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#EEF2F6]">
              <th className={`${cell} text-left w-24`}>Tarih</th><th className={`${cell} text-left`}>Açıklama</th>
              <th className={`${cell} text-right`}>Borç</th><th className={`${cell} text-right`}>Alacak</th><th className={`${cell} text-right`}>Bakiye</th>
            </tr>
          </thead>
          <tbody>
            {led.rows.map((r) => (
              <tr key={r.key} className={r.key === "devir" ? "font-semibold" : ""}>
                <td className={`${cell} whitespace-nowrap`}>{r.date ? formatDate(r.date) : ""}</td>
                <td className={cell}>{r.label}{r.sub && <span className="block text-[10px] text-[#55606B]">{r.sub}</span>}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{r.debit ? m(r.debit) : ""}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{r.credit ? m(r.credit) : ""}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{m(r.balance)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className={`${cell} text-right`}>Toplam</td>
              <td className={`${cell} text-right whitespace-nowrap`}>{m(led.debit)}</td>
              <td className={`${cell} text-right whitespace-nowrap`}>{m(led.credit)}</td>
              <td className={`${cell} text-right whitespace-nowrap`}>{m(led.balance)}</td>
            </tr>
          </tbody>
        </table>
        <div className="self-end text-[13px] font-bold border-2 border-black px-3 py-1.5">{balText}: {fmt(Math.abs(led.balance), p.currency)}</div>
        <footer className="text-[9px] text-[#55606B] border-t border-[#B5C0CB] pt-1">Bu ekstre {new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} tarihinde MB Dental ERP ile hazırlanmıştır.</footer>
      </div>
    </main>
  );
}
