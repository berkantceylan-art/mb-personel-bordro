"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { payError } from "@/lib/pay-center";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/odeme-merkezi");
  revalidatePath("/patron");
  revalidatePath("/satinalma/odeme-takvimi");
}

/** Elle ödeme kalemi (kira, elektrik, vergi, tedarikçisiz ödeme…) */
export async function savePayCenterPlan(f: FormData) {
  const amount = parseMoney(str(f, "amount"));
  const { error } = await (await createClient()).rpc("pay_center_plan_save", {
    p: { title: str(f, "title"), category: str(f, "category") || "other", party_id: str(f, "party_id") || null, due_date: str(f, "due_date"), amount, currency: str(f, "currency") || "TRY", note: str(f, "note"), urgent: f.get("urgent") === "on", remind_days: Number(str(f, "remind_days") || 2) },
  });
  if (error) await fail(payError(error.message));
  refresh();
  await done(f.get("urgent") === "on" ? "Acil ödeme eklendi." : "Ödeme listeye eklendi; vadeden önce hatırlatılır.");
}

export async function setPlanState(f: FormData) {
  const sb = await createClient();
  const st = str(f, "status");
  const { error } = st === "urgent" || st === "normal"
    ? await sb.rpc("pay_plan_urgent", { p_id: str(f, "id"), p_on: st === "urgent" })
    : await sb.rpc("pay_plan_status", { p_id: str(f, "id"), p_status: st });
  if (error) await fail(payError(error.message));
  refresh();
  await done(st === "paid" ? "Ödendi olarak işaretlendi. Finans kaydını da girmeyi unutmayın." : st === "cancelled" ? "Ödeme listeden kaldırıldı." : st === "urgent" ? "Acil olarak işaretlendi." : "Acil işareti kaldırıldı.");
}
