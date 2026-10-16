import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, poNo, supStatus } from "@/lib/orders";
import { waLink } from "@/lib/wa";
import { supplierLink } from "@/lib/po-send";
import { CopyText } from "@/components/CopyText";
import { cancelPO, decidePO, invoicePO, manualSentPO, receivePO, resendPO, submitPO } from "@/lib/order-actions";
import { POForm } from "../POForm";
import { closePO } from "@/lib/purchasing-actions";
import { mrNo } from "@/lib/material";
import { setPOCategory } from "@/lib/purchasing3-actions";
import { setPOBilling } from "@/lib/supplier-portal-actions";
import { MONTHS } from "@/lib/purchasing3";

export const dynamic = "force-dynamic";

/** Satın alma siparişi: düzenle (taslak) ya da takip */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.modules.purchases ?? 0;
  if (lvl < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const isNew = id === "yeni";
  const canDraft = lvl >= 2 || (s.modules.stock ?? 0) >= 2;
  if (isNew && !canDraft) redirect("/alis/siparisler");
  const loadPO = async () => {
    const r = await supabase.from("pur_orders").select("*, fin_parties(name, phone, email, order_email, order_phone, contact_name)").eq("id", id).maybeSingle();
    return r.error ? supabase.from("pur_orders").select("*, fin_parties(name, phone, email)").eq("id", id).maybeSingle() : r;
  };
  const [{ data: o }, { data: lines }] = isNew ? [{ data: null }, { data: [] }] : await Promise.all([
    loadPO(),
    supabase.from("pur_order_lines").select("id, item_id, name, qty, unit, unit_price, vat_rate, amount, received_qty").eq("order_id", id).order("sort"),
  ]);
  if (!isNew && !o) notFound();
  const ls = (lines ?? []) as { id: string; item_id: string | null; name: string; qty: number; unit: string; unit_price: number; vat_rate: number; amount: number; received_qty: number }[];
  const editable = isNew || (o?.status === "draft" && canDraft);
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
          {o && <BudgetCard id={o.id} categoryId={o.category_id ?? null} canEdit={canDraft} />}
          {o && <form action={cancelPO}><input type="hidden" name="id" value={o.id} /><ConfirmSubmit label="Siparişi iptal et" question="Sipariş iptal edilsin mi?" /></form>}
        </div>
      </>
    );
  }

  const p = o!.fin_parties as { name: string; phone: string | null; email: string | null; order_email?: string | null; order_phone?: string | null; contact_name?: string | null } | null;
  const st = o!.status as string;
  const { data: rl } = await supabase.from("stk_request_lines").select("stk_requests(id, year, no, kind)").eq("po_id", o!.id);
  const reqLinks = [...new Map(((rl ?? []) as unknown as { stk_requests: { id: string; year: number; no: number; kind: string } | null }[]).filter((x) => x.stk_requests).map((x) => [x.stk_requests!.id, x.stk_requests!])).values()];
  const ss = supStatus(o!);
  const token = o!.supplier_token as string | undefined;
  const link = token ? supplierLink(token) : "";
  const supEmail = p?.order_email || p?.email || "";
  const supPhone = p?.order_phone || p?.phone || "";
  const msg = `${s.companyName} satın alma siparişi ${poNo(o!.year, o!.no)}: ${ls.length} kalem, toplam ${money(o!.total, o!.currency)}.${o!.expected_date ? ` İstenen teslim ${formatDate(o!.expected_date)}.` : ""} Görüntüleyip onaylamak için: ${link}`;
  const wa = token ? waLink(supPhone, msg) : null;
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
            {st === "draft" && canDraft && <form action={submitPO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Onaya gönder</PendingSubmit></form>}
            {["approved", "sent", "partial", "received"].includes(st) && lvl >= 2 && <form action={invoicePO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] border border-brand-600 text-brand-700 text-sm font-semibold">Alış faturasına dönüştür</PendingSubmit></form>}
            {["approved", "sent", "partial"].includes(st) && lvl >= 2 && <form action={closePO} className="flex gap-1"><input type="hidden" name="id" value={o!.id} /><input name="note" placeholder="Kapatma notu (ör. kalan gelmeyecek)" className="h-10 w-56 rounded-[10px] border border-[#D5DEE8] px-2 text-sm" /><ConfirmSubmit label="Eksik teslimle kapat" question="Sipariş kapatılsın mı? Kalan miktar artık beklenmez." className="h-10 px-3 rounded-[10px] border border-warn text-warn text-sm font-semibold" /></form>}
            {["pending", "approved", "sent"].includes(st) && lvl >= 2 && <form action={cancelPO}><input type="hidden" name="id" value={o!.id} /><ConfirmSubmit label="İptal" question="Sipariş iptal edilsin mi?" className="h-10 px-3 text-sm font-semibold text-bad" /></form>}
          </span>
        </div>
        {(o as { closed_short?: boolean }).closed_short && <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">Eksik teslimle kapatıldı{(o as { close_note?: string | null }).close_note ? `: ${(o as { close_note?: string | null }).close_note}` : ""}.</p>}
        {reqLinks.length > 0 && <p className="text-sm text-muted">Bağlı istekler: {reqLinks.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link href={`/stok/talepler/${r.id}`} className="font-mono font-semibold text-brand-700">{mrNo(r)}</Link></span>)} · mal gelince isteği açan kişiye bildirim gider.</p>}
        {p && (p.phone || p.email) && <p className="text-sm text-muted">Tedarikçi: {[p.contact_name, supPhone, supEmail].filter(Boolean).join(" · ")}</p>}
        {st === "pending" && <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">Satın alma onayı bekleniyor. Onaylanınca sipariş tedarikçiye e-posta{supPhone ? " ve WhatsApp" : ""} ile otomatik gider.</p>}
        {ss && token && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-bold text-brand-800">Tedarikçi</h2>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ss[1]}`}>{ss[0]}</span>
            </div>
            <ol className="grid gap-2 sm:grid-cols-4 text-sm">
              {([
                ["Gönderildi", o!.sent_at ? `${formatDate(o!.sent_at)}${o!.sent_via?.length ? ` · ${(o!.sent_via as string[]).map((v) => (v === "email" ? "e-posta" : v === "whatsapp" ? "WhatsApp" : "elle")).join(", ")}` : ""}` : null],
                ["Tedarikçi gördü", o!.sup_seen_at ? formatDate(o!.sup_seen_at) : null],
                [o!.sup_declined_at ? "Karşılayamıyor" : "Onayladı", o!.sup_declined_at ? formatDate(o!.sup_declined_at) : o!.sup_ack_at ? `${formatDate(o!.sup_ack_at)}${o!.sup_promised_date ? ` · termin ${formatDate(o!.sup_promised_date)}` : ""}${o!.sup_ack_by ? ` · ${o!.sup_ack_by}` : ""}` : null],
                ["Sevk etti", o!.sup_shipped_at ? `${formatDate(o!.sup_shipped_at)}${o!.sup_waybill ? ` · irsaliye ${o!.sup_waybill}` : ""}` : null],
              ] as const).map(([l, v]) => (
                <li key={l} className={`rounded-[12px] border p-3 ${v ? (l === "Karşılayamıyor" ? "border-bad/40 bg-bad-bg" : "border-ok/40 bg-ok-bg") : "border-line"}`}>
                  <span className="block text-xs font-semibold text-muted">{v ? "✓ " : ""}{l}</span>
                  <span className="block">{v ?? "—"}</span>
                </li>
              ))}
            </ol>
            {o!.sup_note && <p className="text-sm"><b>Tedarikçinin notu:</b> {o!.sup_note}</p>}
            {o!.send_error && o!.send_state !== "sent" && <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">Otomatik gönderim: {o!.send_error}</p>}
            {lvl >= 2 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <form action={resendPO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{o!.send_state === "sent" ? "Yeniden gönder" : "E-posta / WhatsApp gönder"}</PendingSubmit></form>
                {wa && <a href={wa} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center rounded-[10px] border border-[#25D366] text-[#128C4B] text-sm font-semibold">WhatsApp&apos;tan aç</a>}
                {supEmail && <a href={`mailto:${supEmail}?subject=${encodeURIComponent(`${s.companyName} satın alma siparişi ${poNo(o!.year, o!.no)}`)}&body=${encodeURIComponent(msg)}`} className="h-9 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">E-posta programında aç</a>}
                <CopyText text={link} label="Tedarikçi bağlantısını kopyala" />
                {o!.send_state !== "sent" && o!.send_state !== "manual" && <form action={manualSentPO}><input type="hidden" name="id" value={o!.id} /><PendingSubmit className="h-9 px-3 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">Telefonla / elle ilettim</PendingSubmit></form>}
                <span className="w-full text-xs text-muted">Tedarikçi bağlantıdan siparişi görür, &quot;aldım + termin&quot; ve &quot;sevk ettim + irsaliye no&quot; bildirir; size bildirim gelir. Tedarikçiye kalıcı kullanıcı tanımlamak için <Link href="/alis/tedarikci-kullanicilari" className="font-semibold underline">Tedarikçi kullanıcıları</Link>.</span>
              </div>
            )}
          </section>
        )}
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
        <BudgetCard id={o!.id} categoryId={o!.category_id ?? null} canEdit={canDraft && st !== "cancelled"} matchLink={["approved", "sent", "partial", "received", "invoiced"].includes(st) && (lvl >= 1 || (s.modules.finance ?? 0) >= 1)} />
      </div>
    </>
  );
}

type Bud = { category_id: string; category: string | null; month: number; budget: number | null; used: number; this: number; after: number; over: boolean } | null;

/** Gider türü + bu ayın bütçe durumu + eşleştirme bağlantısı */
async function BudgetCard({ id, categoryId, canEdit, matchLink }: { id: string; categoryId: string | null; canEdit: boolean; matchLink?: boolean }) {
  const supabase = await createClient();
  const [{ data: b, error }, { data: cats }] = await Promise.all([
    supabase.rpc("pur_budget_check", { p_po: id }),
    supabase.from("fin_categories").select("id, name").in("kind", ["expense", "stock"]).eq("is_active", true).order("name"),
  ]);
  if (error) return null; // 3. aşama SQL'i çalışmamışsa kart görünmez
  const bud = b as Bud;
  const pct = bud?.budget ? Math.round((bud.after / bud.budget) * 100) : 0;
  return (
    <section className={`rounded-[16px] border bg-white p-4 flex flex-wrap items-center gap-3 text-sm ${bud?.over ? "border-bad" : "border-line"}`}>
      <form action={setPOCategory} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <span className="font-semibold">Gider türü</span>
        <select name="category_id" defaultValue={categoryId ?? ""} disabled={!canEdit} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2 text-sm">
          <option value="">Otomatik ({bud?.category ?? "—"})</option>
          {((cats ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {canEdit && <PendingSubmit className="h-9 px-3 rounded-[10px] border border-line text-sm font-semibold">Kaydet</PendingSubmit>}
      </form>
      <BillingForm id={id} canEdit={canEdit} />
      {bud && (bud.budget != null ? (
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <span className="text-muted whitespace-nowrap">{MONTHS[bud.month - 1]} bütçesi</span>
          <span className="flex-1 h-2.5 rounded-full bg-[#EEF2F6] overflow-hidden"><span className={`block h-2.5 ${pct > 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
          <span className={`whitespace-nowrap font-semibold ${bud.over ? "text-bad" : ""}`}>{money(bud.after, "TRY")} / {money(bud.budget, "TRY")}{bud.over ? " · aşım" : ""}</span>
        </div>
      ) : <span className="text-muted">Bu gider türüne {MONTHS[bud.month - 1]} için bütçe girilmemiş. <Link href="/satinalma/butce" className="font-semibold text-brand-700">Bütçe</Link></span>)}
      {matchLink && <Link href={`/satinalma/eslestirme/${id}`} className="ml-auto font-semibold text-brand-700">3&apos;lü eşleştirme →</Link>}
    </section>
  );
}

/** Faturalı / faturasız (fişli) alım yöntemi */
async function BillingForm({ id, canEdit }: { id: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("pur_orders").select("billing").eq("id", id).maybeSingle();
  if (error || !data) return null; // portal SQL'i çalışmamışsa görünmez
  const b = (data as { billing: string }).billing;
  return (
    <form action={setPOBilling} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="font-semibold">Alım</span>
      <select name="billing" defaultValue={b} disabled={!canEdit} className={`h-9 rounded-[10px] border px-2 text-sm ${b === "slip" ? "border-warn bg-warn-bg text-warn" : "border-[#D5DEE8]"}`}>
        <option value="invoice">Faturalı</option>
        <option value="slip">Faturasız (fişli)</option>
      </select>
      {canEdit && <PendingSubmit className="h-9 px-3 rounded-[10px] border border-line text-sm font-semibold">Kaydet</PendingSubmit>}
    </form>
  );
}
