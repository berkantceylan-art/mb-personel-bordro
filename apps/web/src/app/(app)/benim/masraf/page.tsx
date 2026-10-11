import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { deleteClaim } from "@/lib/expense-actions";
import { ClaimForm } from "../../masraf/_parts/ClaimForm";
import { MyHeader } from "../_shared";

export const dynamic = "force-dynamic";

const ST: Record<string, [string, string]> = { submitted: ["Onay bekliyor", "bg-warn-bg text-warn"], posted: ["Onaylandı", "bg-ok-bg text-ok"], rejected: ["Reddedildi", "bg-bad-bg text-bad"] };

/** Personel masraf beyanı: fiş fotoğrafı + tutar → yöneticinin onayına */
export default async function MyExpenses() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: cats }, { data: mine }] = await Promise.all([
    supabase.rpc("exp_categories_public"),
    supabase.from("exp_claims").select("id, no, expense_date, amount, vendor, description, status, reject_reason").eq("submitted_by", s.userId).order("created_at", { ascending: false }).limit(40),
  ]);
  return (
    <>
      <MyHeader title="Masraf beyanı" subtitle="Şirket için yaptığınız harcamanın fişini çekin, tutarı yazın; onaylanınca avansınızdan düşülür ya da size ödenir." />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Yeni beyan"><ClaimForm userId={s.userId} today={todayIso()} categories={(cats ?? []) as { id: string; name: string }[]} /></Card>
        <Card title="Beyanlarım">
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(mine ?? []).map((c) => (
              <li key={c.id} className="py-2.5 flex flex-wrap gap-2 items-center">
                <span className="text-muted w-20">{formatDate(c.expense_date)}</span>
                <span className="num font-semibold w-28">{formatTL(Number(c.amount))}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ST[c.status]?.[1] ?? ""}`}>{ST[c.status]?.[0] ?? c.status}</span>
                <span className="text-xs text-muted flex-1 truncate">{c.reject_reason ?? [c.vendor, c.description].filter(Boolean).join(" · ")}</span>
                {c.status !== "posted" && <form action={deleteClaim}><input type="hidden" name="id" value={c.id} /><ConfirmSubmit label="Sil" question="Beyan silinsin mi?" /></form>}
              </li>
            ))}
            {(mine ?? []).length === 0 && <li className="py-4 text-center text-muted">Henüz beyan yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
