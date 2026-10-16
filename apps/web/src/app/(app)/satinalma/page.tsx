import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, poNo } from "@/lib/orders";
import { mrNo } from "@/lib/material";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satın alma" };

type D = { req_waiting: number; lines_to_order: number; po_draft: number; po_pending: number; po_unsent: number; po_open: number; po_late: number; po_noinvoice: number; month_total: number; prev_total: number; top_suppliers: { name: string; total: number; n: number }[] };

/** Satın alma paneli: akıştaki her adımda bekleyen iş, geciken teslimler, harcama */
export default async function PurchasingHome() {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const sb = await createClient();
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [{ data: dd, error }, { data: reqs }, { data: late }, { data: open }, { data: sug }] = await Promise.all([
    sb.rpc("pur_dashboard"),
    sb.from("stk_requests").select("id, year, no, kind, status, created_at, needed_by, employees(first_name, last_name)").in("status", ["purchase", "approved"]).order("created_at").limit(20),
    sb.from("pur_orders").select("id, year, no, expected_date, total, currency, status, fin_parties(name)").in("status", ["sent", "partial"]).lt("expected_date", today).order("expected_date").limit(15),
    sb.from("pur_orders").select("id, year, no, order_date, expected_date, total, currency, status, fin_parties(name)").in("status", ["draft", "pending", "approved", "sent", "partial"]).order("order_date", { ascending: false }).limit(15),
    sb.rpc("pur_suggestions"),
  ]);
  const d = (dd ?? null) as D | null;
  const tl = (v: number) => money(v, "TRY");
  const change = d && d.prev_total ? Math.round(((d.month_total - d.prev_total) / d.prev_total) * 100) : null;
  const flow: [string, number, string, string][] = d ? [
    ["Onay bekleyen istek", d.req_waiting, "/stok/talepler?s=satin", "Satın almanın onayını bekleyen malzeme istekleri"],
    ["Siparişe dönüşecek satır", d.lines_to_order, "/satinalma/istekten-siparis", "Onaylanmış ama henüz siparişe eklenmemiş"],
    ["Taslak sipariş", d.po_draft, "/alis/siparisler?durum=draft", "Hazırlanıyor"],
    ["Onay bekleyen sipariş", d.po_pending, "/alis/siparisler?durum=pending", "Tutar onayı bekliyor"],
    ["Gönderilmemiş", d.po_unsent, "/alis/siparisler?durum=approved", "Onaylı, tedarikçiye gitmedi"],
    ["Teslim bekleniyor", d.po_open, "/alis/siparisler?durum=sent", "Gönderildi / kısmen geldi"],
    ["Termini geçen", d.po_late, "#geciken", "Tedarikçi geç kaldı"],
    ["Faturası gelmeyen", d.po_noinvoice, "/alis/siparisler?durum=received", "Mal geldi, fatura yok"],
  ] : [];
  type Emp = { first_name: string; last_name: string } | null;

  return (
    <>
      <PageHeader title="Satın alma" subtitle="İstek → onay → sipariş → tedarikçi → mal kabul → fatura: her adımda bekleyenler"
        actions={<span className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/satinalma/istekten-siparis" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white">İstekten sipariş oluştur</Link>
          <Link href="/alis/siparisler/yeni" className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-brand-700">+ Yeni sipariş</Link>
          <Link href="/stok/mal-kabul" className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-brand-700">Mal kabul</Link>
        </span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/pur_dashboard|schema cache/.test(error.message) ? "Supabase'de mbdental-satinalma-1.sql çalıştırılmalı." : error.message}</p>}
        {d && (
          <>
            <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {flow.map(([l, n, href, sub], i) => (
                <Link key={l} href={href} className={`rounded-[16px] border bg-white p-4 flex flex-col gap-1 hover:border-brand-600 ${n > 0 && (i === 6 || i === 0 || i === 3) ? "border-warn" : "border-line"}`}>
                  <span className="text-xs font-semibold text-muted"><span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[#EEF2F6] text-[10px] mr-1">{i + 1}</span>{l}</span>
                  <span className={`font-display text-3xl font-bold ${n > 0 && i === 6 ? "text-bad" : ""}`}>{n}</span>
                  <span className="text-[11px] text-muted">{sub}</span>
                </Link>
              ))}
            </section>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[16px] border border-line bg-white p-4">
                <div className="text-xs font-semibold text-muted">Bu ay satın alma</div>
                <div className="font-display text-3xl font-bold">{tl(d.month_total)}</div>
                <div className="text-sm text-muted">Geçen ay {tl(d.prev_total)}{change !== null && <b className={change > 0 ? "text-bad ml-1" : "text-ok ml-1"}>{change > 0 ? "▲" : "▼"} %{Math.abs(change)}</b>}</div>
              </div>
              <div className="rounded-[16px] border border-line bg-white p-4 md:col-span-2">
                <div className="text-xs font-semibold text-muted mb-2">Son 90 günün en çok çalışılan tedarikçileri</div>
                <ul className="flex flex-col gap-1.5">
                  {d.top_suppliers.map((t) => (
                    <li key={t.name} className="flex items-center gap-2 text-sm">
                      <span className="w-48 truncate">{t.name}</span>
                      <span className="flex-1 h-2.5 rounded-full bg-[#EEF2F6]"><span className="block h-2.5 rounded-full bg-brand-600" style={{ width: `${(t.total / Math.max(1, d.top_suppliers[0]?.total ?? 1)) * 100}%` }} /></span>
                      <span className="tabular-nums w-28 text-right font-semibold">{tl(t.total)}</span><span className="text-xs text-muted w-14 text-right">{t.n} sip.</span>
                    </li>
                  ))}
                  {!d.top_suppliers.length && <li className="text-sm text-muted">Henüz sipariş yok.</li>}
                </ul>
              </div>
            </section>
          </>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <div className="flex items-center"><h2 className="font-display text-lg font-bold mr-auto">Bekleyen istekler</h2><Link href="/stok/talepler" className="text-sm font-semibold text-brand-700">Tümü →</Link></div>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {((reqs ?? []) as unknown as { id: string; year: number; no: number; kind: string; status: string; created_at: string; needed_by: string | null; employees: Emp }[]).map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-2">
                  <Link href={`/stok/talepler/${r.id}`} className="font-mono font-semibold text-brand-700">{mrNo(r)}</Link>
                  <span>{r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : ""}</span>
                  <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${r.status === "purchase" ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}>{r.status === "purchase" ? "Onay bekliyor" : "Onaylı · siparişe dönüştür"}</span>
                  {r.needed_by && <span className={`ml-auto text-xs ${r.needed_by < today ? "text-bad font-semibold" : "text-muted"}`}>gerekli {formatDate(r.needed_by)}</span>}
                </li>
              ))}
              {!(reqs ?? []).length && <li className="py-4 text-muted">Bekleyen istek yok.</li>}
            </ul>
          </section>
          <section id="geciken" className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display text-lg font-bold">Termini geçen siparişler</h2>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {((late ?? []) as unknown as { id: string; year: number; no: number; expected_date: string; total: number; currency: string; status: string; fin_parties: { name: string } | null }[]).map((o) => (
                <li key={o.id} className="py-2 flex flex-wrap items-center gap-2">
                  <Link href={`/alis/siparisler/${o.id}`} className="font-mono font-semibold text-brand-700">{poNo(o.year, o.no)}</Link>
                  <span>{o.fin_parties?.name}</span>
                  <span className="ml-auto text-bad font-semibold text-xs">{Math.round((Date.parse(today) - Date.parse(o.expected_date)) / 86400000)} gün gecikti</span>
                </li>
              ))}
              {!(late ?? []).length && <li className="py-4 text-ok">✓ Geciken sipariş yok.</li>}
            </ul>
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <div className="flex items-center"><h2 className="font-display text-lg font-bold mr-auto">Açık siparişler</h2><Link href="/alis/siparisler" className="text-sm font-semibold text-brand-700">Tümü →</Link></div>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {((open ?? []) as unknown as { id: string; year: number; no: number; order_date: string; expected_date: string | null; total: number; currency: string; status: string; fin_parties: { name: string } | null }[]).map((o) => (
                <li key={o.id} className="py-2 flex flex-wrap items-center gap-2">
                  <Link href={`/alis/siparisler/${o.id}`} className="font-mono font-semibold text-brand-700">{poNo(o.year, o.no)}</Link>
                  <span className="truncate max-w-48">{o.fin_parties?.name}</span>
                  <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${PO_STATUS[o.status]?.[1]}`}>{PO_STATUS[o.status]?.[0]}</span>
                  <span className="ml-auto tabular-nums font-semibold">{money(o.total, o.currency)}</span>
                </li>
              ))}
              {!(open ?? []).length && <li className="py-4 text-muted">Açık sipariş yok.</li>}
            </ul>
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <div className="flex items-center"><h2 className="font-display text-lg font-bold mr-auto">Minimum stok altındakiler</h2><Link href="/uretim/talep-tahmini" className="text-sm font-semibold text-brand-700">Tek tıkla sipariş →</Link></div>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {((sug ?? []) as { item_id: string; name: string; unit: string; qty: number; min_qty: number; suggest: number; supplier: string | null }[]).slice(0, 12).map((x) => (
                <li key={x.item_id} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{x.name}</span><span className="text-xs text-muted">{x.supplier ?? "tedarikçi yok"}</span>
                  <span className="ml-auto text-xs"><b className="text-bad">{Number(x.qty)}</b> / min {Number(x.min_qty)} {x.unit} · öneri {Number(x.suggest)}</span>
                </li>
              ))}
              {!(sug ?? []).length && <li className="py-4 text-ok">✓ Minimum altında ürün yok.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
