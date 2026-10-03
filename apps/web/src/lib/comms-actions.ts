"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, todayIso } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
type R = { ok: boolean; message: string };

/* ---------------- Duyurular ---------------- */
export async function publishAnnouncement(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (!["owner", "hr", "branch_manager"].includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const title = str(f, "title");
  const body = str(f, "body");
  const audience = ["ALL", "DEPARTMENT", "BRANCH"].includes(str(f, "audience")) ? str(f, "audience") : "ALL";
  const departmentIds = f.getAll("department_id").map(String);
  const branchIds = f.getAll("branch_id").map(String);
  if (!title || !body) return { ok: false, message: "Başlık ve metin zorunlu." };
  if (audience === "DEPARTMENT" && !departmentIds.length) return { ok: false, message: "En az bir bölüm seçin." };
  if (audience === "BRANCH" && !branchIds.length) return { ok: false, message: "En az bir şube seçin." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .insert({ company_id: s.companyId, title, body, audience, department_ids: departmentIds, branch_ids: branchIds, pinned: f.get("pinned") === "on", push: f.get("push") === "on", expires_at: str(f, "expires_at") || null })
  if (error) return { ok: false, message: error.message };
  revalidatePath("/duyurular");
  return { ok: true, message: f.get("push") === "on" ? "Duyuru yayınlandı, telefonlara bildirim gönderildi." : "Duyuru yayınlandı." };
}

export async function deleteAnnouncement(f: FormData) {
  const s = await getSession();
  if (!["owner", "hr", "branch_manager"].includes(s.role)) return;
  const supabase = await createClient();
  await supabase.from("announcements").delete().eq("id", str(f, "id"));
  revalidatePath("/duyurular");
}

export async function markAnnouncementsRead(ids: string[]) {
  const s = await getSession();
  if (!ids.length) return;
  const supabase = await createClient();
  await supabase.from("announcement_reads").upsert(ids.map((announcement_id) => ({ announcement_id, user_id: s.userId })), { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
}

/* ---------------- Mesajlar ---------------- */
export async function openDirect(userId: string): Promise<string> {
  await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_direct_conversation", { p_other: userId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function openDepartmentGroup(departmentId: string): Promise<string> {
  await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_department_group", { p_department: departmentId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function sendMessage(conversationId: string, body: string): Promise<{ ok: boolean; message?: string }> {
  await getSession();
  const text = body.trim();
  if (!text) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({ conversation_id: conversationId, body: text.slice(0, 4000) });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function markConversationRead(conversationId: string) {
  const s = await getSession();
  const supabase = await createClient();
  await supabase.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("user_id", s.userId);
}

/* ---------------- Avans talepleri ---------------- */
export async function requestAdvance(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!e) return { ok: false, message: "Hesabınız bir personel kaydına bağlı değil." };
  let amount: number;
  try { amount = parseTL(str(f, "amount")); } catch { return { ok: false, message: "Tutar okunamadı." }; }
  if (amount <= 0) return { ok: false, message: "Tutar girin." };
  const { error } = await supabase.from("advance_requests").insert({ company_id: s.companyId, employee_id: e.id, amount, reason: str(f, "reason") || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/benim");
  return { ok: true, message: "Avans talebiniz iletildi." };
}

export async function decideAdvance(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const supabase = await createClient();
  let amount: number | null = null;
  try { amount = str(f, "amount") ? parseTL(str(f, "amount")) : null; } catch { amount = null; }
  await supabase.rpc("decide_advance", {
    p_id: str(f, "id"),
    p_approve: str(f, "decision") === "approve",
    p_channel: str(f, "channel") === "BANK" ? "BANK" : "CASH",
    p_date: str(f, "date") || todayIso(),
    p_amount: amount,
    p_note: str(f, "note") || null,
  });
  revalidatePath("/talepler");
  revalidatePath("/");
}

export async function cancelAdvance(f: FormData) {
  await getSession();
  const supabase = await createClient();
  await supabase.from("advance_requests").update({ status: "cancelled" }).eq("id", str(f, "id")).eq("status", "pending");
  revalidatePath("/benim");
}

/* ---------------- İzin talebi (personel) ---------------- */
export async function requestLeaveSelf(_: R | null, f: FormData): Promise<R> {
  await getSession();
  const supabase = await createClient();
  const start = str(f, "start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, message: "Başlangıç tarihini seçin." };
  const { data, error } = await supabase.rpc("request_leave_self", { p_type: str(f, "typeId"), p_start: start, p_end: str(f, "end") || null, p_note: str(f, "note") || null });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/benim");
  return { ok: true, message: `${(data as { days: number }).days} günlük izin talebiniz iletildi.` };
}

/* ---------------- Bildirimler ---------------- */
export async function markNotificationsRead() {
  const s = await getSession();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", s.userId).is("read_at", null);
  revalidatePath("/bildirimler");
}
