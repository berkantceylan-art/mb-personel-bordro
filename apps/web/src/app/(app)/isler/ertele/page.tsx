import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { todayTR } from "@/lib/postpone";
import { PostponeList, type PJob } from "./PostponeList";

export const dynamic = "force-dynamic";
export const metadata = { title: "İş erteleme" };


/** İş erteleme: bugün çıkamayan işleri ileri tarihe al; ertelenenler raporu */
export default async function PostponePage({ searchParams }: { searchParams: Promise<{ kapsam?: string; is?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const today = todayTR();
  const scope = sp.kapsam === "yarin" || sp.kapsam === "acik" ? sp.kapsam : "bugun";
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

  const sb = await createClient();
  let q = sb.from("jobs").select("id, no, patient, customer_id, due_date, delivery_time, status, postpone_count").in("status", ["open", "tryin", "ready"]).order("due_date").order("delivery_time").order("no").limit(800);
  if (scope === "bugun") q = q.lte("due_date", today);
  if (scope === "yarin") q = q.lte("due_date", tomorrow);
  const [{ data, error }, { data: cs }] = await Promise.all([
    q, sb.from("lab_customers").select("id, name"),
  ]);
  const names = new Map(((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  let rows = (data ?? []) as { id: string; no: number; patient: string | null; customer_id: string | null; due_date: string | null; delivery_time: string | null; status: string; postpone_count?: number }[];
  if (sp.is && !rows.some((r) => r.id === sp.is)) {
    const { data: one } = await sb.from("jobs").select("id, no, patient, customer_id, due_date, delivery_time, status, postpone_count").eq("id", sp.is).maybeSingle();
    if (one) rows = [one as typeof rows[number], ...rows];
  }
  const jobs: PJob[] = rows.map((r) => ({ id: r.id, no: r.no, patient: r.patient, customer: names.get(r.customer_id ?? "") ?? "—", due_date: r.due_date, delivery_time: r.delivery_time, status: r.status, postpone_count: Number(r.postpone_count ?? 0), late: !!r.due_date && r.due_date < today }));
  const tab = (k: string, l: string, n?: number) => <Link href={`/isler/ertele?kapsam=${k}`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold ${scope === k ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>{l}{n != null ? ` (${n})` : ""}</Link>;

  return (
    <>
      <PageHeader title="İş erteleme" subtitle="Bugün çıkamayacak işleri seçin, yeni teslim tarihini ve sebebi girin · her erteleme kayda geçer" actions={<span className="flex flex-wrap items-center gap-4 text-sm font-semibold"><Link href="/isler/ertele/rapor" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white">📊 Erteleme raporu</Link><Link href="/isler/prova" className="text-brand-700">Prova / teslim listesi</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/postpone/.test(error.message) ? "Supabase'de mbdental-16ekim.sql çalıştırılmalı." : error.message}</p>}
        <div className="flex flex-wrap gap-2">
          {tab("bugun", "Bugün çıkacak + geciken", scope === "bugun" ? jobs.length : undefined)}
          {tab("yarin", "Yarına kadar")}
          {tab("acik", "Tüm açık işler")}
        </div>
        <PostponeList jobs={jobs} preselect={sp.is} />

      </div>
    </>
  );
}
