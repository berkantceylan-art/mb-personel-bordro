import { Card, Stat } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { LeaveRequestForm, SickReportForm } from "@/components/CommsForms";
import { STAGE_LABEL, fmtDays, loadLeaveData, returnDate } from "@/lib/annual-leave";
import { formatDate, todayIso } from "@/lib/session";
import { Chip, me, MyHeader, NotLinked } from "../_shared";
import { sendPreference } from "./actions";

const PLAN: Record<string, [string, string]> = { tercih: ["İK değerlendiriyor", "bg-warn-bg text-warn"], onayli: ["Plana alındı", "bg-ok-bg text-ok"], reddedildi: ["Uygun görülmedi", "bg-bad-bg text-bad"], "talebe-donustu": ["İzne dönüştü", "bg-ok-bg text-ok"] };

/** Personel: yıllık izin bakiyesi, talep, tercih, izinlerim ve belgeler */
export default async function MyLeavePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İzin" />;
  const today = todayIso();
  const year = today.slice(0, 4);
  const [data, { data: leaves }, { data: types }, { data: plans }] = await Promise.all([
    loadLeaveData(supabase, today).catch(() => null),
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, stage, note, start_time, end_time, hours, document_path, travel_days, parent_id, recalled_at, leave_types(name, code)").eq("employee_id", e.id).gte("start_date", `${Number(year) - 1}-01-01`).order("start_date", { ascending: false }),
    supabase.from("leave_types").select("id, name, code").order("sort_order"),
    supabase.from("leave_plans").select("id, start_date, end_date, days, status, note").eq("employee_id", e.id).gte("end_date", today).order("start_date"),
  ]);
  const l = data?.ledgers.get(e.id);
  const hol = data?.hol ?? new Map<string, boolean>();
  const code = (x: { leave_types: unknown }) => (x.leave_types as { code: string } | null)?.code;
  const rapor = (types ?? []).find((t) => t.code === "RAPOR");
  const sum = (c: string) => (leaves ?? []).filter((x) => x.status === "approved" && code(x) === c && x.start_date.startsWith(year)).reduce((a, x) => a + Number(x.days), 0);
  const upcoming = (leaves ?? []).filter((x) => !x.parent_id && (x.status === "pending" || (x.status === "approved" && x.end_date >= today)));
  const holList = [...hol].filter(([d]) => d >= today) as Array<[string, boolean]>;
  return (
    <>
      <MyHeader title="İzin" subtitle="Yıllık izin bakiyem, taleplerim ve belgelerim" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {l && (
          <section className="rounded-[18px] bg-brand-900 text-white p-5 flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div><div className="text-xs uppercase tracking-wide text-white/70">Kalan yıllık izin</div><div className="num font-display text-[44px] leading-none font-bold">{fmtDays(l.balance)}<span className="text-lg font-semibold text-white/80"> gün</span></div></div>
              <div className="text-right text-sm"><div className="text-white/70 text-xs">Sonraki hak ediş</div><b>{formatDate(l.next.date)}</b><div className="text-[#7FD6F0] font-semibold">+{l.next.days} gün</div></div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white/10 py-2"><div className="num text-base font-bold">{fmtDays(l.earned + l.adjust)}</div>hak edilen</div>
              <div className="rounded-lg bg-white/10 py-2"><div className="num text-base font-bold">{fmtDays(l.used)}</div>kullanılan</div>
              <div className="rounded-lg bg-white/10 py-2"><div className="num text-base font-bold">{l.completedYears}</div>hizmet yılı</div>
            </div>
            {l.years.length > 0 && (
              <details className="text-sm"><summary className="cursor-pointer text-white/80">Yıllara göre</summary>
                <ul className="mt-2 divide-y divide-white/10">{l.adjust !== 0 && <li className="py-1.5 flex justify-between"><span>Devir / açılış</span><span className="num">{fmtDays(l.opening.days)} · kalan {fmtDays(l.opening.left)}</span></li>}{l.years.map((y) => <li key={y.k} className="py-1.5 flex justify-between"><span>{y.k}. yıl · {formatDate(y.date)}</span><span className="num">{y.days} gün · kalan {fmtDays(y.left)}</span></li>)}</ul>
              </details>
            )}
            <a href={`/yazdir/yillik-izin?tur=kayit&personel=${e.id}`} target="_blank" rel="noopener" className="text-sm font-semibold text-[#7FD6F0]">İzin kayıt belgem →</a>
          </section>
        )}
        {upcoming.length > 0 && (
          <Card title="Bekleyen ve yaklaşan izinlerim">
            <ul className="divide-y divide-[#EEF2F6] text-sm">{upcoming.map((x) => (
              <li key={x.id} className="py-2.5 flex flex-col gap-1">
                <div className="flex justify-between gap-2 items-center"><b>{(x.leave_types as unknown as { name: string } | null)?.name}</b>{x.status === "pending" ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warn-bg text-warn">{STAGE_LABEL[x.stage ?? "hr"]}</span> : <Chip s={x.status} />}</div>
                <div className="num text-muted">{formatDate(x.start_date)}{x.end_date !== x.start_date && ` – ${formatDate(x.end_date)}`} · {fmtDays(Number(x.days))} gün · işbaşı {formatDate(returnDate(x.end_date, hol, x.travel_days ?? 0))}{x.travel_days ? ` · +${x.travel_days} gün yol izni` : ""}</div>
                <a href={`/yazdir/yillik-izin?tur=form&id=${x.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">İzin formunu göster / yazdır</a>
              </li>
            ))}</ul>
          </Card>
        )}
        <Card title="Yeni izin talebi"><LeaveRequestForm types={types ?? []} holidays={holList} balance={l?.balance} /></Card>
        {rapor && <Card title="Rapor bildir" action={<span className="text-xs text-muted">hastalık / istirahat raporu</span>}><SickReportForm typeId={rapor.id} /></Card>}
        <Card title="Yıllık izin tercihim">
          <p className="text-xs text-muted">Yıllık izin planlaması için tercih ettiğiniz tarihleri bildirin. Tercih bir talep değildir; İK bölüm doluluğuna göre plana alır.</p>
          <form action={sendPreference} className="grid gap-2 grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-muted">Başlangıç<input type="date" name="start" required min={today} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Bitiş<input type="date" name="end" min={today} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
            <input name="note" placeholder="Not (ör. çocukların okul tatili)" className="col-span-2 h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" aria-label="Not" />
            <PendingSubmit className="col-span-2 h-12 rounded-[10px] border border-brand-700 text-brand-700 font-semibold bg-white">Tercihimi gönder</PendingSubmit>
          </form>
          {(plans ?? []).length > 0 && <ul className="text-sm divide-y divide-[#EEF2F6]">{(plans ?? []).map((p) => { const st = PLAN[(p as { status?: string }).status ?? "onayli"] ?? PLAN.onayli!; return <li key={p.id} className="py-2 flex justify-between gap-2 items-center"><span className="num">{formatDate(p.start_date)} – {formatDate(p.end_date)} · {fmtDays(Number(p.days))} gün</span><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${st[1]}`}>{st[0]}</span></li>; })}</ul>}
        </Card>
        <div className="grid gap-3 grid-cols-3">
          <Stat label={`${year} yıllık`} value={`${fmtDays(sum("YILLIK"))} gün`} sub="kullanılan" />
          <Stat label="Rapor" value={`${fmtDays(sum("RAPOR"))} gün`} />
          <Stat label="Ücretsiz" value={`${fmtDays(sum("UCRETSIZ"))} gün`} />
        </div>
        <Card title="İzin geçmişim">
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(leaves ?? []).filter((x) => !upcoming.includes(x)).map((x) => (
              <li key={x.id} className="py-2.5 flex flex-col gap-1">
                <div className="flex justify-between gap-2 items-center"><span className="font-semibold">{(x.leave_types as unknown as { name: string } | null)?.name}</span><Chip s={x.status} /></div>
                <div className="text-muted num">{formatDate(x.start_date)}{x.end_date !== x.start_date && ` – ${formatDate(x.end_date)}`} · {x.hours ? `${String(x.start_time).slice(0, 5)}–${String(x.end_time).slice(0, 5)} (${Number(x.hours)} saat)` : `${fmtDays(Number(x.days))} gün`}{x.document_path ? " · belge eklendi" : ""}{x.recalled_at ? " · izinden geri çağrıldı" : ""}</div>
                {x.note && <span className="text-xs text-muted">{x.note}</span>}
              </li>
            ))}
            {(leaves ?? []).length === 0 && <li className="py-4 text-center text-muted">İzin kaydı yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
