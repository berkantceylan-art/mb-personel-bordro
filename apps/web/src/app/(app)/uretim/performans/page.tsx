import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EmptyRow, KPI, Notice, Table, btnSecondary, inputCls, page, td, tdNum } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateOk } from "@/lib/fin";
import { FLOW_ROLE } from "@/lib/flow";
import { minutes } from "@/lib/production";

export const dynamic = "force-dynamic";

type R = { employee_id: string; name: string; flow_role: string; takes: number; dones: number; units: number; work_minutes: number; rejects_received: number; rejects_given: number; approvals: number; exits: number; holding: number; on_time: number; finished_jobs: number };

/** Personel performansı: kutu okutmalarından (aldı / bitirdi / onay / geri / çıkış) */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const sp = await searchParams;
  const t = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const from = dateOk(sp.bas) ?? t.slice(0, 8) + "01";
  const to = dateOk(sp.bit) ?? t;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_people_stats", { p_from: `${from}T00:00:00+03:00`, p_to: `${to}T23:59:59+03:00` });
  const rows = (data ?? []) as R[];
  const tech = rows.filter((r) => r.flow_role === "technician");
  const other = rows.filter((r) => r.flow_role !== "technician");
  const maxUnits = Math.max(1, ...tech.map((r) => r.units));
  const totalDone = tech.reduce((x, r) => x + r.dones, 0);
  const totalRej = tech.reduce((x, r) => x + r.rejects_received, 0);
  const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : "—");

  return (
    <>
      <PageHeader title="Personel performansı" subtitle="Kutu okutmalarından otomatik ölçülür: kim ne kadar iş yaptı, ne kadar sürede, kaçı geri döndü" actions={<Link href="/uretim/nerede" className="text-sm font-semibold text-brand-700">İş nerede</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</Notice>}
        <form className="flex flex-wrap gap-2">
          <input type="date" name="bas" defaultValue={from} className={`${inputCls} w-44`} aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to} className={`${inputCls} w-44`} aria-label="Bitiş" />
          <button className={btnSecondary}>Göster</button>
        </form>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Teknisyenlerin bitirdiği" value={totalDone} sub={`${tech.reduce((x, r) => x + r.units, 0)} birim`} />
          <KPI label="Geri dönen" value={totalRej} sub={`hata oranı ${pct(totalRej, totalDone)}`} tone={totalRej ? "bad" : "ok"} />
          <KPI label="Kalite onayı" value={other.filter((r) => r.flow_role === "qc").reduce((x, r) => x + r.approvals, 0)} />
          <KPI label="Çıkış (cariye işlenen)" value={other.filter((r) => r.flow_role === "dispatch").reduce((x, r) => x + r.exits, 0)} />
        </div>

        <h2 className="font-semibold">Teknisyenler</h2>
        <Table head={["Personel", "Biten iş", "Birim", "", "Çalışma", "Dk / birim", "Geri dönen", "Hata", "Zamanında", "Elinde"]} min={1000}>
          {tech.map((r) => (
            <tr key={r.employee_id}>
              <td className={td}><b>{r.name}</b></td>
              <td className={tdNum}>{r.dones}</td>
              <td className={tdNum}>{r.units}</td>
              <td className={`${td} w-40`}><div className="h-2 rounded-full bg-[#EEF2F6]"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(r.units / maxUnits) * 100}%` }} /></div></td>
              <td className={tdNum}>{minutes(r.work_minutes)}</td>
              <td className={tdNum}>{r.units ? Math.round(r.work_minutes / r.units) : "—"}</td>
              <td className={`${tdNum} ${r.rejects_received ? "text-bad font-semibold" : ""}`}>{r.rejects_received}</td>
              <td className={`${tdNum} ${r.dones && r.rejects_received / r.dones > 0.1 ? "text-bad" : ""}`}>{pct(r.rejects_received, r.dones)}</td>
              <td className={tdNum}>{pct(r.on_time, r.finished_jobs)}</td>
              <td className={tdNum}>{r.holding}</td>
            </tr>
          ))}
          {tech.length === 0 && <EmptyRow cols={10} text="Bu dönemde okutma yok." />}
        </Table>

        <h2 className="font-semibold">Şef, kontrol ve pazarlama</h2>
        <Table head={["Personel", "Rol", "Aldığı", "Onay", "Geri gönderdiği", "Çıkış", "Ort. kontrol süresi", "Elinde"]} min={860}>
          {other.map((r) => (
            <tr key={r.employee_id}>
              <td className={td}><b>{r.name}</b></td>
              <td className={td}>{FLOW_ROLE[r.flow_role]}</td>
              <td className={tdNum}>{r.takes}</td>
              <td className={tdNum}>{r.approvals}</td>
              <td className={tdNum}>{r.rejects_given}</td>
              <td className={tdNum}>{r.exits}</td>
              <td className={tdNum}>{r.approvals + r.rejects_given + r.exits ? minutes(r.work_minutes / (r.approvals + r.rejects_given + r.exits)) : "—"}</td>
              <td className={tdNum}>{r.holding}</td>
            </tr>
          ))}
          {other.length === 0 && <EmptyRow cols={8} text="—" />}
        </Table>
        <p className="text-xs text-muted">Çalışma süresi: kutuyu okutup aldığı an ile bırakıp okuttuğu an arası. Hata oranı: geri gönderilen iş / bitirdiği iş. Zamanında: teslim tarihinden önce bitirdikleri.</p>
      </div>
    </>
  );
}
