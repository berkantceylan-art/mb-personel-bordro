import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, poNo } from "@/lib/orders";
import { LINE_STATUS, MATCH_STATUS, p3Error, type MatchLine, type MatchRow } from "@/lib/purchasing3";
import { acceptMatch, unlinkInvoice } from "@/lib/purchasing3-actions";
import { rcvNo } from "@/lib/barcode";

export const dynamic = "force-dynamic";

const q = (n: number) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** Tek siparişin 3'lü eşleştirmesi: satır satır sipariş / gelen / faturalanan */
export default async function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const sb = await createClient();
  const [{ data: o }, { data: ml, error }, { data: invs }, { data: rcvs }, { data: list }] = await Promise.all([
    sb.from("pur_orders").select("id, year, no, status, currency, order_date, expected_date, total, match_ok_at, match_ok_note, fin_parties(name)").eq("id", id).maybeSingle(),
    sb.rpc("pur_match_lines", { p_po: id }),
    sb.from("inv_invoices").select("id, doc_no, invoice_date, total, currency, status, type").eq("po_id", id).neq("status", "cancelled").order("invoice_date"),
    sb.from("stk_receipts").select("id, year, no, status, supplier_doc, confirmed_at, created_at").eq("po_id", id).neq("status", "cancelled").order("created_at"),
    sb.rpc("pur_match_list", { p_days: 3650 }),
  ]);
  if (!o) notFound();
  const lines = (ml ?? []) as MatchLine[];
  const row = ((list ?? []) as MatchRow[]).find((r) => r.po_id === id);
  const cur = o.currency as string;
  const party = (o.fin_parties as unknown as { name: string } | null)?.name ?? "";
  const issues = lines.filter((l) => ["over_billed", "price_up", "extra"].includes(l.status));
  const canAccept = (s.modules.purchases ?? 0) >= 3 || (s.modules.finance ?? 0) >= 3;

  return (
    <>
      <PageHeader title={`${poNo(o.year, o.no)} · eşleştirme`} subtitle={`${party} · ${formatDate(o.order_date)} · ${money(o.total, cur)}`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/alis/siparisler/${id}`} className="text-brand-700">Siparişi aç</Link><Link href="/satinalma/eslestirme" className="text-brand-700">← Eşleştirme</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{p3Error(error.message)}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${PO_STATUS[o.status]?.[1]}`}>{PO_STATUS[o.status]?.[0]}</span>
          {row && <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${MATCH_STATUS[row.match]?.[1]}`}>{MATCH_STATUS[row.match]?.[0]}</span>}
        </div>

        {row && (
          <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {([["Sipariş", row.ordered], ["Teslim alınan", row.received], ["Faturalanan", row.invoiced], ["Fark (fatura − teslim)", row.diff]] as const).map(([l, v], i) => (
              <div key={l} className={`rounded-[16px] border bg-white p-4 ${i === 3 && row.invoices && Math.abs(v) > 100 ? (v > 0 ? "border-bad" : "border-brand-600") : "border-line"}`}>
                <div className="text-xs font-semibold text-muted">{l}</div>
                <div className={`font-display text-2xl font-bold tabular-nums ${i === 3 && v > 100 ? "text-bad" : ""}`}>{i === 3 && v > 0 ? "+" : ""}{money(v, cur)}</div>
                <div className="text-[11px] text-muted">KDV hariç</div>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr className="text-xs text-muted"><th className="p-2" /><th colSpan={2} className="p-2 text-center border-l border-line">1 · Sipariş</th><th className="p-2 text-center border-l border-line">2 · Mal kabul</th><th colSpan={3} className="p-2 text-center border-l border-line">3 · Fatura</th><th className="p-2 border-l border-line" /></tr>
              <tr className="text-left text-xs text-muted"><th className="p-3">Kalem</th><th className="p-3 text-right border-l border-line">Miktar</th><th className="p-3 text-right">Birim fiyat</th><th className="p-3 text-right border-l border-line">Gelen</th><th className="p-3 text-right border-l border-line">Miktar</th><th className="p-3 text-right">Birim fiyat</th><th className="p-3 text-right">Tutar</th><th className="p-3 border-l border-line">Sonuç</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const pd = l.inv_price != null && l.po_price > 0 ? Math.round(((l.inv_price - l.po_price) / l.po_price) * 1000) / 10 : null;
                const bad = ["over_billed", "price_up", "extra"].includes(l.status);
                return (
                  <tr key={l.line_id ?? `x${i}`} className={`border-t border-[#EEF2F6] ${bad ? "bg-bad-bg/40" : ""}`}>
                    <td className="p-3">{l.name}{l.two_way && <span className="block text-[11px] text-muted">Hizmet / kartsız — sipariş miktarıyla karşılaştırılır</span>}</td>
                    <td className="p-3 text-right border-l border-line">{l.line_id ? `${q(l.ordered)} ${l.unit}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums">{l.line_id ? money(l.po_price, cur) : "—"}</td>
                    <td className={`p-3 text-right border-l border-line ${l.line_id && l.received < l.ordered && !l.two_way ? "text-warn font-semibold" : ""}`}>{l.line_id ? (l.two_way ? "—" : q(l.received)) : "—"}</td>
                    <td className={`p-3 text-right border-l border-line ${l.status === "over_billed" ? "text-bad font-semibold" : ""}`}>{l.invoiced ? q(l.invoiced) : "—"}</td>
                    <td className={`p-3 text-right tabular-nums ${l.status === "price_up" ? "text-bad font-semibold" : ""}`}>{l.inv_price != null ? money(l.inv_price, cur) : "—"}{pd != null && pd !== 0 && <span className={`block text-[11px] ${pd > 0 ? "text-bad" : "text-ok"}`}>{pd > 0 ? "+" : ""}%{pd}</span>}</td>
                    <td className="p-3 text-right tabular-nums">{l.inv_amount ? money(l.inv_amount, cur) : "—"}</td>
                    <td className="p-3 border-l border-line"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${LINE_STATUS[l.status]?.[1]}`}>{LINE_STATUS[l.status]?.[0] ?? l.status}</span></td>
                  </tr>
                );
              })}
              {!lines.length && <tr><td colSpan={8} className="p-8 text-center text-muted">Satır yok.</td></tr>}
            </tbody>
          </table>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display font-bold text-brand-800">Mal kabuller</h2>
            {((rcvs ?? []) as { id: string; year: number; no: number; status: string; supplier_doc: string | null; confirmed_at: string | null; created_at: string }[]).map((r) => (
              <Link key={r.id} href={`/stok/mal-kabul/${r.id}`} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-[#F4F8FC]">
                <span className="font-mono font-semibold text-brand-700">{rcvNo(r)}</span>
                <span className="text-muted">{formatDate(r.confirmed_at ?? r.created_at)}{r.supplier_doc ? ` · irsaliye ${r.supplier_doc}` : ""}</span>
                <span className="ml-auto text-xs">{r.status === "confirmed" ? "Onaylı" : "Açık"}</span>
              </Link>
            ))}
            {!rcvs?.length && <p className="text-sm text-muted">Okutmalı mal kabul yok{lines.some((l) => l.received > 0) ? " (sipariş ekranından teslim alındı)" : ""}.</p>}
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display font-bold text-brand-800">Bağlı alış faturaları</h2>
            {((invs ?? []) as { id: string; doc_no: string | null; invoice_date: string; total: number; currency: string; status: string; type: string }[]).map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5">
                <Link href={`/fatura/${v.id}`} className="font-semibold text-brand-700">{v.doc_no || "Taslak"}</Link>
                <span className="text-muted">{formatDate(v.invoice_date)}{v.type === "return" ? " · iade" : ""}{v.status === "draft" ? " · taslak" : ""}</span>
                <span className="ml-auto tabular-nums">{money(v.total, v.currency)}</span>
                {(s.modules.purchases ?? 0) >= 2 && <form action={unlinkInvoice}><input type="hidden" name="invoice_id" value={v.id} /><input type="hidden" name="po_id" value={id} /><ConfirmSubmit label="Bağlantıyı kaldır" question="Fatura bu siparişten ayrılsın mı?" className="text-xs font-semibold text-muted" /></form>}
              </div>
            ))}
            {!invs?.length && <p className="text-sm text-muted">Henüz fatura bağlı değil. <Link href="/satinalma/eslestirme#baglanmamis" className="font-semibold text-brand-700">Bağlanmamış faturalar</Link></p>}
          </section>
        </div>

        {row && (row.match === "diff" || row.match === "accepted") && (
          <section className={`rounded-[16px] border p-4 flex flex-col gap-2 ${row.match === "accepted" ? "border-warn bg-warn-bg" : "border-bad bg-bad-bg"}`}>
            <h2 className="font-display font-bold text-brand-800">{row.match === "accepted" ? "Fark kabul edildi" : `${issues.length} satırda fark var`}</h2>
            {row.match === "accepted" ? (
              <>
                <p className="text-sm">{o.match_ok_note}{o.match_ok_at ? ` · ${formatDate(o.match_ok_at)}` : ""}</p>
                {canAccept && <form action={acceptMatch}><input type="hidden" name="po_id" value={id} /><input type="hidden" name="ok" value="0" /><PendingSubmit className="h-9 px-3 rounded-[10px] border border-line bg-white text-sm font-semibold">Kabulü geri al</PendingSubmit></form>}
              </>
            ) : (
              <>
                <p className="text-sm">Tedarikçiden düzeltme (iade / fiyat farkı faturası) isteyin ya da fark haklıysa gerekçesiyle kabul edin. Kabul sonrası fatura değişirse eşleştirme yeniden &quot;fark var&quot; olur.</p>
                {canAccept ? (
                  <form action={acceptMatch} className="flex flex-wrap gap-2">
                    <input type="hidden" name="po_id" value={id} />
                    <input name="note" required maxLength={300} placeholder="Gerekçe (ör. hammadde zammı, tedarikçiyle anlaşıldı)" className="h-10 flex-1 min-w-[260px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm bg-white" />
                    <PendingSubmit className="h-10 px-4 rounded-[10px] bg-warn text-white text-sm font-semibold">Farkı kabul et</PendingSubmit>
                  </form>
                ) : <p className="text-xs text-muted">Farkı satın alma ya da finans yöneticisi kabul edebilir.</p>}
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
