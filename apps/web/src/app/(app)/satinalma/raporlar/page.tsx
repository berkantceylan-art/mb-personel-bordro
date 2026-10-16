import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { MONTHS, p3Error } from "@/lib/purchasing3";
import { changePct, reportPeriod, type PurReport } from "@/lib/pur-report";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satın alma raporları" };

const PRESETS: [string, string][] = [["ay", "Bu ay"], ["3ay", "Son 3 ay"], ["yil", "Bu yıl"], ["12ay", "Son 12 ay"]];
const tl = (v: number) => money(v, "TRY");

/** Satın alma raporları: harcama, tedarikçi, gider türü, ürün fiyat değişimi, süreç süreleri */
export default async function PurchasingReports({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; d?: string }> }) {
  const s = await getSession();
  if (Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0) < 1) redirect("/");
  const { from, to, preset } = reportPeriod(await searchParams);
  const { data, error } = await (await createClient()).rpc("pur_report", { p_from: from, p_to: to });
  const r = (data ?? null) as PurReport | null;
  const k = r?.kpi;
  const maxM = Math.max(1, ...(r?.monthly ?? []).map((m) => Math.max(m.ordered, m.invoiced)));
  const catTotal = (r?.by_category ?? []).reduce((a, c) => a + Math.max(0, c.total), 0) || 1;
  const supTotal = (r?.by_supplier ?? []).reduce((a, c) => a + c.po_total, 0) || 1;
  const excel = `/satinalma/raporlar/excel?bas=${from}&bit=${to}`;

  return (
    <>
      <PageHeader title="Satın alma raporları" subtitle={`${formatDate(from)} – ${formatDate(to)}`}
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={excel} className="text-brand-700">Excel&apos;e aktar</a><Link href="/satinalma" className="text-brand-700">← Satın alma</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          {PRESETS.map(([key, l]) => <Link key={key} href={`?d=${key}`} className={`h-9 px-3 inline-flex items-center rounded-full border font-semibold ${preset === key ? "bg-brand-700 text-white border-brand-700" : "border-line bg-white text-brand-800"}`}>{l}</Link>)}
          <span className="mx-2 text-muted">ya da</span>
          <input type="date" name="bas" defaultValue={from} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2" />
          <input type="date" name="bit" defaultValue={to} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2" />
          <button className="h-9 px-3 rounded-[10px] border border-brand-600 text-brand-700 font-semibold">Göster</button>
        </form>
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{p3Error(error.message)}</p>}
        {r && k && (
          <>
            <section className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              <Kpi l="Sipariş tutarı" v={tl(k.po_total)} s={`${k.po_n} sipariş · ${k.suppliers} tedarikçi`} />
              <Kpi l="İşlenen alış faturası" v={tl(k.inv_total)} s={`${k.inv_n} fatura · KDV hariç ${tl(k.inv_net)}`} />
              <Kpi l="Zamanında teslim" v={k.on_time_pct != null ? `%${Number(k.on_time_pct)}` : "—"} s={k.late_open ? `${k.late_open} açık sipariş gecikmede` : "Geciken açık sipariş yok"} warn={k.late_open > 0} />
              <Kpi l="Ort. teslim süresi" v={k.lead_days != null ? `${Number(k.lead_days)} gün` : "—"} s="Gönderimden mal kabule" />
              <Kpi l="Ort. onay süresi" v={k.approval_hours != null ? `${Number(k.approval_hours)} saat` : "—"} s={k.req_to_po_days != null ? `İstekten siparişe ${Number(k.req_to_po_days)} gün` : "Onaya gönderimden onaya"} />
              <Kpi l="Teklif tasarrufu" v={tl(k.rfq_saving)} s={`${k.rfq_n} teklif turu · diğer tekliflerin ortalamasına göre`} good={k.rfq_saving > 0} />
            </section>

            <section className="rounded-[16px] border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h2 className="font-display font-bold text-brand-800">Son 12 ay</h2>
                <span className="flex items-center gap-1 text-xs text-muted"><span className="w-3 h-3 rounded-sm bg-brand-600" /> Sipariş</span>
                <span className="flex items-center gap-1 text-xs text-muted"><span className="w-3 h-3 rounded-sm bg-[#8FB8E0]" /> Fatura</span>
              </div>
              <div className="flex items-end gap-2 h-48">
                {r.monthly.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                    <div className="flex items-end gap-0.5 w-full h-full justify-center" title={`${m.month}: sipariş ${tl(m.ordered)} · fatura ${tl(m.invoiced)}`}>
                      <span className="w-1/2 max-w-5 rounded-t bg-brand-600" style={{ height: `${(m.ordered / maxM) * 100}%` }} />
                      <span className="w-1/2 max-w-5 rounded-t bg-[#8FB8E0]" style={{ height: `${(Math.max(0, m.invoiced) / maxM) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-[16px] border border-line bg-white p-4">
                <h2 className="font-display font-bold text-brand-800 mb-3">Tedarikçiye göre</h2>
                <ul className="flex flex-col gap-2">
                  {r.by_supplier.slice(0, 12).map((x) => (
                    <li key={x.party_id} className="text-sm">
                      <div className="flex items-center gap-2"><Link href={`/finans/cariler/${x.party_id}`} className="truncate font-semibold text-brand-700">{x.name}</Link><span className="ml-auto tabular-nums font-semibold">{tl(x.po_total)}</span><span className="text-xs text-muted w-12 text-right">%{Math.round((x.po_total / supTotal) * 100)}</span></div>
                      <div className="h-2 rounded-full bg-[#EEF2F6] mt-1"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(x.po_total / supTotal) * 100}%` }} /></div>
                      <div className="text-[11px] text-muted mt-0.5">{x.po_n} sipariş · fatura {tl(x.inv_total)}</div>
                    </li>
                  ))}
                  {!r.by_supplier.length && <li className="text-sm text-muted">Veri yok.</li>}
                </ul>
              </section>
              <section className="rounded-[16px] border border-line bg-white p-4">
                <h2 className="font-display font-bold text-brand-800 mb-3">Gider türüne göre (işlenmiş faturalar, KDV hariç)</h2>
                <ul className="flex flex-col gap-2">
                  {r.by_category.map((c) => (
                    <li key={c.category_id ?? c.name} className="text-sm">
                      <div className="flex items-center gap-2"><span className="truncate font-semibold">{c.name}</span><span className="ml-auto tabular-nums font-semibold">{tl(c.total)}</span><span className="text-xs text-muted w-12 text-right">%{Math.round((Math.max(0, c.total) / catTotal) * 100)}</span></div>
                      <div className="h-2 rounded-full bg-[#EEF2F6] mt-1"><div className="h-2 rounded-full bg-[#8FB8E0]" style={{ width: `${(Math.max(0, c.total) / catTotal) * 100}%` }} /></div>
                    </li>
                  ))}
                  {!r.by_category.length && <li className="text-sm text-muted">Bu dönemde işlenmiş alış faturası yok.</li>}
                </ul>
                <Link href="/satinalma/butce" className="inline-block mt-3 text-sm font-semibold text-brand-700">Bütçeyle karşılaştır →</Link>
              </section>
            </div>

            {r.price_up.length > 0 && (
              <section className="rounded-[16px] border border-warn bg-white p-4">
                <h2 className="font-display font-bold text-brand-800 mb-1">Fiyatı artan ürünler</h2>
                <p className="text-xs text-muted mb-3">Dönemin ilk ve son siparişindeki birim fiyat (TL) — %3 ve üzeri artışlar. Yeni teklif toplamak için <Link href="/satinalma/teklifler/yeni" className="font-semibold text-brand-700">teklif isteği</Link> açın.</p>
                <div className="flex flex-wrap gap-2">
                  {r.price_up.map((p) => (
                    <div key={p.name} className="rounded-[12px] border border-line px-3 py-2 text-sm min-w-[200px]">
                      <div className="font-semibold truncate max-w-[260px]">{p.name}</div>
                      <div className="tabular-nums text-muted">{tl(p.first_price)} → <b className="text-ink">{tl(p.last_price)}</b> <span className="text-bad font-semibold">+%{changePct(p.first_price, p.last_price)}</span></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
              <h2 className="font-display font-bold text-brand-800 p-4 pb-0">En çok harcanan ürünler (sipariş satırları)</h2>
              <table className="w-full text-sm min-w-[960px]">
                <thead><tr className="text-left text-xs text-muted"><th className="p-3">Ürün</th><th className="p-3 text-right">Miktar</th><th className="p-3 text-right">Tutar</th><th className="p-3 text-right">Ort. fiyat</th><th className="p-3 text-right">En düşük</th><th className="p-3 text-right">En yüksek</th><th className="p-3 text-right">İlk → son</th><th className="p-3 text-right">Tedarikçi</th></tr></thead>
                <tbody>
                  {r.by_item.map((i) => {
                    const ch = changePct(i.first_price, i.last_price);
                    return (
                      <tr key={i.name + i.unit} className="border-t border-[#EEF2F6]">
                        <td className="p-3">{i.name}</td>
                        <td className="p-3 text-right">{Number(i.qty).toLocaleString("tr-TR")} {i.unit}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">{tl(i.total)}</td>
                        <td className="p-3 text-right tabular-nums">{tl(i.avg_price)}</td>
                        <td className="p-3 text-right tabular-nums text-muted">{tl(i.min_price)}</td>
                        <td className="p-3 text-right tabular-nums text-muted">{tl(i.max_price)}</td>
                        <td className={`p-3 text-right ${ch > 0 ? "text-bad" : ch < 0 ? "text-ok" : "text-muted"}`}>{i.n > 1 && ch !== 0 ? `${ch > 0 ? "+" : ""}%${ch}` : "—"}</td>
                        <td className="p-3 text-right">{i.suppliers}</td>
                      </tr>
                    );
                  })}
                  {!r.by_item.length && <tr><td colSpan={8} className="p-8 text-center text-muted">Bu dönemde sipariş yok.</td></tr>}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ l, v, s, warn, good }: { l: string; v: string; s: string; warn?: boolean; good?: boolean }) {
  return (
    <div className={`rounded-[16px] border bg-white p-4 flex flex-col gap-1 ${warn ? "border-warn" : "border-line"}`}>
      <span className="text-xs font-semibold text-muted">{l}</span>
      <span className={`font-display text-xl font-bold tabular-nums ${good ? "text-ok" : ""}`}>{v}</span>
      <span className="text-[11px] text-muted">{s}</span>
    </div>
  );
}
