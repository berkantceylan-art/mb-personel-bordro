"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { visError } from "@/lib/visitor";
import { done, fail } from "@/lib/flash";
import { erpUrl } from "@/lib/po-send";
import { waConfigured, waSendTemplate } from "@/lib/whatsapp";
import { waLink, waNumber } from "@/lib/wa";

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

export type DecideState = { ok: boolean; message: string; wa?: string | null };

/** Siteden gelen randevu talebini onayla (saat değişebilir) ya da reddet; ziyaretçiye WhatsApp ile bildir */
export async function visDecide(_: DecideState | null, f: FormData): Promise<DecideState> {
  const ok = s(f, "ok") === "1";
  const at = s(f, "at");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vis_decide", { p_id: s(f, "id"), p_ok: ok, p_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? `${at}:00+03:00` : null, p_reason: s(f, "reason") || null });
  if (error) return { ok: false, message: visError(error.message) };
  back();
  const d = data as { token: string; no: string; phone: string | null; name: string; expected_at: string | null; host: string | null; reason: string | null };
  const link = `${erpUrl()}/z/${d.token}`;
  const when = d.expected_at ? new Date(d.expected_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const text = ok
    ? `Sayın ${d.name}, ${when} ziyaret randevunuz onaylandı${d.host ? ` (görüşülecek kişi: ${d.host})` : ""}. Girişte güvenliğe göstereceğiniz QR davetiyeniz: ${link}`
    : `Sayın ${d.name}, ziyaret randevu talebiniz uygun bulunmadı: ${d.reason ?? ""}. Ayrıntı: ${link}`;
  let sent = false;
  const num = waNumber(d.phone);
  if (num && waConfigured()) {
    try { await waSendTemplate(num, text); sent = true; } catch { sent = false; }
  }
  return { ok: true, message: `${d.no} ${ok ? "onaylandı; güvenlik listesine düştü" : "reddedildi"}.${sent ? " Ziyaretçiye WhatsApp ile bildirildi." : " Ziyaretçi takip sayfasından görür; isterseniz WhatsApp'tan da iletin."}`, wa: sent ? null : waLink(d.phone, text) };
}

/** Sitede randevu verilebilecek kişi / birim (sahip, İK) */
export async function visHostSave(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vis_host_save", { p: {
    id: s(f, "id") || null, delete: s(f, "delete") === "1" ? "true" : "false", label: s(f, "label"), description: s(f, "description"),
    approver_ids: f.getAll("approver").map(String), weekdays: f.getAll("weekday").map(String), hour_from: s(f, "hour_from"), hour_to: s(f, "hour_to"), slot_minutes: s(f, "slot"), is_active: f.get("is_active") === "on",
  } });
  if (error) await fail(visError(error.message));
  back();
  await done(s(f, "delete") === "1" ? "Silindi." : "Randevu ayarı kaydedildi; sitede görünür.");
}
