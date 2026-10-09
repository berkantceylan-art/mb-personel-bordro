"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Personel: unutulan giriş/çıkış okutmasını bildirir */
export async function requestPunch(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!me) await fail("Hesabınız bir personel kaydına bağlı değil.");
  const onDate = str(f, "on_date"); const at = str(f, "at_time"); const dir = str(f, "direction");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate) || !/^\d{2}:\d{2}$/.test(at) || !["IN", "OUT"].includes(dir)) await fail("Gün, saat ve yön seçin.");
  const { error } = await supabase.from("punch_requests").insert({ company_id: s.companyId, employee_id: me!.id, on_date: onDate, direction: dir, at_time: at, note: str(f, "note") || null });
  if (error) await fail(error.message.includes("punch_requests") ? "Sunucu güncellemesi gerekli (20261106000000_punch_requests.sql)." : error.message.includes("policy") ? "Yalnız son 31 gün için bildirim yapılabilir." : error.message);
  revalidatePath("/benim/puantaj");
  await done(`${dir === "IN" ? "Giriş" : "Çıkış"} bildiriminiz iletildi; onaylanınca puantaja işlenir.`);
}

export async function cancelPunchRequest(f: FormData) {
  await getSession();
  const supabase = await createClient();
  await supabase.from("punch_requests").delete().eq("id", str(f, "id")).eq("status", "pending");
  revalidatePath("/benim/puantaj");
}

/** Personel: fazla mesai bildirir (onay bekler) */
export async function requestOvertime(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!me) await fail("Hesabınız bir personel kaydına bağlı değil.");
  const date = str(f, "work_date"); const hours = Number(str(f, "hours").replace(",", "."));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(hours > 0) || hours > 11) await fail("Tarih ve saat girin (en fazla 11 saat).");
  const { error } = await supabase.from("overtime_records").insert({ company_id: s.companyId, employee_id: me!.id, work_date: date, period: date.slice(0, 7), minutes: Math.round(hours * 60), source: "MANUAL", status: "pending", note: str(f, "note") || "Personel bildirimi" });
  if (error) await fail(error.message.includes("unique") ? "Bu gün için zaten fazla mesai kaydı var." : error.message.includes("policy") ? "Yalnız son 31 gün için bildirim yapılabilir (sunucu güncellemesi: 20261106000000_punch_requests.sql)." : error.message);
  revalidatePath("/benim/puantaj");
  await done(`${hours} saat fazla mesai bildiriminiz iletildi; şefiniz onaylayınca hesabınıza işlenir.`);
}

export async function cancelOvertimeRequest(f: FormData) {
  await getSession();
  const supabase = await createClient();
  await supabase.from("overtime_records").delete().eq("id", str(f, "id")).eq("status", "pending");
  revalidatePath("/benim/puantaj");
}
