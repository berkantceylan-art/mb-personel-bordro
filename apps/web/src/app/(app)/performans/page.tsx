import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createCycle } from "./actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";

/** Performans değerlendirme dönemleri */
export default async function PerformancePage() {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const supabase = await createClient();
  const [{ data: cycles, error }, { data: reviews }] = await Promise.all([
    supabase.from("review_cycles").select("id, name, period_start, period_end, due_on, status").order("period_end", { ascending: false }),
    supabase.from("reviews").select("cycle_id, self_submitted_at, mgr_submitted_at, shared_at, overall"),
  ]);
  if (error) return (<><PageHeader title="Performans" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261112000000_performance.sql</b> çalıştırılmalı.</p></Card></div></>);
  const y = new Date().getFullYear();
  const half = new Date().getMonth() < 6 ? 1 : 2;
  const hr = s.role !== "branch_manager";
  return (
    <>
      <PageHeader title="Performans değerlendirme" subtitle="Dönemler · öz değerlendirme · şef değerlendirmesi · zam önerisi" actions={<Link href="/yetkinlik" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Yetkinlik ve hedefler</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        {(cycles ?? []).length === 0 && <Card><p className="text-sm text-muted">Henüz değerlendirme dönemi yok.{hr ? " Aşağıdan ilkini başlatın." : ""}</p></Card>}
        <div className="grid gap-3 md:grid-cols-2">
          {(cycles ?? []).map((c) => {
            const rs = (reviews ?? []).filter((r) => r.cycle_id === c.id);
            const self = rs.filter((r) => r.self_submitted_at).length;
            const mgr = rs.filter((r) => r.mgr_submitted_at).length;
            const shared = rs.filter((r) => r.shared_at).length;
            const ov = rs.filter((r) => r.overall !== null);
            const avg = ov.length ? ov.reduce((a, r) => a + Number(r.overall), 0) / ov.length : null;
            const pct = rs.length ? Math.round((mgr / rs.length) * 100) : 0;
            return (
              <Link key={c.id} href={`/performans/${c.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 hover:border-brand-600">
                <div className="flex justify-between gap-2"><b className="text-brand-800">{c.name}</b><span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${c.status === "open" ? "bg-[#E6F4EC] text-ok" : "bg-[#EEF2F6] text-muted"}`}>{c.status === "open" ? "Açık" : "Kapandı"}</span></div>
                <div className="text-xs text-muted">{formatDate(c.period_start)} – {formatDate(c.period_end)}{c.due_on ? ` · son gün ${formatDate(c.due_on)}` : ""}{c.due_on && c.status === "open" && c.due_on < todayIso() ? " · süresi geçti" : ""}</div>
                <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden" role="img" aria-label={`Yüzde ${pct} değerlendirildi`}><div className="h-full bg-brand-700 rounded-full" style={{ width: `${pct}%` }} /></div>
                <div className="text-xs text-[#33475B] flex flex-wrap gap-x-3"><span>{rs.length} kişi</span><span>öz değ. {self}</span><span>şef değ. {mgr}</span><span>paylaşılan {shared}</span>{avg !== null && <span>ortalama <b>{avg.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</b></span>}</div>
              </Link>
            );
          })}
        </div>
        {hr && (
          <Card title="Yeni değerlendirme dönemi">
            <form action={createCycle} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end text-sm">
              <label className="flex flex-col gap-1 text-muted lg:col-span-2">Ad<input name="name" required defaultValue={`${y} ${half}. dönem değerlendirmesi`} className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Başlangıç<input type="date" name="period_start" required defaultValue={half === 1 ? `${y}-01-01` : `${y}-07-01`} className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Bitiş<input type="date" name="period_end" required defaultValue={half === 1 ? `${y}-06-30` : `${y}-12-31`} className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Son gün<input type="date" name="due_on" className={input} /></label>
              <label className="flex items-center gap-2 text-muted lg:col-span-3"><input type="checkbox" name="self_eval" defaultChecked className="w-5 h-5" />Personel öz değerlendirme yapsın (mobilden bildirim gider)</label>
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold lg:col-span-2">Dönemi başlat</PendingSubmit>
              <p className="text-xs text-muted sm:col-span-2 lg:col-span-5">Dönem sonunda en az 1 aydır çalışan tüm aktif personel için değerlendirme açılır. Şefler yalnız kendi bölümlerini görür ve değerlendirir. Ölçütler: iş kalitesi, hız, mesleki beceri, öğrenme, ekip çalışması, kurallara uyum; devam ve dakiklik puantajdan otomatik gösterilir.</p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
