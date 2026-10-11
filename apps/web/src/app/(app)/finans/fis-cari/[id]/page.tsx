import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { cancelSlip, saveSlipOpening } from "@/lib/supplier-actions";
import { SlipForm } from "./SlipForm";

export const dynamic = "force-dynamic";

type L = { at: string; kind: string; txn_kind: string | null; doc: string | null; description: string | null; amount: number; ref: string };
const KIND: Record<string, string> = { payment: "Ödeme", collection: "Tahsilat", cheque_out: "Verilen çek / senet", cheque_pay: "Çek ödemesi", cheque_endorse: "Ciro edilen çek", cheque_in: "Alınan çek", purchase_invoice: "Alış faturası", purchase_return: "Alış iadesi", sale_invoice: "Satış faturası", sale_return: "Satış iadesi", opening: "Açılış", card_spend: "Kartla ödeme", transfer: "Virman", exchange: "Döviz", adjust: "Düzeltme" };
const f2 = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tek tedarikçi: fiş ekle, mal kabulleri fişe işle, fiş carisi ve fatura carisi hareketleri yan yana */
export default async function SupplierSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: pt }, { data: led, error }, { data: rc }, { data: slips }, { data: op }] = await Promise.all([
    supabase.from("fin_parties").select("id, name, currency, opening_balance").eq("id", id).maybeSingle(),
    supabase.rpc("sup_ledger", { p_party: id }),
    supabase.from("stk_receipts").select("id, year, no, supplier_doc, confirmed_at, add_to_stock").eq("party_id", id).eq("status", "confirmed").order("confirmed_at", { ascending: false }).limit(50),
    supabase.from("sup_slips").select("id, receipt_id, photo").eq("party_id", id).eq("cancelled", false),
    supabase.from("sup_slip_open").select("amount, as_of").eq("party_id", id).maybeSingle(),
  ]);
  if (!pt) notFound();
  const cur = pt.currency as string;
  const used = new Set(((slips ?? []) as { receipt_id: string | null }[]).map((x) => x.receipt_id).filter(Boolean));
  const photos = new Map(((slips ?? []) as { id: string; photo: string | null }[]).filter((x) => x.photo).map((x) => [x.id, x.photo!]));
  const waiting = ((rc ?? []) as { id: string; year: number; no: number; supplier_doc: string | null; confirmed_at: string }[]).filter((r) => !used.has(r.id));
  const amounts = await Promise.all(waiting.map(async (r) => (await supabase.rpc("sup_receipt_amount", { p_receipt: r.id })).data as number | null));
  const rows = (led ?? []) as L[];
  let slipBal = Number((op as { amount?: number } | null)?.amount ?? 0), offBal = Number(pt.opening_balance ?? 0);
  const lines = rows.map((r) => {
    if (r.kind === "slip") slipBal += Number(r.amount);
    else if (r.kind === "invoice" || r.kind === "opening") offBal += Number(r.amount);
    else { slipBal += Number(r.amount); offBal += Number(r.amount); }
    return { ...r, slipBal, offBal };
  });
  const B = ({ v }: { v: number }) => <span className={v < 0 ? "text-bad" : v > 0 ? "text-ok" : "text-muted"}>{f2(Math.abs(v))}{v < 0 ? " B" : v > 0 ? " A" : ""}</span>;

  return (
    <>
      <PageHeader title={`${pt.name} · fiş / fatura carisi`} subtitle={`Para birimi ${cur} · B: borcumuz, A: alacağımız`}
        actions={<span className="flex gap-3 text-sm font-semibold"><Link href="/finans/islem" className="text-brand-700">+ Ödeme gir</Link><Link href="/finans/cek-senet" className="text-brand-700">+ Çek / senet</Link></span>} />
      <div className={`${page} max-w-[1200px]`}>
        <Link href="/finans/fis-cari" className="text-sm font-semibold text-brand-700">← Fiş / fatura carisi</Link>
        {error && <Notice tone="bad">Supabase&apos;de 20270111000000_supplier_slips.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">Fiş carisi</span><b className="block text-2xl num"><B v={slipBal} /></b></div>
          <div className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">Fatura carisi (resmi)</span><b className="block text-2xl num"><B v={offBal} /></b></div>
          <div className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">Fark (fiş − fatura)</span><b className="block text-2xl num"><B v={slipBal - offBal} /></b><span className="text-xs text-muted">(−) faturası gelmemiş fiş tutarı</span></div>
        </div>
        <section className="rounded-[16px] border border-line bg-white p-4 md:p-5"><h2 className="mb-3 font-display text-lg font-bold">Fiş ekle</h2><SlipForm party={id} currency={cur} /></section>
        {!!waiting.length && (
          <section className="rounded-[16px] border border-line bg-white p-4 md:p-5">
            <h2 className="mb-1 font-display text-lg font-bold">Fişe işlenmemiş mal kabuller ({waiting.length})</h2>
            <p className="mb-3 text-xs text-muted">Tutar, okutulan sağlam adet × sipariş / kart fiyatıdır; fişteki tutarla düzeltip işleyin.</p>
            <ul className="flex flex-col gap-3">
              {waiting.map((r, i) => (
                <li key={r.id} className="rounded-[12px] border border-line p-3">
                  <Link href={`/stok/mal-kabul/${r.id}`} className="text-sm font-semibold text-brand-700">MK-{r.year}-{String(r.no).padStart(4, "0")}</Link> <span className="text-xs text-muted">{r.supplier_doc ?? ""} · {formatDate(r.confirmed_at.slice(0, 10))}</span>
                  <div className="mt-2"><SlipForm compact party={id} currency={cur} receipt={r.id} defDoc={r.supplier_doc ?? ""} defAmount={amounts[i] ? f2(amounts[i]!) : ""} /></div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="overflow-x-auto rounded-[16px] border border-line bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="p-3">Tarih</th><th className="p-3">Hareket</th><th className="p-3">Belge / açıklama</th><th className="p-3 text-right">Tutar</th><th className="p-3 text-right">Fiş carisi</th><th className="p-3 text-right">Fatura carisi</th><th className="p-3" /></tr></thead>
            <tbody>
              {(op as { amount?: number } | null)?.amount ? <tr className="border-b border-[#EEF2F6] bg-[#F7F9FC]"><td className="p-3" colSpan={4}>Fiş carisi açılışı</td><td className="p-3 text-right num"><B v={Number((op as { amount: number }).amount)} /></td><td /><td /></tr> : null}
              {lines.map((r, i) => (
                <tr key={i} className={`border-b border-[#EEF2F6] ${r.kind === "slip" ? "bg-[#FFFBEB]" : r.kind === "invoice" ? "bg-[#F5F3FF]" : ""}`}>
                  <td className="p-3 whitespace-nowrap">{formatDate(r.at)}</td>
                  <td className="p-3 font-semibold">{r.kind === "slip" ? "🧾 Fiş" : KIND[r.txn_kind ?? ""] ?? r.txn_kind}</td>
                  <td className="p-3">{[r.doc, r.description].filter(Boolean).join(" · ")}{r.kind === "slip" && photos.has(r.ref) && <a href={photos.get(r.ref)} target="_blank" rel="noopener" className="ml-2 text-xs font-semibold text-brand-700">foto</a>}</td>
                  <td className={`p-3 text-right num ${r.amount < 0 ? "text-bad" : "text-ok"}`}>{f2(r.amount)}</td>
                  <td className="p-3 text-right num">{r.kind === "invoice" || r.kind === "opening" ? <span className="text-[#C5D0DB]">—</span> : <B v={r.slipBal} />}</td>
                  <td className="p-3 text-right num">{r.kind === "slip" ? <span className="text-[#C5D0DB]">—</span> : <B v={r.offBal} />}</td>
                  <td className="p-3 text-right">{r.kind === "slip" && <form action={cancelSlip}><input type="hidden" name="id" value={r.ref} /><input type="hidden" name="party_id" value={id} /><button className="text-xs font-semibold text-bad">İptal</button></form>}</td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Hareket yok.</td></tr>}
            </tbody>
          </table>
        </section>
        {(s.modules.finance ?? 0) >= 2 && (
          <details className="rounded-[16px] border border-line bg-white p-4">
            <summary className="cursor-pointer font-semibold">Fiş carisi açılış bakiyesi</summary>
            <form action={saveSlipOpening} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="party_id" value={id} />
              <label className="flex flex-col gap-1">Tutar ({cur})<input name="amount" inputMode="decimal" defaultValue={(op as { amount?: number } | null)?.amount ? f2(Math.abs(Number((op as { amount: number }).amount))) : ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 num" /></label>
              <label className="flex flex-col gap-1">Yön<select name="side" defaultValue={Number((op as { amount?: number } | null)?.amount ?? 0) > 0 ? "them" : "us"} className="h-11 rounded-[10px] border border-[#D5DEE8] px-2"><option value="us">Biz borçluyuz</option><option value="them">Onlar borçlu</option></select></label>
              <label className="flex flex-col gap-1">Tarih<input type="date" name="as_of" defaultValue={(op as { as_of?: string } | null)?.as_of ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
              <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Kaydet</button>
            </form>
          </details>
        )}
      </div>
    </>
  );
}
