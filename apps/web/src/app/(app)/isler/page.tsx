import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { JOB_STATUS, MATERIALS, money, teethByMaterial, type Job } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const TABS = [
  ["acik", "Açık işler"],
  ["bugun", "Bugün çıkacak"],
  ["geciken", "Geciken"],
  ["tumu", "Tümü"],
] as const;

/** İş listesi */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ sekme?: string; q?: string; hekim?: string; bas?: string; bit?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.sekme) ? sp.sekme! : "acik";
  const today = todayIso();
  const supabase = await createClient();
  let query = supabase.from("jobs").select("*").order("no", { ascending: false }).limit(500);
  if (tab === "acik") query = query.in("status", ["open", "tryin", "ready"]);
  if (tab === "bugun") query = query.eq("due_date", today).neq("status", "delivered").neq("status", "cancelled");
  if (tab === "geciken") query = query.lt("due_date", today).in("status", ["open", "tryin", "ready"]);
  if (sp.hekim) query = query.eq("customer_id", sp.hekim);
  if (sp.bas) query = query.gte("in_date", sp.bas);
  if (sp.bit) query = query.lte("in_date", sp.bit);
  const [{ data, error }, { data: cs }, { count: openCount }, { count: lateCount }, { count: todayCount }] = await Promise.all([
    query,
    supabase.from("lab_customers").select("id, name").order("name"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "tryin", "ready"]),
    supabase.from("jobs").select("id", { count: "exact", head: true }).lt("due_date", today).in("status", ["open", "tryin", "ready"]),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("due_date", today).in("status", ["open", "tryin", "ready"]),
  ]);
  const names = new Map((cs ?? []).map((c) => [c.id as string, c.name as string]));
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const jobs = ((data ?? []) as Job[]).filter((j) => !q || `${j.no} ${j.slip_no ?? ""} ${j.patient ?? ""} ${j.doctor_name ?? ""} ${names.get(j.customer_id ?? "") ?? ""}`.toLocaleLowerCase("tr").includes(q));
  const th = "py-2.5 px-3 font-semibold border-b border-line text-left whitespace-nowrap";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm";

  return (
    <>
      <PageHeader
        title="İş listesi"
        subtitle="Laboratuvara giren işler, provalar ve teslimler"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/isler/yeni" className="h-11 px-4 inline-flex items-center rounded-[10px] bg-[#E53935] text-white font-semibold">+ İş kayıt</Link>
            <Link href="/isler/prova" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Prova / teslim listesi</Link>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">İş kayıt tabloları yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        <section className="grid gap-3 grid-cols-3">
          <Stat label="Açık iş" value={String(openCount ?? 0)} href="/isler?sekme=acik" />
          <Stat label="Bugün çıkacak" value={String(todayCount ?? 0)} href="/isler?sekme=bugun" />
          <Stat label="Geciken" value={String(lateCount ?? 0)} href="/isler?sekme=geciken" />
        </section>
        <nav className="flex flex-wrap gap-2">
          {TABS.map(([k, l]) => (
            <Link key={k} href={`/isler?sekme=${k}`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold ${tab === k ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>{l}</Link>
          ))}
        </nav>
        <form className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="sekme" value={tab} />
          <input name="q" defaultValue={sp.q} placeholder="İş no, fiş, hasta, doktor" className={`${input} flex-1 min-w-48`} />
          <select name="hekim" defaultValue={sp.hekim ?? ""} className={`${input} max-w-60`}>
            <option value="">Tüm hekimler</option>
            {(cs ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" name="bas" defaultValue={sp.bas} className={input} aria-label="Giriş başlangıç" />
          <input type="date" name="bit" defaultValue={sp.bit} className={input} aria-label="Giriş bitiş" />
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
        </form>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-xs text-muted"><th className={th}>No</th><th className={th}>Hekim / hastane</th><th className={th}>Hasta</th><th className={th}>Diş</th><th className={th}>Giriş</th><th className={th}>Çıkış</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Durum</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const [label, cls] = JOB_STATUS[j.status];
                const late = j.due_date && j.due_date < today && ["open", "tryin", "ready"].includes(j.status);
                const counts = teethByMaterial(j.teeth ?? {});
                return (
                  <tr key={j.id} className="hover:bg-[#F8FAFC]">
                    <td className={`${td} num`}><Link href={`/isler/${j.id}`} className="font-bold text-brand-700">#{j.no}</Link>{j.slip_no && <div className="text-xs text-muted">fiş {j.slip_no}</div>}</td>
                    <td className={td}>{names.get(j.customer_id ?? "") ?? "—"}{j.doctor_name && <div className="text-xs text-muted">{j.doctor_name}</div>}</td>
                    <td className={td}>{j.patient ?? "—"}{j.shade && <div className="text-xs text-muted">renk {j.shade}</div>}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(counts).map(([m, n]) => <span key={m} className="text-[11px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: MATERIALS[m]?.[1] }}>{MATERIALS[m]?.[0]} {n}</span>)}
                      </div>
                    </td>
                    <td className={`${td} num`}>{formatDate(j.in_date)}</td>
                    <td className={`${td} num ${late ? "text-bad font-semibold" : ""}`}>{j.due_date ? formatDate(j.due_date) : "—"}{j.delivery_time ? ` ${j.delivery_time}` : ""}</td>
                    <td className={`${td} num text-right`}>{money(j.total, j.currency)}</td>
                    <td className={td}><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span></td>
                  </tr>
                );
              })}
              {jobs.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">İş yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
