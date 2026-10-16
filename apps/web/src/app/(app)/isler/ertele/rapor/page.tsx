import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { POSTPONE_REASONS, todayTR } from "@/lib/postpone";
import { loadPostpones, type PRow } from "@/lib/postpone-report";

export const dynamic = "force-dynamic";
export const metadata = { title: "Erteleme raporu" };

const fmt = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ST: Record<string, string> = { open: "Açık", tryin: "Provada", ready: "Hazır", delivered: "Teslim edildi", cancelled: "İptal" };

function group<T extends string>(rows: PRow[], key: (r: PRow) => T) {
  const m = new Map<T, PRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}
function Bars({ title, items, total }: { title: string; items: [string, number, string?][]; total: number }) {
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
      <h3 className="font-display font-bold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map(([l, n, sub]) => (
          <li key={l} className="flex items-center gap-2 text-sm">
            <span className="w-44 truncate" title={l}>{l}</span>
            <span className="flex-1 h-2.5 rounded-full bg-[#EEF2F6]"><span className="block h-2.5 rounded-full bg-[#EA580C]" style={{ width: `${Math.max(3, (n / Math.max(1, total)) * 100)}%` }} /></span>
            <span className="tabular-nums w-10 text-right font-semibold">{n}</span>{sub && <span className="text-xs text-muted w-20 text-right">{sub}</span>}
          </li>
        ))}
        {!items.length && <li className="text-sm text-muted">Kayıt yok.</li>}
      </ul>
    </section>
  );
}

/** Ayrıntılı iş erteleme raporu: dönem, sebep, hekim, gün, kişi; tekrar ertelenen işler; Excel */
export default async function PostponeReport({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; sebep?: string; hekim?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const today = todayTR();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.bit ?? "") ? sp.bit! : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.bas ?? "") ? sp.bas! : shift(to, -29);
  const reason = sp.sebep && POSTPONE_REASONS[sp.sebep] ? sp.sebep : "";
  const sb = await createClient();
  const { rows, error } = await loadPostpones(sb, { from, to, reason: reason || undefined, customer: sp.hekim || undefined });
  const { data: cs } = await sb.from("lab_customers").select("id, name").order("name").limit(2000);
  const jobs = new Set(rows.map((r) => r.job_id));
  const avgDays = rows.length ? (rows.reduce((a, r) => a + r.days, 0) / rows.length).toFixed(1) : "0";
  const repeat = group(rows, (r) => r.job_id).filter(([, rs]) => rs.length > 1 || rs[0]!.count > 1).map(([, rs]) => rs[0]!).sort((a, b) => b.count - a.count).slice(0, 30);
  const byDay = group(rows, (r) => r.at.slice(0, 10)).sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(1, ...byDay.map(([, r]) => r.length));
  const qs = new URLSearchParams({ bas: from, bit: to, ...(reason ? { sebep: reason } : {}), ...(sp.hekim ? { hekim: sp.hekim } : {}) }).toString();
  const quick = [["Bugün", today, today], ["Son 7 gün", shift(today, -6), today], ["Son 30 gün", shift(today, -29), today], ["Bu ay", `${today.slice(0, 7)}-01`, today]] as const;
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";

  return (
    <>
      <PageHeader title="Erteleme raporu" subtitle={`${fmt(from)} – ${fmt(to)} · ertelenen işler, sebepler, hekimler ve tekrar ertelenenler`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/isler/ertele" className="text-brand-700">← İş erteleme</Link><a href={`/isler/ertele/rapor/excel?${qs}`} className="text-brand-700">⬇ Excel</a></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/postpone/.test(error) ? "Supabase'de mbdental-16ekim.sql çalıştırılmalı." : error}</p>}
        <div className="flex flex-wrap gap-2">
          {quick.map(([l, a, b]) => <Link key={l} href={`/isler/ertele/rapor?${new URLSearchParams({ bas: a, bit: b, ...(reason ? { sebep: reason } : {}), ...(sp.hekim ? { hekim: sp.hekim } : {}) })}`} className={`h-9 px-3 inline-flex items-center rounded-full text-xs font-semibold ${from === a && to === b ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>{l}</Link>)}
        </div>
        <form className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line bg-white p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="date" name="bas" defaultValue={from} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="date" name="bit" defaultValue={to} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Sebep<select name="sebep" defaultValue={reason} className={inp}><option value="">Tümü</option>{Object.entries(POSTPONE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Hekim<select name="hekim" defaultValue={sp.hekim ?? ""} className={`${inp} w-56`}><option value="">Tümü</option>{((cs ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Uygula</button>
        </form>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[["Erteleme", String(rows.length)], ["Farklı iş", String(jobs.size)], ["Ortalama kayma", `${avgDays} gün`], ["Tekrar ertelenen iş", String(repeat.length)]].map(([l, v]) => (
            <div key={l} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs text-muted">{l}</div><div className="font-display text-2xl font-bold">{v}</div></div>
          ))}
        </div>

        <section className="rounded-[16px] border border-line bg-white p-4">
          <h3 className="font-display font-bold mb-2">Günlere göre</h3>
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {byDay.map(([d, r]) => <div key={d} className="flex flex-col items-center gap-1 min-w-7" title={`${fmt(d)}: ${r.length}`}><span className="text-[10px] tabular-nums">{r.length}</span><span className="w-5 rounded-t bg-[#EA580C]" style={{ height: `${(r.length / maxDay) * 90}px` }} /><span className="text-[9px] text-muted">{d.slice(8, 10)}.{d.slice(5, 7)}</span></div>)}
            {!byDay.length && <p className="text-sm text-muted">Kayıt yok.</p>}
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <Bars title="Sebepler" total={rows.length} items={group(rows, (r) => r.reason).map(([k, r]) => [POSTPONE_REASONS[k] ?? k, r.length, `%${Math.round((r.length / Math.max(1, rows.length)) * 100)}`])} />
          <Bars title="Hekimler" total={rows.length} items={group(rows, (r) => r.customer).slice(0, 12).map(([k, r]) => [k, r.length, `${new Set(r.map((x) => x.job_id)).size} iş`])} />
          <Bars title="Erteleyen kişi" total={rows.length} items={group(rows, (r) => r.by).slice(0, 12).map(([k, r]) => [k, r.length])} />
        </div>

        {repeat.length > 0 && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h3 className="font-display font-bold">Tekrar tekrar ertelenen işler</h3>
            <ul className="flex flex-wrap gap-2">{repeat.map((r) => <li key={r.job_id}><Link href={`/isler/${r.job_id}`} className="inline-flex gap-1.5 rounded-full border border-[#F2C38B] bg-[#FFF7ED] px-3 py-1 text-xs"><b>#{r.no}</b>{r.customer}<span className="font-semibold text-[#9A3412]">↻ {r.count}</span></Link></li>)}</ul>
          </section>
        )}

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <h3 className="font-display font-bold px-4 pt-4">Tüm ertelemeler ({rows.length})</h3>
          <table className="w-full text-sm min-w-[900px] mt-2">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Zaman</th><th className="p-3">İş</th><th className="p-3">Hekim</th><th className="p-3">Eski → yeni</th><th className="p-3 text-right">Gün</th><th className="p-3">Sebep</th><th className="p-3">Not</th><th className="p-3">Erteleyen</th><th className="p-3">Şu an</th></tr></thead>
            <tbody>
              {rows.slice(0, 1000).map((r) => (
                <tr key={r.id} className="border-t border-[#EEF2F6]">
                  <td className="p-3 whitespace-nowrap tabular-nums">{new Date(r.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="p-3"><Link href={`/isler/${r.job_id}`} className="font-semibold text-brand-700">#{r.no}</Link> <span className="text-muted">{r.patient ?? ""}</span>{r.count > 1 && <span className="ml-1 text-[11px] text-[#9A3412] font-semibold">↻{r.count}</span>}</td>
                  <td className="p-3">{r.customer}</td>
                  <td className="p-3 whitespace-nowrap tabular-nums">{fmt(r.from)} → <b>{fmt(r.to)}</b></td>
                  <td className="p-3 text-right tabular-nums">{r.days}</td>
                  <td className="p-3">{POSTPONE_REASONS[r.reason] ?? r.reason}</td>
                  <td className="p-3 text-muted">{r.note ?? ""}</td>
                  <td className="p-3">{r.by}</td>
                  <td className="p-3 text-xs">{ST[r.status] ?? r.status}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="p-8 text-center text-muted">Bu dönemde erteleme yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
