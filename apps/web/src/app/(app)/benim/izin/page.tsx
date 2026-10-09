import { Card, Stat } from "@/components/ui";
import { LeaveRequestForm } from "@/components/CommsForms";
import { currentPeriod, formatDate } from "@/lib/session";
import { Chip, me, MyHeader, NotLinked } from "../_shared";

export default async function MyLeavePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İzin iste" />;
  const year = currentPeriod().slice(0, 4);
  const [{ data: leaves }, { data: types }] = await Promise.all([
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, note, leave_types(name, code)").eq("employee_id", e.id).gte("start_date", `${year}-01-01`).order("start_date", { ascending: false }),
    supabase.from("leave_types").select("id, name").order("sort_order"),
  ]);
  const code = (l: { leave_types: unknown }) => (l.leave_types as { code: string } | null)?.code;
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
        <Card title="İzinlerim">
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(leaves ?? []).map((l) => (
              <li key={l.id} className="py-2.5 flex flex-wrap gap-2 items-center">
                <span className="w-44">{formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}</span>
                <span className="flex-1">{(l.leave_types as unknown as { name: string } | null)?.name} · {l.days} gün</span>
                <Chip s={l.status} />
                {l.note && <span className="w-full text-xs text-muted">{l.note}</span>}
              </li>
            ))}
            {(leaves ?? []).length === 0 && <li className="py-4 text-center text-muted">Bu yıl izin kaydı yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
