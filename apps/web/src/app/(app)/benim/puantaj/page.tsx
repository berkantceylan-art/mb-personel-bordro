import { Card, Stat } from "@/components/ui";
import { PeriodPicker } from "@/components/PeriodPicker";
import { currentPeriod, formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked, td, th } from "../_shared";

export default async function MyTimesheetPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Puantajım" />;
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const [y, m] = period.split("-").map(Number);
  const end = new Date(y, m, 1).toISOString().slice(0, 10);
  const { data: punches } = await supabase.from("attendance_punches").select("direction, punched_at, source").eq("employee_id", e.id).gte("punched_at", `${period}-01T00:00:00`).lt("punched_at", `${end}T00:00:00`).order("punched_at");
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
        <div className="grid gap-3 grid-cols-2">
          <Stat label="Okutmalı gün" value={String(days.size)} />
          <Stat label="Toplam saat (mola dahil)" value={hours.toFixed(1)} />
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className={th}>Gün</th><th className={th}>Giriş</th><th className={th}>Çıkış</th></tr></thead>
            <tbody>
              {[...days.entries()].reverse().map(([d, v]) => (
                <tr key={d}><td className={td}>{formatDate(d)}</td><td className={`${td} num`}>{v.in ?? "—"}</td><td className={`${td} num`}>{v.out ?? <span className="text-warn">çıkış yok</span>}</td></tr>
              ))}
              {days.size === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">Bu ay okutma yok.</td></tr>}
            </tbody>
          </table>
          <p className="text-xs text-muted">Eksik veya hatalı okutma için şube sorumlunuza yazın (Mesajlar).</p>
        </Card>
      </div>
    </>
  );
}
