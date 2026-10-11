import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { JOB_STATUS, type Job, type JobItem, type JobStep } from "@/lib/jobs";
import { JobEditor } from "../JobEditor";
import { JobFiles } from "../JobFiles";
import { JobProduction } from "../JobProduction";
import { JobFlow } from "../JobFlow";
import { deleteJob, setJobStatus } from "../actions";
import { editorOptions } from "../data";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const job = data as Job;
  const [{ data: it }, { data: st }, { data: fl }, opts, sh, pc] = await Promise.all([
    supabase.from("job_items").select("id, product_id, name, qty, unit_price, amount, kind").eq("job_id", id).order("sort"),
    supabase.from("job_steps").select("id, kind, out_date, back_date, delivery_method, delivery_time, done, note").eq("job_id", id).order("sort"),
    supabase.from("job_files").select("id, path, name, created_at").eq("job_id", id).order("created_at"),
    editorOptions(),
    job.shipment_id ? supabase.from("shipments").select("id, no").eq("id", job.shipment_id).maybeSingle() : Promise.resolve({ data: null }),
    job.portal_case_id ? supabase.from("portal_cases").select("no").eq("id", job.portal_case_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const files = (fl ?? []) as { id: string; path: string; name: string | null; created_at: string }[];
  const urls = new Map<string, string>();
  if (files.length) {
    const { data: signed } = await supabase.storage.from("job-files").createSignedUrls(files.map((f) => f.path), 3600);
    (signed ?? []).forEach((u, i) => u.signedUrl && urls.set(files[i]!.path, u.signedUrl));
  }
  // Pasif hekim seçiliyse listede görünsün
  let customers = opts.customers;
  if (job.customer_id && !customers.some((c) => c.id === job.customer_id)) {
    const { data: c } = await supabase.from("lab_customers").select("id, name, currency, discount_pct").eq("id", job.customer_id).maybeSingle();
    if (c) customers = [...customers, { id: c.id, name: `${c.name} (pasif)`, currency: c.currency, discount_pct: Number(c.discount_pct ?? 0), doctors: [] }];
  }
  const [label, cls] = JOB_STATUS[job.status];
  const shipment = sh.data as { id: string; no: number } | null;
  const pcase = pc.data as { no: number } | null;

  return (
    <>
      <PageHeader
        title={`İş #${job.no}`}
        subtitle={[job.patient, shipment ? `Kargo G${shipment.no}` : "", pcase ? `Portal vakası #${pcase.no}` : ""].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <span className={`text-sm font-semibold px-3 py-1 rounded-lg ${cls}`}>{label}</span>
            {job.status !== "delivered" && (
              <form action={setJobStatus}>
                <input type="hidden" name="id" value={job.id} />
                <button name="status" value={job.status === "ready" ? "delivered" : "ready"} className="h-10 px-3 rounded-[10px] bg-ok text-white text-sm font-semibold">{job.status === "ready" ? "Teslim edildi (cariye işle)" : "Hazır"}</button>
              </form>
            )}
            <Link href={`/yazdir/is/${job.id}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Yazdır</Link>
            <Link href={`/yazdir/is-etiket/${job.id}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Kutu etiketi</Link>
            {shipment && <Link href={`/kargo/${shipment.id}`} className="text-sm font-semibold text-brand-700">Kargo kaydı</Link>}
            <Link href="/isler" className="text-sm font-semibold text-brand-700">İş listesi</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 max-w-[1320px] flex flex-col gap-4">
        <Card title="Resimler" action={<JobFiles jobId={job.id} />}>
          {files.length ? (
            <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {files.map((f) => {
                const u = urls.get(f.path);
                const img = /\.(jpe?g|png|webp|heic)$/i.test(f.path);
                return (
                  <li key={f.id} className="rounded-lg overflow-hidden border border-line bg-[#F8FAFC]">
                    <a href={u} target="_blank" rel="noreferrer">
                      {u && img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u} alt={f.name ?? ""} className="w-full aspect-square object-cover" />
                      ) : (
                        <span className="aspect-square grid place-items-center text-sm font-semibold text-brand-700">PDF</span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Henüz resim yok.</p>
          )}
        </Card>
        <JobFlow job={job as Job & { flow_stage?: string | null; holder_employee_id?: string | null; holder_since?: string | null; chief_passed_at?: string | null; qc_passed_at?: string | null }} />
        <JobProduction jobId={job.id} canEdit={s.logistics || (s.modules.production ?? 0) >= 2} />
        <JobEditor
          job={job}
          initialItems={(it ?? []) as JobItem[]}
          initialSteps={(st ?? []) as JobStep[]}
          customers={customers}
          products={opts.products}
          delivery={opts.delivery}
          tryins={opts.tryins}
        />
        {["owner", "accountant", "hr"].includes(s.role) && (
          <form action={deleteJob} className="text-right -mt-20 mb-28">
            <input type="hidden" name="id" value={job.id} />
            <ConfirmSubmit label="İş kaydını sil" question="İş kaydı, satırları ve resimleri silinsin mi?" className="text-sm text-bad font-semibold" />
          </form>
        )}
      </div>
    </>
  );
}
