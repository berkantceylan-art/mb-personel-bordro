import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { WB_STATUS, stNo, wbNo } from "@/lib/waybill";
import { cancelWaybill, issueWaybill, removeWaybillJob } from "@/lib/waybill-actions";
import { edspFromWaybill } from "@/lib/edsp-actions";

export const dynamic = "force-dynamic";

/** İrsaliye ayrıntısı */
export default async function WaybillPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data: w } = await supabase.from("lab_waybills").select("*, lab_customers(id, name), lab_statements(id, year, no)").eq("id", id).maybeSingle();
  if (!w) notFound();
  const { data: jobs } = await supabase.from("jobs").select("id, no, patient, doctor_name, total, currency, delivered_at, job_items(name, qty, amount)").eq("waybill_id", id).order("no");
  const cust = w.lab_customers as { id: string; name: string } | null;
  const st = w.lab_statements as { id: string; year: number; no: number } | null;
  const rows = (jobs ?? []) as { id: string; no: number; patient: string | null; doctor_name: string | null; total: number; currency: string; job_items: { name: string; qty: number; amount: number }[] }[];
  const locked = !!w.statement_id;

  return (
    <>
      <PageHeader title={`${wbNo(w.year, w.no)} · ${cust?.name ?? ""}`} subtitle={`${formatDate(w.ship_date)} · ${w.job_count} iş · ${Number(w.unit_count)} birim · ${money(w.total, w.currency)}`}
        actions={<span className="flex flex-wrap gap-3 text-sm font-semibold"><Link href={`/yazdir/irsaliye/${w.id}`} className="text-brand-700">Yazdır</Link><Link href={`/yazdir/beyan?irsaliye=${w.id}`} className="text-brand-700">Uygunluk beyanları</Link><Link href={`/isler/irsaliye?gun=${w.ship_date}`} className="text-brand-700">← Günün irsaliyeleri</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${WB_STATUS[w.status]?.[1]}`}>{WB_STATUS[w.status]?.[0]}</span>
          {st && <Link href={`/yazdir/ic-fatura/${st.id}`} className="text-sm font-semibold text-brand-700">Fatura {stNo(st.year, st.no)}</Link>}
          {cust && <Link href={`/isler/hekimler/${cust.id}`} className="text-sm font-semibold text-brand-700">Müşteri kartı</Link>}
          <span className="ml-auto flex gap-2">
            {w.status !== "cancelled" && rows.length > 0 && <form action={edspFromWaybill}><input type="hidden" name="id" value={w.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] border border-line text-brand-700 text-sm font-semibold">e-İrsaliye oluştur</PendingSubmit></form>}
            {w.status === "open" && <form action={issueWaybill}><input type="hidden" name="id" value={w.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] border border-ok text-ok text-sm font-semibold">Kesildi olarak işaretle</PendingSubmit></form>}
            {!locked && w.status !== "cancelled" && <form action={cancelWaybill}><input type="hidden" name="id" value={w.id} /><ConfirmSubmit label="İrsaliyeyi iptal et" question="İrsaliye iptal edilsin mi?" className="h-10 px-4 rounded-[10px] border border-bad text-bad text-sm font-semibold" /></form>}
          </span>
        </div>
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">İş</th><th className="p-3">Hasta / hekim</th><th className="p-3">Yapılan iş</th><th className="p-3 text-right">Tutar</th><th className="p-3" /></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-t border-[#EEF2F6] align-top">
                  <td className="p-3"><Link href={`/isler/${j.id}`} className="font-bold text-brand-700">#{j.no}</Link></td>
                  <td className="p-3">{j.patient ?? "—"}{j.doctor_name && <span className="block text-xs text-muted">{j.doctor_name}</span>}</td>
                  <td className="p-3 text-xs">{j.job_items.filter((i) => i.amount > 0).map((i) => `${Number(i.qty)}× ${i.name}`).join(", ") || "—"}</td>
                  <td className="p-3 text-right num font-semibold">{money(j.total, j.currency)}</td>
                  <td className="p-3 text-right">{!locked && <form action={removeWaybillJob}><input type="hidden" name="job_id" value={j.id} /><ConfirmSubmit label="Çıkar" question="İş bu irsaliyeden çıkarılsın mı?" /></form>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted">İrsaliyede iş yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
