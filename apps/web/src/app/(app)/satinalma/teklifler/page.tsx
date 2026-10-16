import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { RFQ_STATUS, rfqError, rfqNo } from "@/lib/rfq";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teklifler" };

/** Teklif istekleri: kaç tedarikçiye gitti, kaçı teklif verdi, en iyi teklif */
export default async function RfqList({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const tab = sp.durum === "hepsi" ? "hepsi" : "open";
  const sb = await createClient();
  let q = sb.from("pur_rfqs").select("id, year, no, title, status, due_date, created_at, po_id, pur_rfq_suppliers(status), pur_rfq_lines(id)").order("created_at", { ascending: false }).limit(200);
  if (tab === "open") q = q.eq("status", "open");
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as { id: string; year: number; no: number; title: string; status: string; due_date: string | null; created_at: string; po_id: string | null; pur_rfq_suppliers: { status: string }[]; pur_rfq_lines: { id: string }[] }[];
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Teklifler" subtitle="Birden çok tedarikçiden fiyat iste, karşılaştır, en iyisini siparişe dönüştür"
        actions={<span className="flex flex-wrap gap-3 text-sm font-semibold"><Link href="/satinalma/teklifler/yeni" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white">+ Yeni teklif isteği</Link><Link href="/satinalma/tedarikciler" className="text-brand-700 self-center">Tedarikçi karnesi</Link><Link href="/satinalma" className="text-brand-700 self-center">← Satın alma</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{rfqError(error.message)}</p>}
        <div className="flex gap-2">{[["open", "Açık"], ["hepsi", "Hepsi"]].map(([k, l]) => <Link key={k} href={`/satinalma/teklifler?durum=${k}`} className={`h-9 px-4 inline-flex items-center rounded-full text-sm font-semibold ${tab === k ? "bg-brand-700 text-white" : "border border-line text-brand-700"}`}>{l}</Link>)}</div>
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">No</th><th className="p-3">Konu</th><th className="p-3 text-right">Kalem</th><th className="p-3">Tedarikçi yanıtı</th><th className="p-3">Son tarih</th><th className="p-3">Durum</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const q2 = r.pur_rfq_suppliers.filter((x) => x.status === "quoted").length;
                return (
                  <tr key={r.id} className="border-t border-[#EEF2F6]">
                    <td className="p-3"><Link href={`/satinalma/teklifler/${r.id}`} className="font-mono font-semibold text-brand-700">{rfqNo(r)}</Link></td>
                    <td className="p-3 font-semibold">{r.title}</td>
                    <td className="p-3 text-right">{r.pur_rfq_lines.length}</td>
                    <td className="p-3"><b>{q2}</b> / {r.pur_rfq_suppliers.length} teklif verdi<div className="mt-1 h-1.5 w-32 rounded-full bg-[#EEF2F6]"><div className="h-1.5 rounded-full bg-ok" style={{ width: `${(q2 / Math.max(1, r.pur_rfq_suppliers.length)) * 100}%` }} /></div></td>
                    <td className={`p-3 ${r.status === "open" && r.due_date && r.due_date < today ? "text-bad font-semibold" : ""}`}>{r.due_date ? formatDate(r.due_date) : "—"}</td>
                    <td className="p-3"><span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${RFQ_STATUS[r.status]?.[1]}`}>{RFQ_STATUS[r.status]?.[0]}</span>{r.po_id && <Link href={`/alis/siparisler/${r.po_id}`} className="ml-2 text-xs font-semibold text-brand-700">Sipariş →</Link>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted">Teklif isteği yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
