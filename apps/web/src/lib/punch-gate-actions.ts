"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

/** Kilit ekranından: eksik okutma saatlerini bildir (onaya gider; aylık hak içindeyse otomatik işlenir) */
export async function submitGate(items: { date: string; direction: "IN" | "OUT"; time: string; note: string }[]): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  const sb = await createClient();
  const { data: me } = await sb.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!me) return { ok: false, message: "Hesabınız bir personel kaydına bağlı değil." };
  const rows = items.filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date) && /^\d{2}:\d{2}$/.test(i.time) && (i.direction === "IN" || i.direction === "OUT"));
  if (rows.length !== items.length || !rows.length) return { ok: false, message: "Her satır için saati yazın." };
  for (const r of rows) {
    const { error } = await sb.from("punch_requests").insert({ company_id: s.companyId, employee_id: me.id, on_date: r.date, direction: r.direction, at_time: r.time, note: `Uygulama uyarısı${r.note.trim() ? `: ${r.note.trim().slice(0, 300)}` : ""}` });
    if (error) return { ok: false, message: error.message.includes("policy") ? "Yalnız son 31 gün için bildirim yapılabilir." : error.message };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Bildiriminiz iletildi. Aylık hakkınız içindeyse hemen işlenir, değilse yöneticinizin onayına gider." };
}

/** "Bugün işe gelmedim" — yalnız bugünkü giriş uyarısı için; gün kontrol merkezinde devamsızlık olarak görünür */
export async function skipGateToday(date: string): Promise<void> {
  await getSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const jar = await cookies();
  jar.set("att_gate_skip", `${date}|IN`, { maxAge: 60 * 60 * 20, path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}
