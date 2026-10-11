"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { visError } from "@/lib/visitor";

export type VisState = { ok?: boolean; message: string; token?: string; no?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = () => { revalidatePath("/ziyaretci"); revalidatePath("/guvenlik"); };

/** Davet (personel) ya da hızlı kayıt + içeri al (güvenlik: checkin=on) */
export async function visSave(_: VisState | null, f: FormData): Promise<VisState> {
  const at = s(f, "expected_at");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vis_save", { p: {
    visitor_name: s(f, "visitor_name"), visitor_company: s(f, "visitor_company"), phone: s(f, "phone"), id_last4: s(f, "id_last4"), plate: s(f, "plate"), purpose: s(f, "purpose"),
    host_user: s(f, "host_user") || null, expected_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? `${at}:00+03:00` : null, note: s(f, "note"),
    kvkk_ok: f.get("kvkk_ok") === "on", badge_no: s(f, "badge_no"), photo: s(f, "photo") || null, checkin: f.get("checkin") === "on",
  } });
  if (error) return { ok: false, message: visError(error.message) };
  back();
  const d = data as { token: string; no: string };
  return { ok: true, message: f.get("checkin") === "on" ? `${d.no} içeri alındı; ev sahibine bildirildi.` : `${d.no} davet oluşturuldu.`, token: d.token, no: d.no };
}

export type ScanRes = { ok: boolean; message?: string; action?: "in" | "out"; name?: string; company?: string | null; host?: string | null; badge?: string | null; minutes?: number | null; no?: string };
export async function visScan(code: string, badge?: string, photo?: string, kvkk?: boolean): Promise<ScanRes> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vis_scan", { p_code: code.slice(0, 300), p_badge: badge || null, p_photo: photo || null, p_kvkk: kvkk ?? null });
  if (error) return { ok: false, message: visError(error.message) };
  back();
  return { ok: true, ...(data as Omit<ScanRes, "ok">) };
}

export async function visAction(id: string, action: "cancel" | "checkout" | "checkin" | "badge", badge?: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vis_action", { p_id: id, p_action: action, p_badge: badge ?? null });
  if (error) return { ok: false, message: visError(error.message) };
  back();
  return { ok: true, message: "" };
}

export async function saveGuard(f: FormData) {
  const supabase = await createClient();
  const u = s(f, "user_id");
  if (s(f, "remove") === "1") await supabase.from("vis_guards").delete().eq("user_id", u);
  else if (/^[0-9a-f-]{36}$/.test(u)) await supabase.from("vis_guards").upsert({ user_id: u, is_active: true }, { onConflict: "company_id,user_id" });
  back();
}
