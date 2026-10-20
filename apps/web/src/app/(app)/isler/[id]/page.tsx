import Link from "next/link";
import { PostponeForm } from "@/components/PostponeForm";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { JobOutsourceButtons } from "../ortodonti/OutsourceClient";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { JOB_STATUS, type Job, type JobItem, type JobStep } from "@/lib/jobs";
import { JobEditor } from "../JobEditor";
import { CaseFileSender, JobFiles } from "../JobFiles";
import { JobThread, type ThreadItem } from "../JobThread";
import { ModelButton } from "@/components/ModelViewer";
import { KIND_LABEL, MODEL_RE, fmtBytes, kindOf, type FileKind } from "@/lib/case-files";
import { deleteJobFile } from "@/lib/case-actions";
import { aiShadeFromPhoto } from "@/lib/ai-actions";
import { waLink } from "@/lib/wa";
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
    supabase.from("job_files").select("*").eq("job_id", id).order("created_at"),
    editorOptions(),
    job.shipment_id ? supabase.from("shipments").select("id, no").eq("id", job.shipment_id).maybeSingle() : Promise.resolve({ data: null }),
    job.portal_case_id ? supabase.from("portal_cases").select("no, account_id").eq("id", job.portal_case_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const [{ data: nt }, { data: pf }, { data: pe }, { data: cu }] = await Promise.all([
    supabase.from("job_notes").select("id, body, author, author_name, created_at").eq("job_id", id).order("id"),
    job.portal_case_id ? supabase.from("portal_case_files").select("id, path, name, size, from_lab, created_at").eq("case_id", job.portal_case_id).order("created_at") : Promise.resolve({ data: [] }),
    job.portal_case_id ? supabase.from("portal_case_events").select("id, kind, status, body, from_lab, created_at").eq("case_id", job.portal_case_id).order("id") : Promise.resolve({ data: [] }),
    job.customer_id ? supabase.from("lab_customers").select("phone").eq("id", job.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  type F = { id: string; path: string; name: string; size: number | null; kind: FileKind; at: string; src: "job" | "portal"; fromLab?: boolean };
  const jobFiles: F[] = ((fl ?? []) as { id: string; path: string; name: string | null; size?: number | null; kind?: FileKind; created_at: string }[]).map((f) => ({ id: f.id, path: f.path, name: f.name ?? f.path.split("/").pop()!, size: f.size ?? null, kind: f.kind ?? kindOf(f.path), at: f.created_at, src: "job" }));
  const caseFiles: F[] = ((pf ?? []) as { id: string; path: string; name: string; size: number | null; from_lab: boolean; created_at: string }[]).map((f) => ({ id: f.id, path: f.path, name: f.name, size: f.size, kind: kindOf(f.name), at: f.created_at, src: "portal", fromLab: f.from_lab }));
  const files = [...caseFiles, ...jobFiles];
  const urls = new Map<string, string>();
  const sign = async (bucket: string, list: F[]) => {
    if (!list.length) return;
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(list.map((f) => f.path), 3600);
    (signed ?? []).forEach((u, i) => u.signedUrl && urls.set(list[i]!.path, u.signedUrl));
  };
  await Promise.all([sign("job-files", jobFiles), sign("portal-files", caseFiles)]);
  const STATUS_TR: Record<string, string> = { received: "Alındı", design: "Tasarım", production: "Üretim", quality: "Kalite kontrol", shipped: "Gönderildi", delivered: "Teslim edildi", on_hold: "Beklemede", cancelled: "İptal" };
  const thread: ThreadItem[] = [
    ...((pe ?? []) as { id: number; kind: string; status: string | null; body: string | null; from_lab: boolean; created_at: string }[]).map((e): ThreadItem => ({
      key: `e${e.id}`,
      kind: e.kind === "status" ? "status" : e.kind === "file" ? "file" : e.from_lab ? "lab" : "doctor",
      body: e.kind === "status" ? `Portal durumu: ${STATUS_TR[e.status ?? ""] ?? e.status}` : e.body ?? "",
      who: e.from_lab ? "Laboratuvar" : "Hekim",
      at: e.created_at,
    })),
    ...((nt ?? []) as { id: number; body: string; author: string; author_name: string | null; created_at: string }[]).map((n): ThreadItem => ({ key: `n${n.id}`, kind: "note", body: n.body, who: n.author_name ?? "", at: n.created_at, noteId: n.id, mine: n.author === s.userId })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const [{ data: osLabs }, { data: osOpen }] = await Promise.all([
    supabase.from("fin_parties").select("id, name").eq("outsource_lab", true).order("name"),
    supabase.from("job_outsource").select("id, sent_at").eq("job_id", id).eq("status", "sent").maybeSingle(),
  ]);
  const os = osOpen as { id: string; sent_at: string } | null;
  const wa = waLink((cu as { phone?: string | null } | null)?.phone, `İş #${job.no}${job.patient ? ` (${job.patient})` : ""}: `);
  // Pasif hekim seçiliyse listede görünsün
  let customers = opts.customers;
  if (job.customer_id && !customers.some((c) => c.id === job.customer_id)) {
    const { data: c } = await supabase.from("lab_customers").select("id, name, currency, discount_pct").eq("id", job.customer_id).maybeSingle();
    if (c) customers = [...customers, { id: c.id, name: `${c.name} (pasif)`, currency: c.currency, discount_pct: Number(c.discount_pct ?? 0), doctors: [] }];
  }
  const [label, cls] = JOB_STATUS[job.status];
  const shipment = sh.data as { id: string; no: number } | null;
  const pcase = pc.data as { no: number; account_id: string } | null;

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
            {(os || ["open", "tryin", "ready"].includes(job.status)) && <JobOutsourceButtons jobId={job.id} jobNo={job.no} openId={os?.id ?? null} sentDays={os ? Math.floor((Date.now() - new Date(os.sent_at).getTime()) / 86400000) : null} labs={(osLabs ?? []) as { id: string; name: string }[]} />}
            {["open", "tryin", "ready"].includes(job.status) && <PostponeForm ids={[job.id]} compact />}
            {Number((job as { postpone_count?: number }).postpone_count ?? 0) > 0 && <Link href="/isler/ertele?donem=ay" className="text-xs font-semibold rounded-full bg-[#FFEDD5] text-[#9A3412] px-2 py-1">↻ {(job as { postpone_count?: number }).postpone_count} kez ertelendi</Link>}
            <Link href={`/yazdir/is/${job.id}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Yazdır</Link>
            <Link href={`/yazdir/is-etiket/${job.id}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Kutu etiketi</Link>
            {shipment && <Link href={`/kargo/${shipment.id}`} className="text-sm font-semibold text-brand-700">Kargo kaydı</Link>}
            <Link href="/isler" className="text-sm font-semibold text-brand-700">İş listesi</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 max-w-[1320px] flex flex-col gap-4">
        <Card title="Dosyalar ve taramalar" action={<JobFiles jobId={job.id} />}>
          {files.length ? (
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {files.map((f) => {
                const u = urls.get(f.path);
                return (
                  <li key={f.src + f.id} className="rounded-lg overflow-hidden border border-line bg-[#F8FAFC] flex flex-col">
                    <a href={u} target="_blank" rel="noreferrer" className="block">
                      {u && f.kind === "photo" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u} alt={f.name} className="w-full aspect-square object-cover" />
                      ) : (
                        <span className="aspect-square grid place-items-center text-center p-2">
                          <span><b className="block font-display text-xl text-brand-700">{(f.name.split(".").pop() ?? "").toUpperCase().slice(0, 4)}</b><span className="text-[11px] text-muted">{KIND_LABEL[f.kind]}</span></span>
                        </span>
                      )}
                    </a>
                    <div className="px-2 py-1.5 text-[11px] flex flex-col gap-0.5">
                      <span className="truncate font-semibold" title={f.name}>{f.name}</span>
                      <span className="text-muted">{f.src === "portal" ? (f.fromLab ? "Hekime gönderildi" : "Hekimden (portal)") : "Laboratuvar"}{f.size ? ` · ${fmtBytes(f.size)}` : ""}</span>
                      <span className="flex gap-3">
                        {u && MODEL_RE.test(f.name) && <ModelButton url={u} name={f.name} />}
                        {f.src === "job" && f.kind === "photo" && <form action={aiShadeFromPhoto}><input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="path" value={f.path} /><PendingSubmit className="font-semibold text-[#6D28D9]">✨ Renk öner</PendingSubmit></form>}
                        {f.src === "job" && (
                          <form action={deleteJobFile}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="job_id" value={job.id} /><ConfirmSubmit label="Sil" question={`${f.name} silinsin mi?`} className="text-bad font-semibold" /></form>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Henüz dosya yok. Fotoğraf, ağız içi tarama (STL / PLY / OBJ) ya da ZIP yükleyebilirsiniz; STL, PLY ve OBJ tarayıcıda 3D açılır.</p>
          )}
        </Card>
        <div id="mesajlar">
          <Card title={pcase ? `Konuşma · portal vakası #${pcase.no}` : "İç notlar"} action={pcase && job.portal_case_id ? <CaseFileSender jobId={job.id} caseId={job.portal_case_id} accountId={pcase.account_id} /> : undefined}>
            <JobThread jobId={job.id} items={thread} portal={!!pcase} waHref={wa} />
          </Card>
        </div>
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
