import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Money, Notice, Tabs, btnPrimary, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { invoiceFromJobs } from "@/lib/invoice-actions";
import { JOB_STATUS } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Faturalanmamış laboratuvar işleri: hekim bazında seç → tek tuşla satış faturası taslağı */
export default async function UninvoicedJobs({ searchParams }: { searchParams: Promise<{ hepsi?: string }> }) {
  const s = await getSession();
  const lvl = s.modules.sales ?? 0;
  if (lvl < 1) redirect("/");
  const { hepsi } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("jobs").select("id, no, patient, doctor_name, in_date, due_date, delivered_at, status, currency, total, customer_id, lab_customers(name)")
    .is("invoice_id", null).neq("status", "cancelled").gt("total", 0).order("in_date").limit(2000);
  if (!hepsi) q = q.eq("status", "delivered");
  const { data, error } = await q;
  type J = { id: string; no: number; patient: string | null; doctor_name: string | null; in_date: string; due_date: string | null; delivered_at: string | null; status: string; currency: string; total: number; customer_id: string; lab_customers: { name: string } | null };
  const rows = (data ?? []) as unknown as J[];
  const groups = new Map<string, J[]>();
  for (const r of rows) groups.set(`${r.customer_id}|${r.currency}`, [...(groups.get(`${r.customer_id}|${r.currency}`) ?? []), r]);
  const list = [...groups.values()].sort((a, b) => (a[0].lab_customers?.name ?? "").localeCompare(b[0].lab_customers?.name ?? "", "tr"));

  return (
    <>
      <PageHeader title="Faturalanmamış işler" subtitle={`${rows.length} iş · ${list.length} hekim / klinik`} actions={<Link href="/satis/faturalar" className="text-sm font-semibold text-brand-700">← Satış faturaları</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/invoice_id/.test(error.message) ? "Fatura tabloları yok: Supabase'de 20261204000000_invoices.sql çalıştırın." : error.message}</Notice>}
        <Notice tone="info">İşlerden kesilen faturada iş tutarı hekim bakiyesinde zaten olduğu için bakiyeye yalnız KDV eklenir. Fiyatlar KDV hariç kabul edilir; oran Fatura ayarlarından (varsayılan %10) gelir.</Notice>
        <Tabs active={hepsi ? "/satis/isler?hepsi=1" : "/satis/isler"} items={[["/satis/isler", "Teslim edilenler"], ["/satis/isler?hepsi=1", "Tüm açık işler"]]} />
        {list.length === 0 && <p className="text-muted text-sm py-8 text-center">Faturalanmamış iş yok.</p>}
        {list.map((js) => {
          const total = js.reduce((t, j) => t + Number(j.total), 0);
          return (
            <form key={js[0].customer_id + js[0].currency} action={invoiceFromJobs} className="bg-white border border-line rounded-[14px] overflow-hidden">
              <header className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-3">
                <h2 className="font-semibold">{js[0].lab_customers?.name ?? "Hekim"}</h2>
                <span className="text-sm text-muted">{js.length} iş · <Money v={total} cur={js[0].currency} /></span>
                {lvl >= 2 && <PendingSubmit className={`${btnPrimary} h-9 ml-auto`}>Seçilenleri faturala</PendingSubmit>}
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead><tr className="text-xs text-muted"><th className={th}><span className="sr-only">Seç</span></th><th className={th}>İş</th><th className={th}>Hasta</th><th className={th}>Geliş</th><th className={th}>Teslim</th><th className={th}>Durum</th><th className={`${th} text-right`}>Tutar</th></tr></thead>
                  <tbody>
                    {js.map((j) => (
                      <tr key={j.id}>
                        <td className={td}><input type="checkbox" name="job" value={j.id} defaultChecked={j.status === "delivered"} aria-label={`İş ${j.no}`} /></td>
                        <td className={td}><Link href={`/isler/${j.id}`} className="font-semibold text-brand-700">#{j.no}</Link>{j.doctor_name && <span className="block text-xs text-muted">{j.doctor_name}</span>}</td>
                        <td className={td}>{j.patient ?? ""}</td>
                        <td className={td}>{formatDate(j.in_date)}</td>
                        <td className={td}>{j.delivered_at ? formatDate(j.delivered_at) : j.due_date ? formatDate(j.due_date) : ""}</td>
                        <td className={td}>{JOB_STATUS[j.status as keyof typeof JOB_STATUS]?.[0] ?? j.status}</td>
                        <td className={tdNum}><Money v={j.total} cur={j.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </form>
          );
        })}
      </div>
    </>
  );
}
