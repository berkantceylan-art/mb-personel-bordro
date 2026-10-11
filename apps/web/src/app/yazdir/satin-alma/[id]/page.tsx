import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { poNo } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Satın alma siparişi çıktısı (A4) — tedarikçiye gönderilir */
export default async function POPrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: o }, { data: lines }, { data: co }] = await Promise.all([
    supabase.from("pur_orders").select("*, fin_parties(name, address, city, tax_office, tax_no, phone, email)").eq("id", id).maybeSingle(),
    supabase.from("pur_order_lines").select("name, qty, unit, unit_price, vat_rate, amount").eq("order_id", id).order("sort"),
    supabase.from("companies").select("name, address, phone, email, tax_office, tax_no").eq("id", s.companyId).maybeSingle(),
  ]);
  if (!o) notFound();
  const p = o.fin_parties as { name: string; address: string | null; city: string | null; tax_office: string | null; tax_no: string | null; phone: string | null; email: string | null } | null;
  const cell = "border border-[#9AA7B4] px-2 py-1";
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11.5px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex gap-3"><Link href={`/alis/siparisler/${id}`} className="font-semibold text-[#0A3D73]">← Sipariş</Link><PrintButton /></div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[80mm]">{co?.address ?? ""}</div><div className="text-[10px]">{[co?.phone, co?.email].filter(Boolean).join(" · ")}</div>{co?.tax_no && <div className="text-[10px]">VD: {co.tax_office ?? ""} {co.tax_no}</div>}</div>
          <div className="text-right"><div className="text-[17px] font-bold">SATIN ALMA SİPARİŞİ</div><div><b>No:</b> {poNo(o.year, o.no)}</div><div><b>Tarih:</b> {formatDate(o.order_date)}</div>{o.expected_date && <div><b>İstenen teslim:</b> {formatDate(o.expected_date)}</div>}</div>
        </header>
        <section><div className="text-[10px] uppercase tracking-wider text-[#666]">Tedarikçi</div><div className="text-[14px] font-bold">{p?.name}</div><div>{[p?.address, p?.city].filter(Boolean).join(", ")}</div>{p?.tax_no && <div>VD: {p.tax_office ?? ""} {p.tax_no}</div>}</section>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left`}>Kalem</th><th className={`${cell} text-right`}>Miktar</th><th className={`${cell} text-right`}>Birim fiyat</th><th className={`${cell} text-right`}>KDV</th><th className={`${cell} text-right`}>Tutar</th></tr></thead>
          <tbody>{(lines ?? []).map((l, i) => <tr key={i}><td className={cell}>{l.name as string}</td><td className={`${cell} text-right`}>{Number(l.qty)} {l.unit as string}</td><td className={`${cell} text-right`}>{money(l.unit_price as number, o.currency)}</td><td className={`${cell} text-right`}>%{Number(l.vat_rate)}</td><td className={`${cell} text-right`}>{money(l.amount as number, o.currency)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={4} className={`${cell} text-right`}>Ara toplam</td><td className={`${cell} text-right`}>{money(o.subtotal, o.currency)}</td></tr>
            <tr><td colSpan={4} className={`${cell} text-right`}>KDV</td><td className={`${cell} text-right`}>{money(o.vat_total, o.currency)}</td></tr>
            <tr><td colSpan={4} className={`${cell} text-right font-bold`}>Genel toplam</td><td className={`${cell} text-right font-bold`}>{money(o.total, o.currency)}</td></tr>
          </tfoot>
        </table>
        {o.note && <p><b>Not:</b> {o.note}</p>}
        <div className="grid grid-cols-2 gap-8 pt-10 text-center"><div className="border-t border-black pt-1">Siparişi veren</div><div className="border-t border-black pt-1">Tedarikçi onayı</div></div>
      </div>
    </main>
  );
}
