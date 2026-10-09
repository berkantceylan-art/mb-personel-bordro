import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { AdvanceRequestForm } from "@/components/CommsForms";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { cancelAdvance } from "@/lib/comms-actions";
import { formatDate } from "@/lib/session";
import { Chip, me, MyHeader, NotLinked } from "../_shared";

export default async function MyAdvancesPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Avans iste" />;
  const { data: adv } = await supabase.from("advance_requests").select("id, amount, reason, status, created_at, decision_note").eq("employee_id", e.id).order("created_at", { ascending: false }).limit(30);
  return (
    <>
      <MyHeader title="Avans iste" subtitle="Talebiniz onaylanınca bildirim alırsınız" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Yeni avans talebi"><AdvanceRequestForm /></Card>
        <Card title="Taleplerim">
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(adv ?? []).map((a) => (
              <li key={a.id} className="py-2.5 flex flex-wrap gap-2 items-center">
                <span className="text-muted w-20">{formatDate(a.created_at)}</span>
                <span className="num font-semibold w-28">{formatTL(Number(a.amount))}</span>
                <Chip s={a.status} />
                <span className="text-xs text-muted flex-1 truncate">{a.decision_note ?? a.reason ?? ""}</span>
                {a.status === "pending" && (
                  <form action={cancelAdvance}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit label="İptal" question="Talep iptal edilsin mi?" /></form>
                )}
              </li>
            ))}
            {(adv ?? []).length === 0 && <li className="py-4 text-center text-muted">Henüz avans talebi yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
