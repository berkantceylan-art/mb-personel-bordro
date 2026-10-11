import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { MACHINE_KIND, MACHINE_STATUS, QUEUE_STATUS, pct, type Machine } from "@/lib/machines";
import { enqueueJob, machineEvent, queueAction, saveMachine } from "@/lib/machine-actions";

export const dynamic = "force-dynamic";

type Q = { id: string; units: number; planned_date: string; sort: number; status: string; started_at: string | null; finished_at: string | null; note: string | null; jobs: { id: string; no: number; patient: string | null; due_date: string | null; lab_customers: { name: string } | null } | null };
type E = { id: number; kind: string; started_at: string; ended_at: string | null; reason: string | null };
const EV: Record<string, string> = { down: "Arıza", maintenance: "Bakım", tool_change: "Takım değişimi", note: "Not" };
const dt = (s: string) => new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const dur = (a: string, b: string | null) => { const m = Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000); return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`; };

export default async function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("prd_machines").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as Machine;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: qd }, { data: ed }, { data: st }, { data: as }] = await Promise.all([
    supabase.from("prd_machine_queue").select("id, units, planned_date, sort, status, started_at, finished_at, note, jobs(id, no, patient, due_date, lab_customers(name))").eq("machine_id", id).or(`status.in.(queued,running),finished_at.gte.${since}`).order("status").order("sort").limit(200),
    supabase.from("prd_machine_events").select("id, kind, started_at, ended_at, reason").eq("machine_id", id).order("started_at", { ascending: false }).limit(50),
    supabase.from("prd_stations").select("id, name").eq("is_active", true).order("sort"),
    supabase.from("assets").select("id, name, code").is("disposed_on", null).order("name").limit(500),
  ]);
  const rows = (qd ?? []) as unknown as Q[];
  const open = rows.filter((r) => r.status === "queued" || r.status === "running").sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : a.sort - b.sort));
  const done = rows.filter((r) => !open.includes(r)).sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  const events = (ed ?? []) as E[];
  const down30 = events.filter((e) => (e.kind === "down" || e.kind === "maintenance") && e.started_at >= since).reduce((a, e) => a + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()), 0) / 3600000;
  const done30 = done.filter((r) => r.status === "done").reduce((a, r) => a + r.units, 0);
  const failed30 = done.filter((r) => r.status === "failed").reduce((a, r) => a + r.units, 0);
  const tool = pct(m.tool_used_units, m.tool_life_units);
  const isDown = m.status === "down" || m.status === "maintenance";
  const canEdit = (s.modules.production ?? 0) >= 3;
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm";
  const btn = "h-9 px-3 rounded-[10px] text-sm font-semibold";

  return (
    <>
      <PageHeader
        title={m.name}
        subtitle={`${MACHINE_KIND[m.kind]}${m.brand_model ? ` · ${m.brand_model}` : ""} · toplam ${Number(m.total_units).toLocaleString("tr-TR")} ünit`}
        actions={<span className="flex gap-3 items-center"><span className={`px-3 py-1 rounded-lg text-sm font-semibold ${MACHINE_STATUS[m.status]?.[1]}`}>{MACHINE_STATUS[m.status]?.[0]}</span>{m.asset_id && <Link href={`/demirbas/${m.asset_id}`} className="text-sm font-semibold text-brand-700">Demirbaş kaydı</Link>}<Link href="/uretim/makineler" className="text-sm font-semibold text-brand-700">Makineler</Link></span>}
      />
      <div className="p-4 md:p-6 max-w-[1320px] flex flex-col gap-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[["Son 30 gün işlenen", `${done30} ünit`, ""], ["Hatalı / kırık", `${failed30} ünit${done30 + failed30 ? ` · %${Math.round((failed30 / (done30 + failed30)) * 100)}` : ""}`, failed30 ? "text-bad" : ""], ["Duruş (30 gün)", `${down30.toFixed(1)} sa`, down30 > 8 ? "text-bad" : ""], [`${m.tool_name ?? "Takım"} ömrü`, tool !== null ? `%${tool} · ${m.tool_used_units}/${m.tool_life_units}` : "—", (tool ?? 0) >= 90 ? "text-bad" : ""]].map(([l, v, c]) => (
            <div key={l} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-xl font-bold mt-1 ${c}`}>{v}</div></div>
          ))}
        </div>

        <Card title="Durum ve bakım">
          <div className="flex flex-wrap gap-2 items-end">
            {isDown ? (
              <form action={machineEvent} className="flex flex-wrap gap-2 items-end"><input type="hidden" name="machine_id" value={m.id} /><input type="hidden" name="kind" value="up" /><input name="reason" maxLength={200} placeholder={m.status === "maintenance" ? "Yapılan bakım" : "Çözüm / not"} className={`${inp} w-64`} /><PendingSubmit className={`${btn} bg-ok text-white`}>{m.status === "maintenance" ? "Bakım bitti" : "Arıza giderildi"}</PendingSubmit></form>
            ) : (
              <form action={machineEvent} className="flex flex-wrap gap-2 items-end"><input type="hidden" name="machine_id" value={m.id} /><input name="reason" maxLength={300} placeholder="Neden (ör. mil hatası, kalibrasyon)" className={`${inp} w-64`} /><PendingSubmit name="kind" value="down" className={`${btn} bg-bad text-white`}>Arıza başlat</PendingSubmit><PendingSubmit name="kind" value="maintenance" className={`${btn} bg-[#D97706] text-white`}>Bakıma al</PendingSubmit></form>
            )}
            {m.tool_life_units && (
              <form action={machineEvent}><input type="hidden" name="machine_id" value={m.id} /><input type="hidden" name="kind" value="tool_change" /><PendingSubmit className={`${btn} border border-line`}>{m.tool_name ?? "Takım"} değiştirildi</PendingSubmit></form>
            )}
          </div>
          <div className="text-sm text-muted flex flex-wrap gap-x-6">
            {m.next_maintenance && <span>Sonraki bakım: <b className="text-ink">{formatDate(m.next_maintenance)}</b></span>}
            {m.maint_every_units && <span>Son bakımdan beri: <b className="text-ink">{m.units_since_maint} / {m.maint_every_units} ünit</b></span>}
            {m.tool_changed_at && <span>Son takım değişimi: <b className="text-ink">{dt(m.tool_changed_at)}</b></span>}
          </div>
        </Card>

        <Card title={`Kuyruk (${open.length})`}>
          <form action={enqueueJob} className="flex flex-wrap gap-2 items-end">
            <input type="hidden" name="machine_id" value={m.id} />
            <label className="text-xs font-semibold text-muted flex flex-col gap-1">İş no<input name="job_no" required inputMode="numeric" className={`${inp} w-28`} /></label>
            <label className="text-xs font-semibold text-muted flex flex-col gap-1">Ünit (boş: işin ünitleri)<input name="units" type="number" min={1} max={500} className={`${inp} w-28`} /></label>
            <label className="text-xs font-semibold text-muted flex flex-col gap-1">Gün<input name="planned_date" type="date" className={inp} /></label>
            <label className="text-xs font-semibold text-muted flex flex-col gap-1">Not<input name="note" maxLength={300} placeholder="ör. blok A2 98 mm" className={`${inp} w-56`} /></label>
            <PendingSubmit className={`${btn} h-10 bg-brand-700 text-white`}>Kuyruğa ekle</PendingSubmit>
          </form>
          <ol className="divide-y divide-[#EEF2F6]">
            {open.map((r, i) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="w-6 text-muted">{r.status === "running" ? "▶" : i + 1}</span>
                <span className="flex-1 min-w-[200px]">{r.jobs ? <Link href={`/isler/${r.jobs.id}`} className="font-semibold text-brand-700">#{r.jobs.no}</Link> : "—"} {r.jobs?.patient} <span className="text-muted">· {r.jobs?.lab_customers?.name}</span>{r.note && <span className="block text-xs text-muted">{r.note}</span>}</span>
                <span>{r.units} ünit</span>
                <span className="text-xs text-muted">{formatDate(r.planned_date)}{r.jobs?.due_date ? ` · teslim ${formatDate(r.jobs.due_date)}` : ""}</span>
                <span className={`text-xs font-semibold ${r.status === "running" ? "text-ok" : "text-muted"}`}>{QUEUE_STATUS[r.status]}{r.started_at ? ` · ${dur(r.started_at, null)}` : ""}</span>
                <form action={queueAction} className="flex gap-1">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="machine_id" value={m.id} />
                  {r.status === "queued" && <><PendingSubmit name="action" value="up" className={`${btn} border border-line`}>↑</PendingSubmit><PendingSubmit name="action" value="down" className={`${btn} border border-line`}>↓</PendingSubmit><PendingSubmit name="action" value="start" className={`${btn} bg-brand-700 text-white`}>Başlat</PendingSubmit></>}
                  <PendingSubmit name="action" value="done" className={`${btn} bg-ok text-white`}>Bitti</PendingSubmit>
                  <PendingSubmit name="action" value="failed" className={`${btn} border border-bad text-bad`}>Hatalı</PendingSubmit>
                  <PendingSubmit name="action" value="cancel" className={`${btn} text-muted`}>İptal</PendingSubmit>
                </form>
              </li>
            ))}
            {open.length === 0 && <li className="py-3 text-sm text-muted">Kuyruk boş.</li>}
          </ol>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Son 30 gün">
            <ul className="divide-y divide-[#EEF2F6] text-sm max-h-80 overflow-y-auto">
              {done.map((r) => <li key={r.id} className="py-1.5 flex justify-between gap-2"><span>{r.jobs ? <Link href={`/isler/${r.jobs.id}`} className="text-brand-700">#{r.jobs.no}</Link> : "—"} {r.jobs?.patient} · {r.units} ünit</span><span className={`text-xs ${r.status === "failed" ? "text-bad font-semibold" : "text-muted"}`}>{QUEUE_STATUS[r.status]} {r.finished_at ? dt(r.finished_at) : ""}</span></li>)}
              {done.length === 0 && <li className="py-2 text-muted">Kayıt yok.</li>}
            </ul>
          </Card>
          <Card title="Arıza, bakım, takım geçmişi">
            <form action={machineEvent} className="flex gap-2"><input type="hidden" name="machine_id" value={m.id} /><input type="hidden" name="kind" value="note" /><input name="reason" required maxLength={300} placeholder="Not ekle" className={`${inp} flex-1`} /><PendingSubmit className={`${btn} border border-line`}>Ekle</PendingSubmit></form>
            <ul className="divide-y divide-[#EEF2F6] text-sm max-h-80 overflow-y-auto">
              {events.map((e) => <li key={e.id} className="py-1.5"><b className={e.kind === "down" ? "text-bad" : e.kind === "maintenance" ? "text-warn" : ""}>{EV[e.kind]}</b> <span className="text-xs text-muted">{dt(e.started_at)}{(e.kind === "down" || e.kind === "maintenance") ? ` · ${e.ended_at ? dur(e.started_at, e.ended_at) : "sürüyor"}` : ""}</span>{e.reason && <div className="text-xs">{e.reason}</div>}</li>)}
              {events.length === 0 && <li className="py-2 text-muted">Kayıt yok.</li>}
            </ul>
          </Card>
        </div>

        {canEdit && (
          <Card title="Makine bilgileri">
            <form action={saveMachine} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="is_active_set" value="1" />
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Ad<input name="name" required defaultValue={m.name} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Tür<select name="kind" defaultValue={m.kind} className={inp}>{Object.entries(MACHINE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">İstasyon<select name="station_id" defaultValue={m.station_id ?? ""} className={inp}><option value="">—</option>{(st ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Demirbaş<select name="asset_id" defaultValue={m.asset_id ?? ""} className={inp}><option value="">—</option>{(as ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.code ? ` (${x.code})` : ""}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Marka / model<input name="brand_model" defaultValue={m.brand_model ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Günlük kapasite (ünit)<input name="daily_units" type="number" min={1} defaultValue={m.daily_units ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Takım adı<input name="tool_name" defaultValue={m.tool_name ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Takım ömrü (ünit)<input name="tool_life_units" type="number" min={1} defaultValue={m.tool_life_units ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Bakım aralığı (ünit)<input name="maint_every_units" type="number" min={1} defaultValue={m.maint_every_units ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Sonraki bakım<input name="next_maintenance" type="date" defaultValue={m.next_maintenance ?? ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1 lg:col-span-2">Not<input name="note" defaultValue={m.note ?? ""} maxLength={500} className={inp} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={m.is_active} /> Kullanımda</label>
              <div className="flex items-end"><PendingSubmit className={`${btn} h-10 bg-brand-700 text-white`}>Kaydet</PendingSubmit></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
