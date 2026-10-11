import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { Chip } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { formatDate } from "@/lib/session";
import { qty } from "@/lib/stock";
import { OP_STATUS, REMAKE_REASON, minutes } from "@/lib/production";
import { addJobMaterial, opAction, planJob, remakeJob } from "@/lib/production-actions";

const sel = "h-9 rounded-lg border border-[#D5DEE8] px-2 text-sm bg-white";

/** İş sayfasında üretim: istasyon adımları, kullanılan malzeme / lotlar, yeniden yapım */
export async function JobProduction({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const [{ data: ops, error }, { data: mats }, { data: rem }, { data: stations }, { data: items }] = await Promise.all([
    supabase.from("prd_job_ops").select("id, station_id, sort, status, qty, std_minutes, work_minutes, started_at, finished_at, round, consume, employees(first_name, last_name), prd_stations(name, color)").eq("job_id", jobId).order("round").order("sort"),
    supabase.from("prd_job_materials").select("id, qty, lot_no, expiry_date, source, created_at, stk_items(name, unit, code)").eq("job_id", jobId).order("created_at"),
    supabase.from("prd_remakes").select("id, reason, description, created_at, chargeable, prd_stations!prd_remakes_station_id_fkey(name)").eq("job_id", jobId).order("created_at"),
    supabase.from("prd_stations").select("id, name").eq("is_active", true).order("sort"),
    supabase.from("stk_items").select("id, name, unit, track_lot").eq("is_active", true).neq("kind", "service").order("name").limit(3000),
  ]);
  if (error) return null; // üretim modülü kurulmamış
  type O = { id: string; station_id: string; status: string; qty: number; std_minutes: number | null; work_minutes: number | null; started_at: string | null; finished_at: string | null; round: number; consume: boolean; employees: { first_name: string; last_name: string } | null; prd_stations: { name: string; color: string | null } | null };
  const os = (ops ?? []) as unknown as O[];
  const round = Math.max(0, ...os.map((o) => o.round));
  const cur = os.filter((o) => o.round === round);
  const ms = (mats ?? []) as unknown as { id: string; qty: number; lot_no: string | null; expiry_date: string | null; source: string; created_at: string; stk_items: { name: string; unit: string; code: string } | null }[];
  const rs = (rem ?? []) as unknown as { id: string; reason: string; description: string | null; created_at: string; chargeable: boolean; prd_stations: { name: string } | null }[];
  const done = cur.filter((o) => ["done", "skipped"].includes(o.status)).length;

  return (
    <Card title={`Üretim${round > 1 ? ` · ${round - 1}. yeniden yapım` : ""}`} action={cur.length ? <span className="text-sm text-muted">{done} / {cur.length} istasyon</span> : undefined}>
      {cur.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">Bu iş henüz üretime alınmadı. Ürün rotalarına göre istasyon adımları oluşturulur; istasyonda iş numarası okutulunca da otomatik alınır.</span>
          {canEdit && <form action={planJob}><input type="hidden" name="job_id" value={jobId} /><PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Üretime al</PendingSubmit></form>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-full bg-ok" style={{ width: `${(done / cur.length) * 100}%` }} /></div>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {cur.map((o) => (
              <li key={o.id} className={`rounded-[12px] border p-2.5 text-sm ${o.status === "in_progress" ? "border-warn" : o.status === "done" ? "border-ok bg-[#F7FBF8]" : "border-line"}`} style={{ borderLeftWidth: 4, borderLeftColor: o.prd_stations?.color ?? undefined }}>
                <div className="flex justify-between gap-2"><b>{o.prd_stations?.name}</b><Chip tone={OP_STATUS[o.status]?.[1]}>{OP_STATUS[o.status]?.[0]}</Chip></div>
                <span className="block text-xs text-muted mt-0.5">
                  {o.employees ? `${o.employees.first_name} ${o.employees.last_name} · ` : ""}
                  {o.finished_at ? `${formatDate(o.finished_at)} · ${minutes(o.work_minutes)}` : o.started_at ? `başladı ${new Date(o.started_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : `${o.qty} birim${o.std_minutes ? ` · std ${minutes(o.std_minutes)}` : ""}`}
                  {o.consume ? " · malzeme düşer" : ""}
                </span>
                {canEdit && !["done", "skipped"].includes(o.status) && (
                  <form action={opAction} className="flex gap-3 mt-1.5">
                    <input type="hidden" name="id" value={o.id} /><input type="hidden" name="job_id" value={jobId} />
                    {o.status !== "in_progress" && <PendingSubmit name="action" value="start" className="text-xs font-semibold text-brand-700">Başla</PendingSubmit>}
                    <PendingSubmit name="action" value="finish" className="text-xs font-semibold text-ok">Bitti</PendingSubmit>
                    <PendingSubmit name="action" value="skip" className="text-xs font-semibold text-muted">Atla</PendingSubmit>
                  </form>
                )}
              </li>
            ))}
          </ol>
          {round > 1 && <p className="text-xs text-muted">Önceki turlar: {os.filter((o) => o.round < round).length} adım · {rs.map((r) => `${formatDate(r.created_at)} ${REMAKE_REASON[r.reason]}${r.prd_stations ? ` (${r.prd_stations.name})` : ""}${r.chargeable ? " · ücretli" : ""}`).join(" | ")}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <div>
          <h3 className="text-sm font-semibold mb-1.5">Kullanılan malzeme ve lotlar</h3>
          <ul className="text-sm divide-y divide-[#EEF2F6]">
            {ms.map((m) => <li key={m.id} className="py-1.5 flex gap-2"><span className="flex-1">{m.stk_items?.name}</span><span className="num">{qty(m.qty)} {m.stk_items?.unit}</span><span className="num text-xs text-muted w-36 text-right">{m.lot_no ? `Lot ${m.lot_no}` : "lotsuz"}{m.expiry_date ? ` · SKT ${formatDate(m.expiry_date)}` : ""}</span></li>)}
            {ms.length === 0 && <li className="py-2 text-muted">Henüz malzeme düşülmedi (reçeteli ürünlerde malzeme adımı bitince otomatik).</li>}
          </ul>
          {canEdit && (
            <form action={addJobMaterial} className="flex flex-wrap gap-1.5 mt-2">
              <input type="hidden" name="job_id" value={jobId} />
              <select name="item_id" required className={`${sel} flex-1 min-w-40`}><option value="">Malzeme ekle</option>{(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit}){i.track_lot ? " · lot" : ""}</option>)}</select>
              <input name="qty" required placeholder="Miktar" inputMode="decimal" className={`${sel} w-20`} />
              <input name="lot_no" placeholder="Lot (boş = FIFO)" className={`${sel} w-32`} />
              <PendingSubmit className="text-sm font-semibold text-brand-700">Ekle</PendingSubmit>
            </form>
          )}
        </div>
        {canEdit && cur.length > 0 && (
          <details className="rounded-[12px] border border-line p-3">
            <summary className="text-sm font-semibold cursor-pointer text-bad">Yeniden yapım (remake) başlat</summary>
            <form action={remakeJob} className="grid gap-2 sm:grid-cols-2 mt-2 text-sm">
              <input type="hidden" name="job_id" value={jobId} />
              <label className="flex flex-col gap-1">Neden<select name="reason" className={sel}>{Object.entries(REMAKE_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="flex flex-col gap-1">Hatanın kaynağı<select name="station_id" className={sel}><option value="">Belirsiz / hekim</option>{(stations ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="flex flex-col gap-1">Hangi istasyondan başlasın<select name="restart_station_id" className={sel}>{cur.map((o) => <option key={o.station_id} value={o.station_id}>{o.prd_stations?.name}</option>)}</select></label>
              <label className="flex items-center gap-2 mt-5"><input type="checkbox" name="chargeable" /> Hekime ücretlendirilecek</label>
              <textarea name="description" rows={2} maxLength={500} placeholder="Açıklama" className="sm:col-span-2 rounded-lg border border-[#D5DEE8] px-2 py-1" />
              <div className="sm:col-span-2"><PendingSubmit className="h-9 px-3 rounded-[10px] bg-bad text-white text-sm font-semibold">Yeniden yapımı başlat</PendingSubmit></div>
            </form>
          </details>
        )}
      </div>
    </Card>
  );
}
