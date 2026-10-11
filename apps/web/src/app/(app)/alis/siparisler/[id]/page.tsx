import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, poNo } from "@/lib/orders";
import { cancelPO, decidePO, invoicePO, receivePO, sentPO, submitPO } from "@/lib/order-actions";
import { POForm } from "../POForm";

export const dynamic = "force-dynamic";

/** Satın alma siparişi: düzenle (taslak) ya da takip */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.modules.purchases ?? 0;
  if (lvl < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const isNew = id === "yeni";
  const [{ data: o }, { data: lines }] = isNew ? [{ data: null }, { data: [] }] : await Promise.all([
    supabase.from("pur_orders").select("*, fin_parties(name, phone, email)").eq("id", id).maybeSingle(),
    supabase.from("pur_order_lines").select("id, item_id, name, qty, unit, unit_price, vat_rate, amount, received_qty").eq("order_id", id).order("sort"),
  ]);
  if (!isNew && !o) notFound();
  const ls = (lines ?? []) as { id: string; item_id: string | null; name: string; qty: number; unit: string; unit_price: number; vat_rate: number; amount: number; received_qty: number }[];
  const editable = isNew || (o?.status === "draft" && lvl >= 2);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  if (editable) {
    const [{ data: parties }, { data: items }, { data: whs }] = await Promise.all([
      supabase.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
      supabase.from("stk_items").select("id, code, name, unit, purchase_price, vat_rate").eq("is_active", true).order("name").limit(5000),
      supabase.from("stk_warehouses").select("id, name").eq("is_active", true).order("name"),
    ]);
    return (
      <>
        <PageHeader title={isNew ? "Yeni satın alma siparişi" : `${poNo(o!.year, o!.no)} · taslak`} subtitle={o?.reject_reason ? `Reddedildi: ${o.reject_reason}` : "Kalemleri stok kartından seçin; fiyat son alış fiyatından gelir."} actions={<Link href="/alis/siparisler" className="text-sm font-semibold text-brand-700">← Siparişler</Link>} />
        <div className="p-4 md:p-8 max-w-[1200px] flex flex-col gap-4">
          <POForm
            initial={{ id: o?.id, party_id: o?.party_id, order_date: o?.order_date ?? today, expected_date: o?.expected_date, currency: o?.currency, warehouse_id: o?.warehouse_id, note: o?.note, lines: ls.map((l) => ({ item_id: l.item_id ?? "", name: l.name, qty: String(Number(l.qty)).replace(".", ","), unit: l.unit, unit_price: (l.unit_price / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }), vat_rate: String(Number(l.vat_rate)) })) }}
            parties={(parties ?? []) as { id: string; name: string }[]} items={(items ?? []) as { id: string; code: string; name: string; unit: string; purchase_price: number | null; vat_rate: number | null }[]} warehouses={(whs ?? []) as { id: string; name: string }[]} />
          {o && <form action={cancelPO}><input type="hidden" name="id" value={o.id} /><ConfirmSubmit label="Siparişi iptal et" question="Sipariş iptal edilsin mi?" /></form>}
        </div>
      </>
    );
  }

  const p = o!.fin_parties as { name: string; phone: string | null; email: string | null } | null;
  const st = o!.status as string;
  return (
    <>
      <PageHeader title={`${poNo(o!.year, o!.no)} · ${p?.name ?? ""}`} subtitle={`${formatDate(o!.order_date)}${o!.expected_date ? ` · beklenen ${formatDate(o!.expected_date)}` : ""} · ${money(o!.total, o!.currency)}`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/yazdir/satin-alma/${o!.id}`} className="text-brand-700">Yazdır / PDF</Link><Link href="/alis/siparisler" className="text-brand-700">← Siparişler</Link></span>} />
      <div className="p-4 md:p-8 max-w-[1200px] flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${PO_STATUS[st]?.[1]}`}>{PO_STATUS[st]?.[0]}</span>
          {o!.invoice_id && <Link href={`/fatura/${o!.invoice_id}`} className="text-sm font-semibold text-brand-700">Alış faturası →</Link>}
          <span className="ml-auto flex flex-wrap gap-2">
            {st === "pending" && lvl >= 3 && <>
              <form action={decidePO}><input type="hidden" name="id" value={o!.id} /><input type="hidden" name="ok" value="1" /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-ok text-white text-sm font-semibold">Onayla</PendingSubmit></form>
              <form action={decidePO} className="flex gap-1"><input type="hidden" name="id" value={o!.id} /><input type="hidden" name="ok" value="0" /><input name="reason" placeholder="Red nedeni" className="h-10 w-40 rounded-[10px] border border-[#D5DEE8] px-2 text-sm" /><PendingSubmit className="h-10 px-3 rounded-[10px] border border-bad text-bad text-sm font-semibold">Reddet</PendingSubmit></form>
            </>}
            {st === "draft" && lvl >= 2 && <form action={submitPO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Onaya gönder</PendingSubmit></form>}
            {st === "approved" && lvl >= 2 && <form action={sentPO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Tedarikçiye gönderildi</PendingSubmit></form>}
            {["approved", "sent", "partial", "received"].includes(st) && lvl >= 2 && <form action={invoicePO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] border border-brand-600 text-brand-700 text-sm font-semibold">Alış faturasına dönüştür</PendingSubmit></form>}
            {["pending", "approved", "sent"].includes(st) && lvl >= 2 && <form action={cancelPO}><input type="hidden" name="id" value={o!.id} /><ConfirmSubmit label="İptal" question="Sipariş iptal edilsin mi?" className="h-10 px-3 text-sm font-semibold text-bad" /></form>}
          </span>
        </div>
        {p && (p.phone || p.email) && <p className="text-sm text-muted">Tedarikçi: {[p.phone, p.email].filter(Boolean).join(" · ")}</p>}
        <form action={receivePO} className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <input type="hidden" name="id" value={o!.id} />
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Kalem</th><th className="p-3 text-right">Sipariş</th><th className="p-3 text-right">Gelen</th><th className="p-3 text-right">Birim fiyat</th><th className="p-3 text-right">Tutar</th>{["approved", "sent", "partial"].includes(st) && <th className="p-3 w-32">Şimdi gelen</th>}</tr></thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.id} className="border-t border-[#EEF2F6]">
                  <td className="p-3">{l.name}<span className="block text-xs text-muted">KDV %{Number(l.vat_rate)}</span></td>
                  <td className="p-3 text-right">{Number(l.qty)} {l.unit}</td>
                  <td className={`p-3 text-right ${Number(l.received_qty) >= Number(l.qty) ? "text-ok font-semibold" : ""}`}>{Number(l.received_qty)}</td>
                  <td className="p-3 text-right num">{money(l.unit_price, o!.currency)}</td>
                  <td className="p-3 text-right num font-semibold">{money(l.amount, o!.currency)}</td>
                  {["approved", "sent", "partial"].includes(st) && <td className="p-3"><input type="hidden" name="line_id" value={l.id} /><input name={`rq_${l.id}`} inputMode="decimal" placeholder={String(Math.max(0, Number(l.qty) - Number(l.received_qty)))} className="h-9 w-full rounded-md border border-[#D5DEE8] px-2" /></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line"><td colSpan={4} className="p-3 text-right text-muted">KDV hariç / KDV</td><td className="p-3 text-right num">{money(o!.subtotal, o!.currency)} / {money(o!.vat_total, o!.currency)}</td>{["approved", "sent", "partial"].includes(st) && <td />}</tr>
              <tr><td colSpan={4} className="p-3 text-right font-bold">Toplam</td><td className="p-3 text-right num font-bold">{money(o!.total, o!.currency)}</td>{["approved", "sent", "partial"].includes(st) && <td className="p-3"><PendingSubmit className="h-9 w-full rounded-[10px] bg-ok text-white text-sm font-semibold">Teslim al</PendingSubmit></td>}</tr>
            </tfoot>
          </table>
        </form>
        {o!.note && <p className="text-sm"><b>Not:</b> {o!.note}</p>}
      </div>
    </>
  );
}
