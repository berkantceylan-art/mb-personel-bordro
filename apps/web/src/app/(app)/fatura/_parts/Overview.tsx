import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Money, Notice, page } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { DIRECTION, type Direction } from "@/lib/invoice";

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Satış / alış özeti: aylık grafik, vadesi geçenler, en çok çalışılan cariler */
export async function Overview({ direction }: { direction: Direction }) {
  const s = await getSession();
  const D = DIRECTION[direction];
  const lvl = s.modules[D.module] ?? 0;
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const [{ data, error }, { count: drafts }, { count: ready }, { count: jobs }] = await Promise.all([
    supabase.from("inv_invoices").select("id, no, type, doc_no, invoice_date, due_date, party_id, party_name, currency, rate, subtotal, total").eq("direction", direction).eq("status", "posted").gte("invoice_date", from).limit(10000),
    supabase.from("inv_invoices").select("id", { count: "exact", head: true }).eq("direction", direction).eq("status", "draft"),
    direction === "sale" ? supabase.from("inv_invoices").select("id", { count: "exact", head: true }).eq("direction", "sale").eq("status", "posted").eq("einvoice_status", "ready") : Promise.resolve({ count: 0 }),
    direction === "sale" ? supabase.from("jobs").select("id", { count: "exact", head: true }).is("invoice_id", null).eq("status", "delivered").gt("total", 0) : Promise.resolve({ count: 0 }),
  ]);
  type R = { id: string; no: number; type: string; doc_no: string | null; invoice_date: string; due_date: string | null; party_id: string; party_name: string | null; currency: string; rate: number; subtotal: number; total: number };
  const rows = (data ?? []) as R[];
  const tl = (r: R, k: "subtotal" | "total") => (r.type === "return" ? -1 : 1) * Math.round(Number(r[k]) * Number(r.rate));
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)); return { key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()], v: 0 }; });
  for (const r of rows) { const m = months.find((x) => x.key === r.invoice_date.slice(0, 7)); if (m) m.v += tl(r, "subtotal"); }
  const max = Math.max(1, ...months.map((m) => m.v));
  const thisM = months[11].v, lastM = months[10].v;
  const yearStart = `${now.getUTCFullYear()}-01-01`;
  const byParty = new Map<string, { name: string; v: number }>();
  for (const r of rows.filter((x) => x.invoice_date >= yearStart)) { const p = byParty.get(r.party_id) ?? { name: r.party_name ?? "", v: 0 }; p.v += tl(r, "subtotal"); byParty.set(r.party_id, p); }
  const top = [...byParty.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
  const topMax = Math.max(1, ...top.map(([, p]) => p.v));
  const overdue = rows.filter((r) => r.type === "invoice" && r.due_date && r.due_date < today).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 10);

  return (
    <>
      <PageHeader title={direction === "sale" ? "Satışlar" : "Alışlar"} subtitle={direction === "sale" ? "Protez, malzeme ve hizmet satışları; e-Fatura / e-Arşiv" : "Malzeme, hammadde, sarf ve hizmet alışları; e-Fatura içe aktarma"}
        actions={lvl >= 2 ? <Link href={`${D.base}/yeni`} className="text-sm font-semibold text-brand-700">+ Yeni fatura</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Fatura tabloları yok: Supabase&apos;de 20261204000000_invoices.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Bu ay (KDV hariç)" value={<Money v={thisM} />} sub={lastM ? `geçen ay ${fmt(lastM)}` : undefined} href={`${D.base}/faturalar?bas=${months[11].key}-01`} />
          <KPI label="Son 12 ay" value={<Money v={months.reduce((t, m) => t + m.v, 0)} />} />
          <KPI label="Taslak" value={drafts ?? 0} href={`${D.base}/faturalar?durum=draft`} />
          {direction === "sale"
            ? <KPI label="Faturalanmamış iş" value={jobs ?? 0} sub={ready ? `${ready} e-fatura gönderime hazır` : undefined} href="/satis/isler" tone={(jobs ?? 0) > 0 ? "bad" : undefined} />
            : <KPI label="e-Fatura aktar" value="XML / ZIP" href="/alis/ice-aktar" />}
        </div>

        <section className="bg-white border border-line rounded-[14px] p-4">
          <h2 className="font-semibold mb-3">Aylık {direction === "sale" ? "satış" : "alış"} (TL, KDV hariç)</h2>
          <div className="flex items-end gap-2 h-44">
            {months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${m.label}: ${fmt(m.v)}`}>
                <span className="text-[10px] text-muted num truncate">{m.v ? Math.round(m.v / 100000) / 10 + "b" : ""}</span>
                <div className={`w-full rounded-t-md ${m.key === months[11].key ? "bg-brand-700" : "bg-[#B9CDE3]"}`} style={{ height: `${Math.max(2, (Math.max(0, m.v) / max) * 130)}px` }} />
                <span className="text-[11px] text-muted">{m.label}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="bg-white border border-line rounded-[14px] p-4">
            <h2 className="font-semibold mb-3">Bu yıl en çok {direction === "sale" ? "satış yapılan" : "alış yapılan"}</h2>
            {top.length === 0 && <p className="text-sm text-muted">Henüz fatura yok.</p>}
            <ul className="flex flex-col gap-2 text-sm">
              {top.map(([id, p]) => (
                <li key={id}>
                  <div className="flex justify-between gap-3"><Link href={`/finans/cariler/${id}`} className="truncate hover:underline">{p.name}</Link><Money v={p.v} /></div>
                  <div className="h-1.5 rounded-full bg-[#EEF2F6] mt-1"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(p.v / topMax) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="bg-white border border-line rounded-[14px] p-4">
            <h2 className="font-semibold mb-3">Vadesi geçen faturalar</h2>
            {overdue.length === 0 && <p className="text-sm text-muted">Vadesi geçen fatura yok.</p>}
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {overdue.map((r) => (
                <li key={r.id} className="py-2 flex items-center gap-3">
                  <Link href={`/fatura/${r.id}`} className="font-semibold text-brand-700 num">{r.doc_no ?? `#${r.no}`}</Link>
                  <span className="truncate flex-1">{r.party_name}</span>
                  <span className="text-bad text-xs">{formatDate(r.due_date!)}</span>
                  <Money v={r.total} cur={r.currency} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-2">Ödeme durumu cari bakiyeden izlenir; tahsilat / ödeme Finans &gt; İşlem gir ile kaydedilir.</p>
          </section>
        </div>
      </div>
    </>
  );
}
