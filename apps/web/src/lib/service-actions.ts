"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseTl, svcError } from "@/lib/service";

export type SvcState = { ok?: boolean; message: string; id?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const photos = (f: FormData) => {
  try {
    const a = JSON.parse(s(f, "photos") || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.startsWith("data:image/jpeg;base64,") && x.length <= 900000).slice(0, 6) : [];
  } catch { return []; }
};
const back = (id?: string) => {
  revalidatePath("/servis");
  revalidatePath("/teknik-servis");
  revalidatePath("/");
  if (id) revalidatePath(`/servis/${id}`);
};

/** Arıza bildir (herkes) */
export async function createTicket(_: SvcState | null, f: FormData): Promise<SvcState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("svc_create", { p: {
    asset_id: s(f, "asset_id") || null, title: s(f, "title"), description: s(f, "description"), location: s(f, "location"), priority: s(f, "priority") || "normal", photos: photos(f),
  } });
  if (error) return { ok: false, message: svcError(error.message) };
  back();
  return { ok: true, message: "Bildiriminiz satın alma sorumlusuna iletildi.", id: data as string };
}

export async function cancelTicket(f: FormData) {
  const supabase = await createClient();
  await supabase.rpc("svc_cancel", { p_id: s(f, "id") });
  back(s(f, "id"));
}

/** Satın alma: teknisyene ata / dış servise ver / reddet */
export async function approveTicket(_: SvcState | null, f: FormData): Promise<SvcState> {
  const id = s(f, "id");
  const mode = s(f, "mode");
  const supabase = await createClient();
  const { error } = await supabase.rpc("svc_approve", { p_id: id, p_mode: mode, p_tech: s(f, "tech") || null, p_vendor: s(f, "vendor") || null, p_due: s(f, "due") || null, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: svcError(error.message) };
  back(id);
  return { ok: true, message: mode === "reject" ? "Reddedildi; bildirene haber verildi." : mode === "tech" ? "Teknisyene atandı." : "Dış servise verildi." };
}

export async function startTicket(f: FormData) {
  const supabase = await createClient();
  await supabase.rpc("svc_start", { p_id: s(f, "id"), p_note: s(f, "note") || null });
  back(s(f, "id"));
}

/** Teknisyen / dış servis: yapıldı + ücret + sonra fotoğrafı */
export async function doneTicket(_: SvcState | null, f: FormData): Promise<SvcState> {
  const id = s(f, "id");
  const cost = s(f, "cost") ? parseTl(s(f, "cost")) : 0;
  if (Number.isNaN(cost)) return { ok: false, message: "Ücreti sayı olarak yazın (ör. 450 ya da 450,50)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("svc_done", { p_id: id, p_note: s(f, "note"), p_cost: cost, p_photos: photos(f), p_cost_note: s(f, "cost_note") || null });
  if (error) return { ok: false, message: svcError(error.message) };
  back(id);
  return { ok: true, message: cost > 0 ? "Tamamlandı; ücret satın alma onayına gitti." : "Tamamlandı ve kapandı." };
}

/** Satın alma: ücreti onayla / geri gönder */
export async function costTicket(_: SvcState | null, f: FormData): Promise<SvcState> {
  const id = s(f, "id");
  const action = s(f, "action");
  const cost = s(f, "cost") ? parseTl(s(f, "cost")) : null;
  if (cost != null && Number.isNaN(cost)) return { ok: false, message: "Tutarı sayı olarak yazın." };
  const vat = s(f, "vat") ? Number(s(f, "vat")) : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("svc_cost", { p_id: id, p_action: action, p_cost: cost, p_vat: vat, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: svcError(error.message) };
  back(id);
  return { ok: true, message: action === "approve" ? "Ücret onaylandı; muhasebeye ödeme için iletildi." : "Teknisyene geri gönderildi." };
}

/** Muhasebe: öde → gider kaydı, iş kapanır */
export async function payTicket(_: SvcState | null, f: FormData): Promise<SvcState> {
  const id = s(f, "id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("svc_pay", { p_id: id, p_account: s(f, "account") || null, p_date: s(f, "date") || null });
  if (error) return { ok: false, message: svcError(error.message) };
  back(id);
  revalidatePath("/finans");
  return { ok: true, message: "Ödendi; gider kaydı oluştu, iş kapandı." };
}

export async function addTicketPhoto(id: string, stage: "before" | "after", data: string): Promise<SvcState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("svc_photo", { p_id: id, p_stage: stage, p_data: data });
  if (error) return { ok: false, message: svcError(error.message) };
  back(id);
  return { ok: true, message: "Fotoğraf eklendi." };
}

/** Teknisyen ekle / çıkar (satın alma) */
export async function saveTechnician(_: SvcState | null, f: FormData): Promise<SvcState> {
  const user = s(f, "user_id");
  if (!/^[0-9a-f-]{36}$/.test(user)) return { ok: false, message: "Kullanıcı seçin." };
  const supabase = await createClient();
  const { error } = await supabase.from("svc_technicians").upsert({ user_id: user, phone: s(f, "phone") || null, skills: s(f, "skills") || null, is_active: true }, { onConflict: "company_id,user_id" });
  if (error) return { ok: false, message: svcError(error.message) };
  back();
  return { ok: true, message: "Teknik servis personeli eklendi." };
}

export async function toggleTechnician(f: FormData) {
  const supabase = await createClient();
  await supabase.from("svc_technicians").update({ is_active: s(f, "active") === "1" }).eq("user_id", s(f, "user_id"));
  back();
}

export async function runMaintenanceDue(): Promise<SvcState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("svc_maintenance_due");
  if (error) return { ok: false, message: svcError(error.message) };
  back();
  return { ok: true, message: data ? `${data} demirbaş için bakım kaydı açıldı.` : "Bakım zamanı gelen demirbaş yok." };
}
