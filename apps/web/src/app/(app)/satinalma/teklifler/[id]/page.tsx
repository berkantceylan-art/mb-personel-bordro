import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { RFQ_STATUS, SUP_STATUS, rfqError, rfqNo } from "@/lib/rfq";
import { addRfqSupplier, awardRfq, cancelRfq, quoteInternal } from "@/lib/rfq-actions";
import { erpUrl } from "@/lib/po-send";
import { waLink } from "@/lib/wa";
import { RfqSend } from "./RfqSend";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teklif karşılaştırma" };

type Sup = { id: string; party_id: string; token: string; status: string; sent_at: string | null; viewed_at: string | null; quoted_at: string | null; delivery_days: number | null; valid_until: string | null; note: string | null; quoted_by: string | null;
  fin_parties: { name: string; email: string | null; order_email: string | null; phone: string | null; order_phone: string | null } | null };

/** Teklif karşılaştırma: kalem × tedarikçi tablosu, en ucuz işaretli, toplam / teslim süresi / puan; kazananı siparişe dönüştür */
export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sb = await createClient();
  const { data: r, error } = await sb.from("pur_rfqs").select("*").eq("id", id).maybeSingle();
  if (error) return <p className="m-6 text-sm text-bad bg-bad-bg rounded-lg p-3">{rfqError(error.message)}</p>;
  if (!r) notFound();
  const [{ data: ls }, { data: ss }, { data: parties }, { data: scores }] = await Promise.all([
    sb.from("pur_rfq_lines").select("id, name, qty, unit").eq("rfq_id", id).order("sort"),
    sb.from("pur_rfq_suppliers").select("id, party_id, token, status, sent_at, viewed_at, quoted_at, delivery_days, valid_until, note, quoted_by, fin_parties(name, email, order_email, phone, order_phone)").eq("rfq_id", id).order("quoted_at", { nullsFirst: false }),
    sb.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
    sb.rpc("pur_supplier_scores"),
  ]);
  const lines = (ls ?? []) as { id: string; name: string; qty: number; unit: string }[];
  const sups = (ss ?? []) as unknown as Sup[];
  const { data: qs } = sups.length ? await sb.from("pur_rfq_quotes").select("supplier_row, line_id, unit_price, vat_rate, available, note").in("supplier_row", sups.map((x) => x.id)) : { data: [] };
  const quotes = (qs ?? []) as { supplier_row: string; line_id: string; unit_price: number | null; vat_rate: number; available: boolean; note: string | null }[];
  const qOf = (sid: string, lid: string) => quotes.find((x) => x.supplier_row === sid && x.line_id === lid);
  const score = new Map(((scores ?? []) as { party_id: string; score: number; on_time_pct: number | null }[]).map((x) => [x.party_id, x]));
  const quoted = sups.filter((x) => x.status === "quoted");
  const minPrice = new Map(lines.map((l) => [l.id, Math.min(...quoted.map((x) => qOf(x.id, l.id)).filter((q) => q?.available && q.unit_price != null).map((q) => q!.unit_price!), Infinity)]));
  const totals = new Map(quoted.map((x) => [x.id, lines.reduce((a, l) => { const q = qOf(x.id, l.id); return a + (q?.available && q.unit_price != null ? q.unit_price * Number(l.qty) : 0); }, 0)]));
  const coverage = new Map(quoted.map((x) => [x.id, lines.filter((l) => qOf(x.id, l.id)?.available).length]));
  const full = quoted.filter((x) => coverage.get(x.id) === lines.length);
  const best = (full.length ? full : quoted).slice().sort((a, b) => (totals.get(a.id) ?? 0) - (totals.get(b.id) ?? 0))[0];
  const open = r.status === "open";
  const canEdit = (s.modules.purchases ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  const m = (v: number) => money(v, r.currency as string);
  const link = (t: string) => `${erpUrl()}/tedarikci/teklif/${t}`;
  const inp = "h-9 rounded-[8px] border border-[#D5DEE8] px-2 text-sm";

  return (
    <>
      <PageHeader title={`${rfqNo(r)} · ${r.title}`} subtitle={`${lines.length} kalem · ${sups.length} tedarikçi · ${quoted.length} teklif${r.due_date ? ` · son tarih ${formatDate(r.due_date)}` : ""}`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/satinalma/teklifler" className="text-brand-700">← Teklifler</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1300px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold rounded px-2 py-1 ${RFQ_STATUS[r.status]?.[1]}`}>{RFQ_STATUS[r.status]?.[0]}</span>
          {r.po_id && <Link href={`/alis/siparisler/${r.po_id}`} className="text-sm font-semibold text-brand-700">Oluşan sipariş →</Link>}
          {r.note && <span className="text-sm text-muted">{r.note}</span>}
          {open && canEdit && <form action={cancelRfq} className="ml-auto"><input type="hidden" name="rfq" value={r.id} /><ConfirmSubmit label="Teklif isteğini iptal et" question="İptal edilsin mi?" className="text-sm font-semibold text-bad" /></form>}
        </div>

        {best && open && (
          <div className="rounded-[16px] border border-ok bg-ok-bg p-4 flex flex-wrap items-center gap-3">
            <span className="text-ok font-bold">★ Önerilen:</span>
            <b>{best.fin_parties?.name}</b>
            <span>{m(totals.get(best.id) ?? 0)} (KDV hariç)</span>
            <span className="text-sm">{coverage.get(best.id)}/{lines.length} kalem{best.delivery_days != null ? ` · ${best.delivery_days} gün teslim` : ""}{score.get(best.party_id) ? ` · puan ${score.get(best.party_id)!.score}` : ""}</span>
            {canEdit && <form action={awardRfq} className="ml-auto"><input type="hidden" name="rfq" value={r.id} /><input type="hidden" name="row" value={best.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-ok text-white text-sm font-semibold">Bu teklifle sipariş oluştur</PendingSubmit></form>}
          </div>
        )}

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 380 + sups.length * 170 }}>
            <thead>
              <tr className="text-left text-xs text-muted align-bottom">
                <th className="p-3">Kalem</th><th className="p-3 text-right">Miktar</th>
                {sups.map((x) => (
                  <th key={x.id} className={`p-3 text-right ${best?.id === x.id ? "bg-ok-bg" : ""}`}>
                    <div className="text-ink font-bold text-sm truncate max-w-40 ml-auto" title={x.fin_parties?.name}>{x.fin_parties?.name}</div>
                    <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${SUP_STATUS[x.status]?.[1]}`}>{SUP_STATUS[x.status]?.[0]}</span>
                    {score.get(x.party_id) && <div className="text-[10px] mt-0.5">Puan <b>{score.get(x.party_id)!.score}</b></div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-[#EEF2F6]">
                  <td className="p-3 font-semibold">{l.name}</td>
                  <td className="p-3 text-right tabular-nums">{Number(l.qty)} {l.unit}</td>
                  {sups.map((x) => {
                    const q = qOf(x.id, l.id);
                    const cheapest = q?.available && q.unit_price != null && q.unit_price === minPrice.get(l.id) && quoted.length > 1;
                    return (
                      <td key={x.id} className={`p-3 text-right tabular-nums ${cheapest ? "bg-ok-bg text-ok font-bold" : ""}`}>
                        {x.status !== "quoted" ? <span className="text-muted">—</span> : !q?.available ? <span className="text-xs text-bad">yok</span> : <>{m(q.unit_price ?? 0)}<div className="text-[10px] text-muted">toplam {m((q.unit_price ?? 0) * Number(l.qty))}</div>{q.note && <div className="text-[10px] text-muted">{q.note}</div>}</>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-line font-bold">
                <td className="p-3" colSpan={2}>Toplam (KDV hariç)</td>
                {sups.map((x) => <td key={x.id} className="p-3 text-right tabular-nums">{x.status === "quoted" ? <>{m(totals.get(x.id) ?? 0)}<div className="text-[10px] font-normal text-muted">{coverage.get(x.id)}/{lines.length} kalem</div></> : "—"}</td>)}
              </tr>
              <tr className="border-t border-[#EEF2F6] text-xs">
                <td className="p-3 text-muted" colSpan={2}>Teslim süresi · geçerlilik</td>
                {sups.map((x) => <td key={x.id} className="p-3 text-right">{x.delivery_days != null ? `${x.delivery_days} gün` : "—"}{x.valid_until ? <div className="text-muted">{formatDate(x.valid_until)}&apos;e kadar</div> : null}{x.note && <div className="text-muted">{x.note}</div>}</td>)}
              </tr>
              {open && canEdit && (
                <tr className="border-t border-[#EEF2F6]">
                  <td className="p-3 text-xs text-muted" colSpan={2}>İşlem</td>
                  {sups.map((x) => <td key={x.id} className="p-3 text-right">{x.status === "quoted" && <form action={awardRfq}><input type="hidden" name="rfq" value={r.id} /><input type="hidden" name="row" value={x.id} /><PendingSubmit className="h-8 px-2.5 rounded-[8px] border border-ok text-ok text-xs font-semibold">Bunu seç → sipariş</PendingSubmit></form>}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {open && canEdit && (
          <RfqSend rfqId={r.id} rows={sups.map((x) => ({ id: x.id, name: x.fin_parties?.name ?? "", status: x.status, sent: !!x.sent_at, link: link(x.token), email: x.fin_parties?.order_email || x.fin_parties?.email || null,
            wa: waLink(x.fin_parties?.order_phone || x.fin_parties?.phone, `${s.companyName} fiyat teklifi isteği ${rfqNo(r)} (${r.title}). Teklif vermek için: ${link(x.token)}`) }))} />
        )}

        {open && canEdit && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display font-bold">Telefonla / e-postayla gelen teklifi gir</h2>
            {sups.map((x) => (
              <details key={x.id} className="rounded-xl border border-line">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{x.fin_parties?.name} <span className={`ml-2 text-[10px] rounded px-1.5 py-0.5 ${SUP_STATUS[x.status]?.[1]}`}>{SUP_STATUS[x.status]?.[0]}</span></summary>
                <form action={quoteInternal} className="p-3 flex flex-col gap-2 border-t border-line">
                  <input type="hidden" name="row" value={x.id} /><input type="hidden" name="rfq" value={r.id} />
                  {lines.map((l) => { const q = qOf(x.id, l.id); return (
                    <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_140px_80px_110px] items-center text-sm">
                      <input type="hidden" name="line" value={l.id} />
                      <span>{l.name} <span className="text-muted">· {Number(l.qty)} {l.unit}</span></span>
                      <input name={`p_${l.id}`} defaultValue={q?.unit_price != null ? (q.unit_price / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : ""} placeholder="Birim fiyat" inputMode="decimal" className={`${inp} text-right`} />
                      <select name={`v_${l.id}`} defaultValue={String(q?.vat_rate ?? 20)} className={inp}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select>
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`na_${l.id}`} defaultChecked={q ? !q.available : false} />yok</label>
                    </div>
                  ); })}
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="flex flex-col gap-1 text-xs text-muted">Teslim (gün)<input name="delivery_days" type="number" min={0} max={365} defaultValue={x.delivery_days ?? ""} className={`${inp} w-24`} /></label>
                    <label className="flex flex-col gap-1 text-xs text-muted">Geçerlilik<input name="valid_until" type="date" defaultValue={x.valid_until ?? ""} className={inp} /></label>
                    <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-40">Not<input name="note" defaultValue={x.note ?? ""} className={inp} /></label>
                    <label className="flex items-center gap-1 text-xs h-9"><input type="checkbox" name="decline" />teklif vermedi</label>
                    <PendingSubmit className="h-9 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit>
                  </div>
                </form>
              </details>
            ))}
            <form action={addRfqSupplier} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="rfq" value={r.id} />
              <select name="party" required className={`${inp} w-64 h-10`}><option value="">Tedarikçi ekle…</option>{((parties ?? []) as { id: string; name: string }[]).filter((p) => !sups.some((x) => x.party_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <PendingSubmit className="h-10 px-4 rounded-[10px] border border-line text-sm font-semibold text-brand-700">Ekle</PendingSubmit>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
