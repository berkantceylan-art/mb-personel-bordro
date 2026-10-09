import { Card, Stat } from "@/components/ui";
import { PeriodPicker } from "@/components/PeriodPicker";
import { currentPeriod, formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked, td, th } from "../_shared";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { cancelOvertimeRequest, cancelPunchRequest, requestOvertime, requestPunch } from "./actions";

export default async function MyTimesheetPage({ searchParams }: { searchParams: Promise<{ donem?: string; eksik?: string }> }) {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Puantajım" />;
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const [y, m] = period.split("-").map(Number);
  const end = new Date(y, m, 1).toISOString().slice(0, 10);
  const [{ data: punches }, { data: reqs }] = await Promise.all([
    supabase.from("attendance_punches").select("direction, punched_at, source").eq("employee_id", e.id).gte("punched_at", `${period}-01T00:00:00`).lt("punched_at", `${end}T00:00:00`).order("punched_at"),
    supabase.from("punch_requests").select("id, on_date, direction, at_time, status, decision_note").eq("employee_id", e.id).gte("on_date", `${period}-01`).lte("on_date", end).order("on_date", { ascending: false }),
  ]);
  const { data: ots } = await supabase.from("overtime_records").select("id, work_date, minutes, status, source, note, amount").eq("employee_id", e.id).eq("period", period).order("work_date", { ascending: false });
  const otApproved = (ots ?? []).filter((o) => o.status === "approved").reduce((a, o) => a + o.minutes, 0) / 60;
  const pendingReq = new Set((reqs ?? []).filter((r) => r.status === "pending").map((r) => `${r.on_date}|${r.direction}`));
  const days = new Map<string, { in?: string; out?: string; src?: string }>();
  for (const p of punches ?? []) {
    const d = p.punched_at.slice(0, 10); const t = p.punched_at.slice(11, 16);
    const cur = days.get(d) ?? {};
    if (p.direction === "IN" && !cur.in) { cur.in = t; cur.src = p.source; }
    if (p.direction === "OUT") cur.out = t;
    days.set(d, cur);
  }
  const hours = [...days.values()].reduce((a, v) => {
    if (!v.in || !v.out) return a;
    const [h1, m1] = v.in.split(":").map(Number); const [h2, m2] = v.out.split(":").map(Number);
    return a + Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60);
  }, 0);
  const cur = currentPeriod();
  const options = [cur, ...[1, 2, 3, 4, 5].map((k) => { const d = new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })];
  return (
    <>
      <MyHeader title="Puantajım" subtitle={periodLabel(period)} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <PeriodPicker value={period} options={options} />
        <details open={!!sp.eksik} className="bg-white border border-line rounded-[14px] p-4">
          <summary className="font-semibold text-brand-800 cursor-pointer">Okutmayı unuttum · bildir</summary>
          <form action={requestPunch} className="grid gap-3 grid-cols-2 mt-3">
            <label className="flex flex-col gap-1 text-sm text-muted">Gün<input type="date" name="on_date" required defaultValue={sp.eksik && /^\d{4}-\d{2}-\d{2}$/.test(sp.eksik) ? sp.eksik : cur === period ? new Date().toISOString().slice(0, 10) : `${period}-01`} max={new Date().toISOString().slice(0, 10)} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Saat<input type="time" name="at_time" required className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Yön
              <select name="direction" defaultValue="OUT" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white"><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">Açıklama<input name="note" placeholder="ör. telefon kapalıydı" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <div className="col-span-2"><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Bildir</PendingSubmit></div>
          </form>
          {(reqs ?? []).length > 0 && (
            <ul className="mt-3 divide-y divide-[#EEF2F6] text-sm">
              {(reqs ?? []).map((r) => (
                <li key={r.id} className="py-1.5 flex justify-between gap-2 items-center">
                  <span className="num">{formatDate(r.on_date)} {String(r.at_time).slice(0, 5)} · {r.direction === "IN" ? "Giriş" : "Çıkış"}{r.decision_note ? <span className="block text-xs text-muted">{r.decision_note}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${r.status === "approved" ? "bg-ok-bg text-ok" : r.status === "rejected" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{r.status === "approved" ? "İşlendi" : r.status === "rejected" ? "Reddedildi" : "Bekliyor"}</span>
                    {r.status === "pending" && <form action={cancelPunchRequest}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Geri al" question="Bildirim silinsin mi?" /></form>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <div className="grid gap-3 grid-cols-3">
          <Stat label="Okutmalı gün" value={String(days.size)} />
          <Stat label="Toplam saat" value={hours.toFixed(1)} sub="mola dahil" />
          <Stat label="Onaylı fazla mesai" value={`${otApproved.toFixed(1)} sa`} />
        </div>
        <details className="bg-white border border-line rounded-[14px] p-4">
          <summary className="font-semibold text-brand-800 cursor-pointer">Fazla mesai bildir</summary>
          <form action={requestOvertime} className="grid gap-3 grid-cols-2 mt-3">
            <label className="flex flex-col gap-1 text-sm text-muted">Gün<input type="date" name="work_date" required defaultValue={new Date().toISOString().slice(0, 10)} max={new Date().toISOString().slice(0, 10)} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Saat<input name="hours" inputMode="decimal" required placeholder="ör. 2 veya 1,5" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white num" /></label>
            <label className="flex flex-col gap-1 text-sm text-muted col-span-2">Açıklama<input name="note" placeholder="ör. sipariş yetiştirme" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <div className="col-span-2"><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Bildir</PendingSubmit></div>
          </form>
          {(ots ?? []).length > 0 && (
            <ul className="mt-3 divide-y divide-[#EEF2F6] text-sm">
              {(ots ?? []).map((o) => (
                <li key={o.id} className="py-1.5 flex justify-between gap-2 items-center">
                  <span className="num">{formatDate(o.work_date)} · {(o.minutes / 60).toFixed(1)} saat{o.source === "AUTO" ? <span className="text-xs text-muted"> · PDKS</span> : null}{o.note && o.note !== "Personel bildirimi" ? <span className="block text-xs text-muted">{o.note}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${o.status === "approved" ? "bg-ok-bg text-ok" : o.status === "rejected" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{o.status === "approved" ? "Onaylandı" : o.status === "rejected" ? "Reddedildi" : "Bekliyor"}</span>
                    {o.status === "pending" && o.source === "MANUAL" && <form action={cancelOvertimeRequest}><input type="hidden" name="id" value={o.id} /><ConfirmSubmit label="Geri al" question="Bildirim silinsin mi?" /></form>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted mt-2">Onaylanan fazla mesai ücreti ay sonunda hesabınıza işlenir (saat ücretinin %50 fazlası).</p>
        </details>
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className={th}>Gün</th><th className={th}>Giriş</th><th className={th}>Çıkış</th></tr></thead>
            <tbody>
              {[...days.entries()].reverse().map(([d, v]) => (
                <tr key={d}><td className={td}>{formatDate(d)}</td><td className={`${td} num`}>{v.in ?? (pendingReq.has(`${d}|IN`) ? <span className="text-xs text-muted">bildirildi</span> : <a href={`/benim/puantaj?donem=${period}&eksik=${d}`} className="text-xs font-semibold text-warn">giriş yok · bildir</a>)}</td><td className={`${td} num`}>{v.out ?? (pendingReq.has(`${d}|OUT`) ? <span className="text-xs text-muted">bildirildi</span> : <a href={`/benim/puantaj?donem=${period}&eksik=${d}`} className="text-xs font-semibold text-warn">çıkış yok · bildir</a>)}</td></tr>
              ))}
              {days.size === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">Bu ay okutma yok.</td></tr>}
            </tbody>
          </table>
          <p className="text-xs text-muted">Eksik okutmayı yukarıdan bildirin; şefiniz onaylayınca işlenir.</p>
        </Card>
      </div>
    </>
  );
}
