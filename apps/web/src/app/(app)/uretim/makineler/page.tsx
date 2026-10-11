import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { MACHINE_KIND, MACHINE_STATUS, pct, type Machine } from "@/lib/machines";
import { saveMachine } from "@/lib/machine-actions";

export const dynamic = "force-dynamic";

type Cap = { station_id: string; station: string; color: string | null; day: string; load: number; capacity: number | null };
const DOW = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Makineler ve kapasite: makine durumu, takım ömrü, bakım; istasyon bazında önümüzdeki günlerin yükü */
export default async function MachinesPage() {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const supabase = await createClient();
  const [{ data: md, error }, { data: cd }, { data: qd }, { data: st }, { data: as }] = await Promise.all([
    supabase.from("prd_machines").select("*").order("is_active", { ascending: false }).order("name"),
    supabase.rpc("prd_capacity", { p_days: 10 }),
    supabase.from("prd_machine_queue").select("machine_id, units, status").in("status", ["queued", "running"]),
    supabase.from("prd_stations").select("id, name").eq("is_active", true).order("sort"),
    supabase.from("assets").select("id, name, code").is("disposed_on", null).order("name").limit(500),
  ]);
  const machines = (md ?? []) as Machine[];
  const cap = (cd ?? []) as Cap[];
  const queue = (qd ?? []) as { machine_id: string; units: number; status: string }[];
  const days = [...new Set(cap.map((c) => c.day))];
  const stations = [...new Map(cap.map((c) => [c.station_id, { id: c.station_id, name: c.station, color: c.color }])).values()];
  const canEdit = (s.modules.production ?? 0) >= 3;
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm w-full";

  return (
    <>
      <PageHeader title="Makineler ve kapasite" subtitle="Frez, yazıcı, fırın: durum, kuyruk, takım ömrü ve bakım; istasyonların önümüzdeki 10 günlük yükü" actions={<Link href="/uretim" className="text-sm font-semibold text-brand-700">Üretim panosu</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261223000000_machines.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {machines.filter((m) => m.is_active).map((m) => {
            const q = queue.filter((x) => x.machine_id === m.id);
            const tool = pct(m.tool_used_units, m.tool_life_units);
            const maint = pct(m.units_since_maint, m.maint_every_units);
            const maintDue = m.next_maintenance && m.next_maintenance <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
            return (
              <Link key={m.id} href={`/uretim/makineler/${m.id}`} className="rounded-[18px] border border-line bg-white p-4 flex flex-col gap-2 hover:border-brand-700">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0"><b className="font-display text-lg">{m.name}</b><div className="text-xs text-muted">{MACHINE_KIND[m.kind]}{m.brand_model ? ` · ${m.brand_model}` : ""}</div></div>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${MACHINE_STATUS[m.status]?.[1]}`}>{MACHINE_STATUS[m.status]?.[0]}</span>
                </div>
                <div className="text-sm">Kuyruk: <b>{q.length}</b> iş · {q.reduce((a, x) => a + x.units, 0)} ünit{m.daily_units ? <span className="text-muted"> · günde {m.daily_units}</span> : null}</div>
                {tool !== null && (
                  <div className="text-xs"><div className="flex justify-between"><span>{m.tool_name ?? "Takım"} ömrü</span><b className={tool >= 90 ? "text-bad" : ""}>{m.tool_used_units} / {m.tool_life_units}</b></div><div className="h-1.5 rounded bg-[#EEF2F6] mt-1"><div className={`h-1.5 rounded ${tool >= 90 ? "bg-bad" : tool >= 70 ? "bg-[#D97706]" : "bg-ok"}`} style={{ width: `${tool}%` }} /></div></div>
                )}
                {(maint !== null || m.next_maintenance) && (
                  <div className={`text-xs ${maintDue || (maint ?? 0) >= 100 ? "text-bad font-semibold" : "text-muted"}`}>Bakım: {m.next_maintenance ? formatDate(m.next_maintenance) : ""}{maint !== null ? `${m.next_maintenance ? " · " : ""}${m.units_since_maint} / ${m.maint_every_units} ünit` : ""}</div>
                )}
              </Link>
            );
          })}
          {machines.filter((m) => m.is_active).length === 0 && <p className="rounded-[18px] border border-dashed border-[#C5D0DB] p-6 text-sm text-muted sm:col-span-2 xl:col-span-3">Henüz makine yok. Frez, 3D yazıcı ve fırınlarınızı ekleyin; takım ömrü ve bakım uyarıları otomatik gelir.</p>}
        </div>

        <Card title="Kapasite planı (ünit / gün)">
          {stations.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[820px]">
                <thead><tr className="text-muted"><th className="p-2 text-left">İstasyon</th>{days.map((d) => { const dt = new Date(`${d}T12:00:00Z`); return <th key={d} className="p-2 text-center whitespace-nowrap">{DOW[dt.getUTCDay()]} {d.slice(8, 10)}.{d.slice(5, 7)}</th>; })}</tr></thead>
                <tbody>
                  {stations.map((stn) => (
                    <tr key={stn.id} className="border-t border-[#EEF2F6]">
                      <td className="p-2 font-semibold whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 rounded-full mr-1.5" style={{ background: stn.color ?? "#94A3B8" }} />{stn.name}</td>
                      {days.map((d) => {
                        const c = cap.find((x) => x.station_id === stn.id && x.day === d);
                        const load = c?.load ?? 0;
                        const k = c?.capacity ? load / c.capacity : null;
                        const tone = k === null ? (load ? "bg-[#EEF2F6]" : "") : k > 1 ? "bg-bad-bg text-bad font-bold" : k > 0.8 ? "bg-warn-bg text-warn font-semibold" : load ? "bg-ok-bg text-ok" : "";
                        return <td key={d} className={`p-2 text-center ${tone}`} title={c?.capacity ? `${load} / ${c.capacity} ünit` : `${load} ünit (kapasite tanımsız)`}>{load || (c?.capacity ? "·" : "")}{c?.capacity && load ? <span className="opacity-60">/{c.capacity}</span> : null}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted">İstasyon tanımlı değil.</p>}
          <p className="text-xs text-muted">Yük: açık üretim adımlarının ünitleri, işin teslim gününden bir gün önceye yazılır (gecikenler bugüne). Kapasite: istasyonun günlük kapasitesi ya da bağlı makinelerin günlük ünit toplamı. Kırmızı: kapasite aşılıyor.</p>
        </Card>

        {canEdit && (
          <Card title="Yeni makine">
            <form action={saveMachine} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Ad *<input name="name" required maxLength={80} placeholder="ör. Frez 1 · imes-icore" className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Tür<select name="kind" className={inp}>{Object.entries(MACHINE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">İstasyon<select name="station_id" className={inp}><option value="">—</option>{(st ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Demirbaş kaydı<select name="asset_id" className={inp}><option value="">—</option>{(as ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.code ? ` (${x.code})` : ""}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Marka / model<input name="brand_model" maxLength={120} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Günlük kapasite (ünit)<input name="daily_units" type="number" min={1} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Takım adı<input name="tool_name" maxLength={80} placeholder="ör. 1 mm frez ucu" className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Takım ömrü (ünit)<input name="tool_life_units" type="number" min={1} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Bakım aralığı (ünit)<input name="maint_every_units" type="number" min={1} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Sonraki bakım tarihi<input name="next_maintenance" type="date" className={inp} /></label>
              <div className="flex items-end"><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Makine ekle</PendingSubmit></div>
            </form>
          </Card>
        )}
        {machines.some((m) => !m.is_active) && <p className="text-xs text-muted">Pasif makineler: {machines.filter((m) => !m.is_active).map((m) => <Link key={m.id} href={`/uretim/makineler/${m.id}`} className="text-brand-700 mr-2">{m.name}</Link>)}</p>}
      </div>
    </>
  );
}
