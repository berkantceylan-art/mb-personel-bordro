import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { POSTPONE_REASONS, todayTR } from "@/lib/postpone";
import { PostponeList, type PJob } from "./PostponeList";

export const dynamic = "force-dynamic";
export const metadata = { title: "İş erteleme" };

type Report = { total: number; jobs: number; by_reason: { reason: string; n: number }[]; by_customer: { customer: string; n: number }[]; by_day: { d: string; n: number }[];
  rows: { id: string; job_id: string; no: number; patient: string | null; customer: string | null; status: string; from: string | null; to: string; reason: string; note: string | null; at: string }[] };

const fmt = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");

/** İş erteleme: bugün çıkamayan işleri ileri tarihe al; ertelenenler raporu */
export default async function PostponePage({ searchParams }: { searchParams: Promise<{ kapsam?: string; is?: string; donem?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const today = todayTR();
  const scope = sp.kapsam === "yarin" || sp.kapsam === "acik" ? sp.kapsam : "bugun";
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const days = sp.donem === "ay" ? 30 : sp.donem === "bugun" ? 0 : 7;
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

  const sb = await createClient();
  let q = sb.from("jobs").select("id, no, patient, customer_id, due_date, delivery_time, status, postpone_count").in("status", ["open", "tryin", "ready"]).order("due_date").order("delivery_time").order("no").limit(800);
  if (scope === "bugun") q = q.lte("due_date", today);
  if (scope === "yarin") q = q.lte("due_date", tomorrow);
  const [{ data, error }, { data: cs }, { data: rep, error: repErr }] = await Promise.all([
    q, sb.from("lab_customers").select("id, name"), sb.rpc("job_postpone_report", { p_from: from, p_to: today }),
  ]);
  const names = new Map(((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  let rows = (data ?? []) as { id: string; no: number; patient: string | null; customer_id: string | null; due_date: string | null; delivery_time: string | null; status: string; postpone_count?: number }[];
  if (sp.is && !rows.some((r) => r.id === sp.is)) {
    const { data: one } = await sb.from("jobs").select("id, no, patient, customer_id, due_date, delivery_time, status, postpone_count").eq("id", sp.is).maybeSingle();
    if (one) rows = [one as typeof rows[number], ...rows];
  }
  const jobs: PJob[] = rows.map((r) => ({ id: r.id, no: r.no, patient: r.patient, customer: names.get(r.customer_id ?? "") ?? "—", due_date: r.due_date, delivery_time: r.delivery_time, status: r.status, postpone_count: Number(r.postpone_count ?? 0), late: !!r.due_date && r.due_date < today }));
  const r = rep as Report | null;
  const tab = (k: string, l: string, n?: number) => <Link href={`/isler/ertele?kapsam=${k}`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold ${scope === k ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>{l}{n != null ? ` (${n})` : ""}</Link>;

  return (
    <>
      <PageHeader title="İş erteleme" subtitle="Bugün çıkamayacak işleri seçin, yeni teslim tarihini ve sebebi girin · her erteleme kayda geçer" actions={<Link href="/isler/prova" className="text-sm font-semibold text-brand-700">Prova / teslim listesi</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {(error || repErr) && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/postpone/.test((error ?? repErr)!.message) ? "Supabase'de mbdental-is-erteleme.sql çalıştırılmalı." : (error ?? repErr)!.message}</p>}
        <div className="flex flex-wrap gap-2">
          {tab("bugun", "Bugün çıkacak + geciken", scope === "bugun" ? jobs.length : undefined)}
          {tab("yarin", "Yarına kadar")}
          {tab("acik", "Tüm açık işler")}
        </div>
        <PostponeList jobs={jobs} preselect={sp.is} />

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold mr-auto">Ertelenen işler</h2>
            {[["bugun", "Bugün"], ["hafta", "Son 7 gün"], ["ay", "Son 30 gün"]].map(([k, l]) => (
              <Link key={k} href={`/isler/ertele?kapsam=${scope}&donem=${k}`} className={`h-9 px-3 inline-flex items-center rounded-full text-xs font-semibold ${(sp.donem ?? "hafta") === k ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>{l}</Link>
            ))}
          </div>
          {r && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line p-3"><div className="text-xs text-muted">Erteleme</div><div className="text-2xl font-bold tabular-nums">{r.total}</div><div className="text-xs text-muted">{r.jobs} farklı iş</div></div>
                <div className="rounded-xl border border-line p-3 sm:col-span-2">
                  <div className="text-xs text-muted mb-1">Sebepler</div>
                  <ul className="grid gap-1">
                    {r.by_reason.map((b) => (
                      <li key={b.reason} className="flex items-center gap-2 text-sm">
                        <span className="w-48 truncate">{POSTPONE_REASONS[b.reason] ?? b.reason}</span>
                        <span className="h-2 rounded-full bg-[#EA580C]" style={{ width: `${Math.max(4, (b.n / Math.max(1, r.total)) * 100)}%`, maxWidth: "60%" }} />
                        <span className="tabular-nums text-muted">{b.n}</span>
                      </li>
                    ))}
                    {!r.by_reason.length && <li className="text-sm text-muted">Bu dönemde erteleme yok.</li>}
                  </ul>
                </div>
              </div>
              {r.by_customer.length > 0 && <p className="text-xs text-muted">En çok ertelenen hekimler: {r.by_customer.slice(0, 5).map((c) => `${c.customer} (${c.n})`).join(" · ")}</p>}
              {r.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted"><th className="py-2 pr-3">Zaman</th><th className="pr-3">İş</th><th className="pr-3">Hekim</th><th className="pr-3">Eski → yeni tarih</th><th className="pr-3">Sebep</th><th>Not</th></tr></thead>
                    <tbody>
                      {r.rows.map((x) => (
                        <tr key={x.id} className="border-t border-[#EEF2F6]">
                          <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{new Date(x.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="pr-3"><Link href={`/isler/${x.job_id}`} className="font-semibold text-brand-700">#{x.no}</Link> <span className="text-muted">{x.patient ?? ""}</span></td>
                          <td className="pr-3">{x.customer ?? "—"}</td>
                          <td className="pr-3 tabular-nums whitespace-nowrap">{fmt(x.from)} → <b>{fmt(x.to)}</b></td>
                          <td className="pr-3">{POSTPONE_REASONS[x.reason] ?? x.reason}</td>
                          <td className="text-muted">{x.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
