import { Card, Stat } from "@/components/ui";
import { LeaveRequestForm, SickReportForm } from "@/components/CommsForms";
import { currentPeriod, formatDate } from "@/lib/session";
import { Chip, me, MyHeader, NotLinked } from "../_shared";

export default async function MyLeavePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İzin iste" />;
  const year = currentPeriod().slice(0, 4);
  const [{ data: leaves }, { data: types }] = await Promise.all([
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, note, start_time, end_time, hours, document_path, leave_types(name, code)").eq("employee_id", e.id).gte("start_date", `${year}-01-01`).order("start_date", { ascending: false }),
    supabase.from("leave_types").select("id, name, code").order("sort_order"),
  ]);
  const code = (l: { leave_types: unknown }) => (l.leave_types as { code: string } | null)?.code;
  const rapor = (types ?? []).find((t) => t.code === "RAPOR");
  const sum = (c: string) => (leaves ?? []).filter((l) => l.status === "approved" && code(l) === c).reduce((a, l) => a + Number(l.days), 0);
  return (
    <>
      <MyHeader title="İzin iste" subtitle={`${year} yılı`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <div className="grid gap-3 grid-cols-3">
          <Stat label="Yıllık izin" value={`${sum("YILLIK")} gün`} sub="kullanılan" />
          <Stat label="Rapor" value={`${sum("RAPOR")} gün`} />
          <Stat label="Ücretsiz" value={`${sum("UCRETSIZ")} gün`} />
        </div>
        <Card title="Yeni izin talebi"><LeaveRequestForm types={types ?? []} /></Card>
        {rapor && <Card title="Rapor bildir" action={<span className="text-xs text-muted">hastalık / istirahat raporu</span>}><SickReportForm typeId={rapor.id} /></Card>}
        <Card title="İzinlerim">
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(leaves ?? []).map((l) => (
              <li key={l.id} className="py-2.5 flex flex-col gap-1">
                <div className="flex justify-between gap-2 items-center">
                  <span className="font-semibold">{(l.leave_types as unknown as { name: string } | null)?.name}</span>
                  <Chip s={l.status} />
                </div>
                <div className="text-muted num">{formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`} · {l.hours ? `${String(l.start_time).slice(0, 5)}–${String(l.end_time).slice(0, 5)} (${Number(l.hours)} saat)` : `${l.days} gün`}{l.document_path ? " · belge eklendi" : ""}</div>
                {l.note && <span className="text-xs text-muted">{l.note}</span>}
              </li>
            ))}
            {(leaves ?? []).length === 0 && <li className="py-4 text-center text-muted">Bu yıl izin kaydı yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
