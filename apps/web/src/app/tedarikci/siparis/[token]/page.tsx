import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/jobs";
import { PrintButton } from "@/components/PrintButton";
import { SupplierActions } from "./SupplierActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sipariş", robots: { index: false, follow: false }, referrer: "no-referrer" };

type View = {
  no: string; status: string; order_date: string; expected_date: string | null; currency: string; subtotal: number; vat_total: number; total: number; note: string | null;
  seen_at: string | null; ack_at: string | null; ack_by: string | null; promised_date: string | null; sup_note: string | null; shipped_at: string | null; waybill: string | null; declined_at: string | null;
  supplier: { name: string; contact: string | null } | null;
  company: { name: string; address: string; phone: string | null; email: string | null; tax_no: string | null; tax_office: string | null } | null;
  warehouse: string | null;
  lines: Array<{ name: string; code: string | null; qty: number; unit: string; unit_price: number; vat_rate: number; amount: number; received_qty: number }>;
};
const d = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "");

/** Tedarikçiye giden sipariş sayfası: bağlantıyla (hesapsız) ya da tedarikçi portalından açılır */
export default async function SupplierOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("sup_order_view", { p_token: token });
  const v = data as View | null;
  if (!v) notFound();
  const open = ["approved", "sent", "partial"].includes(v.status);
  const qty = (n: number) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

  return (
    <main className="mx-auto max-w-[900px] p-4 md:p-8 flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-4 rounded-[16px] bg-white border border-line p-5 print:border-0 print:p-0">
        <div className="flex-1 min-w-[240px]">
          <p className="text-xs font-semibold text-muted">SATIN ALMA SİPARİŞİ</p>
          <h1 className="font-display text-2xl font-bold text-brand-800">{v.no}</h1>
          <p className="text-sm text-muted">Tarih {d(v.order_date)}{v.expected_date ? ` · istenen teslim ${d(v.expected_date)}` : ""}</p>
        </div>
        <div className="text-sm text-right">
          <p className="font-bold">{v.company?.name}</p>
          {v.company?.address && <p className="text-muted">{v.company.address}</p>}
          <p className="text-muted">{[v.company?.phone, v.company?.email].filter(Boolean).join(" · ")}</p>
          {v.company?.tax_no && <p className="text-muted">{v.company.tax_office} VD · {v.company.tax_no}</p>}
        </div>
      </header>

      <section className="rounded-[16px] bg-white border border-line p-5 flex flex-col gap-1 text-sm print:border-0 print:p-0">
        <p><span className="text-muted">Tedarikçi:</span> <b>{v.supplier?.name}</b>{v.supplier?.contact ? ` · ${v.supplier.contact}` : ""}</p>
        {v.warehouse && <p><span className="text-muted">Teslim yeri:</span> {v.company?.name} · {v.warehouse}</p>}
        {v.status === "cancelled" && <p className="mt-2 rounded-lg px-3 py-2 bg-bad-bg text-bad font-semibold">Bu sipariş iptal edildi.</p>}
      </section>

      <section className="rounded-[16px] bg-white border border-line overflow-x-auto print:border-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Kalem</th><th className="p-3 text-right">Miktar</th><th className="p-3 text-right">Birim fiyat</th><th className="p-3 text-right">KDV</th><th className="p-3 text-right">Tutar</th></tr></thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={i} className="border-t border-[#EEF2F6]">
                <td className="p-3">{l.name}{l.code ? <span className="block text-xs text-muted">Kod {l.code}</span> : null}</td>
                <td className="p-3 text-right">{qty(l.qty)} {l.unit}</td>
                <td className="p-3 text-right num">{money(l.unit_price, v.currency)}</td>
                <td className="p-3 text-right">%{Number(l.vat_rate)}</td>
                <td className="p-3 text-right num font-semibold">{money(l.amount, v.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line"><td colSpan={4} className="p-3 text-right text-muted">KDV hariç</td><td className="p-3 text-right num">{money(v.subtotal, v.currency)}</td></tr>
            <tr><td colSpan={4} className="p-3 text-right text-muted">KDV</td><td className="p-3 text-right num">{money(v.vat_total, v.currency)}</td></tr>
            <tr><td colSpan={4} className="p-3 text-right font-bold">Toplam</td><td className="p-3 text-right num font-bold">{money(v.total, v.currency)}</td></tr>
          </tfoot>
        </table>
      </section>
      {v.note && <p className="text-sm rounded-[12px] bg-white border border-line p-4"><b>Not:</b> {v.note}</p>}

      <section className="rounded-[16px] bg-white border border-line p-5 flex flex-col gap-3 print:hidden">
        <h2 className="font-display font-bold text-brand-800">Sipariş durumu</h2>
        <ul className="text-sm flex flex-col gap-1">
          <li>{v.ack_at ? "✅" : "⬜"} Sipariş alındı{v.ack_at ? ` · ${d(v.ack_at)}${v.promised_date ? ` · termin ${d(v.promised_date)}` : ""}${v.ack_by ? ` · ${v.ack_by}` : ""}` : ""}</li>
          {v.declined_at && <li>⚠️ Karşılanamıyor bildirildi · {d(v.declined_at)}</li>}
          <li>{v.shipped_at ? "✅" : "⬜"} Sevk edildi{v.shipped_at ? ` · ${d(v.shipped_at)}${v.waybill ? ` · irsaliye ${v.waybill}` : ""}` : ""}</li>
          {v.sup_note && <li className="text-muted">Notunuz: {v.sup_note}</li>}
        </ul>
        {open && <SupplierActions token={token} acked={!!v.ack_at} shipped={!!v.shipped_at} expected={v.expected_date} />}
      </section>
      <div className="flex gap-3 print:hidden"><PrintButton /></div>
    </main>
  );
}
