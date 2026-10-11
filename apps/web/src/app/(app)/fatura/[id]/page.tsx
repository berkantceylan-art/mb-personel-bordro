import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Money, Notice, Table, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { qty } from "@/lib/stock";
import { cancelInvoice, deleteInvoice, postInvoice, setEinvoiceStatus } from "@/lib/invoice-actions";
import { DIRECTION, EINV_STATUS, INV_STATUS, PROFILES, type InvLine, type Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

/** Fatura ayrıntısı: kes / iptal / yazdır / XML / e-fatura durumu / tahsilat */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("inv_invoices").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const inv = data as Invoice;
  const D = DIRECTION[inv.direction];
  const lvl = s.modules[D.module] ?? 0;
  if (lvl < 1 && (s.modules.finance ?? 0) < 1) redirect("/");
  const [{ data: lines }, { data: wh }, { data: bal }, { data: moves }, { data: ret }] = await Promise.all([
    supabase.from("inv_lines").select("*, stk_items(code, name, unit)").eq("invoice_id", id).order("sort"),
    inv.warehouse_id ? supabase.from("stk_warehouses").select("name").eq("id", inv.warehouse_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("fin_party_balances").select("balance, currency").eq("party_id", inv.party_id).maybeSingle(),
    supabase.from("stk_moves").select("id, qty, lot_no, kind, stk_items(name, unit)").eq("doc_type", "invoice").eq("doc_id", id).limit(200),
    inv.return_of ? supabase.from("inv_invoices").select("id, doc_no, no").eq("id", inv.return_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ls = (lines ?? []) as (InvLine & { stk_items: { code: string; name: string; unit: string } | null })[];
  const mv = (moves ?? []) as unknown as { id: number; qty: number; lot_no: string | null; kind: string; stk_items: { name: string; unit: string } | null }[];
  const draft = inv.status === "draft", posted = inv.status === "posted";
  const title = `${inv.type === "return" ? `${D.label} iadesi` : `${D.label} faturası`} ${inv.doc_no ?? `· taslak #${inv.no}`}`;
  const payKind = (inv.direction === "sale") === (inv.type === "invoice") ? "collection" : "payment";
  const party = bal as { balance: number; currency: string } | null;

  return (
    <>
      <PageHeader title={title} subtitle={`${inv.party_name ?? ""} · ${formatDate(inv.invoice_date)}${inv.due_date ? ` · vade ${formatDate(inv.due_date)}` : ""}`}
        actions={<Link href={`${D.base}/faturalar`} className="text-sm font-semibold text-brand-700">← {D.plural}</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={INV_STATUS[inv.status]?.[1]}>{INV_STATUS[inv.status]?.[0]}</Chip>
          <Chip tone="blue">{PROFILES[inv.profile] ?? inv.profile}</Chip>
          {inv.einvoice_status !== "none" && <Chip tone={EINV_STATUS[inv.einvoice_status]?.[1]}>e-Fatura: {EINV_STATUS[inv.einvoice_status]?.[0]}</Chip>}
          {inv.source === "jobs" && <Chip>Laboratuvar işlerinden</Chip>}
          {inv.source === "ubl" && <Chip>e-Fatura XML&apos;den</Chip>}
          {ret && <Link href={`/fatura/${(ret as { id: string }).id}`} className="text-sm text-brand-700 font-semibold">İade edilen: {(ret as { doc_no: string | null; no: number }).doc_no ?? `#${(ret as { no: number }).no}`}</Link>}
          {inv.cancel_reason && <span className="text-sm text-bad">İptal nedeni: {inv.cancel_reason}</span>}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <section className="bg-white border border-line rounded-[14px] p-4 grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-xs text-muted">{D.party}</span>
              <Link href={`/finans/cariler/${inv.party_id}`} className="block font-semibold text-brand-700">{inv.party_name}</Link>
              <span className="block text-muted">{[inv.party_tax_office, inv.party_tax_no].filter(Boolean).join(" · ") || "VKN / TCKN yok"}</span>
              <span className="block text-muted">{[inv.party_address, inv.party_district, inv.party_city].filter(Boolean).join(", ")}</span>
              {party && <span className="block mt-1">Cari bakiye: <b><Money v={party.balance} cur={party.currency} /></b> {Number(party.balance) > 0 ? "(bize borçlu)" : Number(party.balance) < 0 ? "(biz borçluyuz)" : ""}</span>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">ETTN</dt><dd className="num text-xs break-all">{inv.ettn}</dd>
              <dt className="text-muted">Para birimi</dt><dd>{inv.currency}{inv.currency !== "TRY" ? ` · kur ${Number(inv.rate).toLocaleString("tr-TR")}` : ""}</dd>
              <dt className="text-muted">Depo</dt><dd>{(wh as { name: string } | null)?.name ?? "—"}</dd>
              {!inv.affects_balance && <><dt className="text-muted">Bakiye</dt><dd className="text-xs">İş tutarları hekim bakiyesinde; faturadan yalnız KDV eklendi.</dd></>}
              {inv.note && <><dt className="text-muted">Not</dt><dd>{inv.note}</dd></>}
            </dl>
          </section>
          <section className="bg-white border border-line rounded-[14px] p-4 text-sm flex flex-col gap-1.5">
            <Row label="Brüt" v={fmt(inv.gross_total, inv.currency)} />
            {Number(inv.discount_total) > 0 && <Row label="İskonto" v={`−${fmt(inv.discount_total, inv.currency)}`} />}
            <Row label="Matrah" v={fmt(inv.subtotal, inv.currency)} />
            <Row label="KDV" v={fmt(inv.vat_total, inv.currency)} />
            {Number(inv.withholding_total) > 0 && <Row label="KDV tevkifatı" v={`−${fmt(inv.withholding_total, inv.currency)}`} />}
            <div className="flex justify-between border-t border-line pt-2 mt-1 text-lg font-bold"><span>Ödenecek</span><span className="num">{fmt(inv.total, inv.currency)}</span></div>
            {inv.currency !== "TRY" && <span className="text-xs text-muted text-right">≈ {fmt(Math.round(Number(inv.total) * Number(inv.rate)), "TRY")}</span>}
          </section>
        </div>

        <Table head={["#", "Ürün / hizmet", "Miktar", "Birim fiyat", "İsk.", "KDV", "Matrah", "Toplam"]} min={860}>
          {ls.map((l) => (
            <tr key={l.id}>
              <td className={`${td} text-muted`}>{l.sort}</td>
              <td className={td}>{l.name}<span className="block text-xs text-muted">{[l.stk_items ? `Stok: ${l.stk_items.code}` : l.lab_product_id ? "Protez" : "Stoksuz", l.seller_code && !l.stk_items ? `Kod ${l.seller_code}` : null, l.lot_no ? `Lot ${l.lot_no}` : null, Number(l.withholding_rate) ? `Tevkifat %${l.withholding_rate}${l.withholding_code ? ` (${l.withholding_code})` : ""}` : null].filter(Boolean).join(" · ")}</span></td>
              <td className={tdNum}>{qty(l.qty)} {l.unit}</td>
              <td className={tdNum}>{Number(l.unit_price).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}</td>
              <td className={tdNum}>{Number(l.discount_pct) ? `%${Number(l.discount_pct).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}` : ""}</td>
              <td className={tdNum}>%{Number(l.vat_rate)}</td>
              <td className={tdNum}><Money v={l.net} cur={inv.currency} /></td>
              <td className={tdNum}><Money v={l.total} cur={inv.currency} /></td>
            </tr>
          ))}
        </Table>

        <div className="flex flex-wrap gap-2">
          {draft && lvl >= 2 && (
            <>
              <form action={postInvoice}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="direction" value={inv.direction} /><PendingSubmit className={btnPrimary}>{inv.direction === "sale" ? "Faturayı kes" : "Faturayı işle"}</PendingSubmit></form>
              <Link href={`/fatura/${inv.id}/duzenle`} className={btnSecondary}>Düzenle</Link>
              <form action={deleteInvoice} className={btnSecondary}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="direction" value={inv.direction} /><ConfirmSubmit label="Taslağı sil" question="Taslak silinsin mi?" /></form>
            </>
          )}
          {!draft && <Link href={`/yazdir/fatura/${inv.id}`} className={btnSecondary}>Yazdır / PDF</Link>}
          {(inv.direction === "sale" || inv.source === "ubl") && <a href={`/api/fatura/${inv.id}/xml`} className={btnSecondary}>{inv.source === "ubl" ? "Orijinal XML" : "e-Fatura XML indir"}</a>}
          {posted && <Link href={`/finans/islem?tur=${payKind}&cari=${inv.party_id}&geri=/fatura/${inv.id}`} className={btnSecondary}>{payKind === "collection" ? "Tahsilat al" : "Ödeme yap"}</Link>}
          {posted && inv.type === "invoice" && lvl >= 2 && <Link href={`${D.base}/yeni?kaynak=${inv.id}&iade=1`} className={btnSecondary}>İade faturası</Link>}
          {posted && lvl >= 2 && <Link href={`${D.base}/yeni?kaynak=${inv.id}`} className={btnSecondary}>Kopyala</Link>}
        </div>

        {posted && inv.direction === "sale" && lvl >= 2 && (
          <form action={setEinvoiceStatus} className="bg-white border border-line rounded-[14px] p-4 grid gap-3 md:grid-cols-[200px_1fr_220px_auto] items-end">
            <input type="hidden" name="id" value={inv.id} /><input type="hidden" name="direction" value={inv.direction} />
            <label className="flex flex-col gap-1 text-sm font-semibold">e-Fatura durumu
              <select name="status" defaultValue={inv.einvoice_status} className={selectCls}>{Object.entries(EINV_STATUS).map(([k, [v]]) => <option key={k} value={k}>{k === "none" ? "Gönderilmeyecek" : v}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Not<input name="note" defaultValue={inv.einvoice_note ?? ""} maxLength={500} placeholder="Entegratör referansı, red nedeni…" className={inputCls} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Fatura no (entegratör verdiyse)<input name="doc_no" placeholder={inv.doc_no ?? ""} maxLength={40} className={`${inputCls} font-mono`} /></label>
            <PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit>
            <p className="md:col-span-4 text-xs text-muted">Entegratör bağlantısı kurulana kadar: XML&apos;i indirip entegratör portalına yükleyin, sonra “Gönderildi” işaretleyin. Bağlantı kurulunca bu adım otomatik olur.</p>
          </form>
        )}

        {mv.length > 0 && (
          <section className="text-sm">
            <h2 className="font-semibold mb-2">Stok hareketleri</h2>
            <ul className="flex flex-wrap gap-2">{mv.map((m) => <li key={m.id}><Chip tone={Number(m.qty) < 0 ? "red" : "green"}>{m.stk_items?.name}: {Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.stk_items?.unit}{m.lot_no ? ` · ${m.lot_no}` : ""}</Chip></li>)}</ul>
          </section>
        )}

        {posted && lvl >= 3 && (
          <form action={cancelInvoice} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={inv.id} /><input type="hidden" name="direction" value={inv.direction} />
            <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-60">İptal nedeni<input name="reason" maxLength={300} className={inputCls} /></label>
            <span className={btnSecondary}><ConfirmSubmit label="Faturayı iptal et" question="Cari, KDV ve stok hareketleri geri alınacak. Emin misiniz?" /></span>
          </form>
        )}
        {draft && <Notice tone="info">Taslak fatura cari bakiyeyi ve stoğu etkilemez; “{inv.direction === "sale" ? "Faturayı kes" : "Faturayı işle"}” deyince işlenir.</Notice>}
      </div>
    </>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{label}</span><span className="num">{v}</span></div>;
}
