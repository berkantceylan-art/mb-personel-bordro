"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, todayIso } from "@/lib/session";
import { done, fail, must } from "@/lib/flash";

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
  await must(supabase.from("announcements").delete().eq("id", str(f, "id")));
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
  const res = await supabase.rpc("decide_advance", {
    p_id: str(f, "id"),
    p_approve: str(f, "decision") === "approve",
    p_channel: str(f, "channel") === "BANK" ? "BANK" : "CASH",
    p_date: str(f, "date") || todayIso(),
    p_amount: amount,
    p_note: str(f, "note") || null,
  });
  if (res.error) await fail(res.error.message);
  revalidatePath("/talepler");
  revalidatePath("/");
  await done(str(f, "decision") === "approve" ? "Avans onaylandı ve cari hesaba işlendi." : "Avans talebi reddedildi.");
}

/** Seçilen avans taleplerini istenen tutarla toplu onaylar (tek kanal ve tarih) veya reddeder */
export async function decideAdvancesBulk(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const approve = str(f, "decision") === "approve";
  const ids = f.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) await fail("Önce listeden talep seçin.");
  const supabase = await createClient();
  let ok = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const res = await supabase.rpc("decide_advance", {
      p_id: id,
      p_approve: approve,
      p_channel: str(f, "channel") === "BANK" ? "BANK" : "CASH",
      p_date: str(f, "date") || todayIso(),
      p_amount: null,
      p_note: str(f, "note") || null,
    });
    if (res.error) errors.push(res.error.message);
    else ok++;
  }
  revalidatePath("/talepler");
  revalidatePath("/");
  if (!ok) await fail(errors[0] ?? "İşlem yapılamadı.");
  await done(`${ok} avans talebi ${approve ? "onaylandı ve cari hesaba işlendi" : "reddedildi"}.${errors.length ? ` ${errors.length} talep işlenemedi (${errors[0]}).` : ""}`);
}

export async function cancelAdvance(f: FormData) {
  await getSession();
  const supabase = await createClient();
  await must(supabase.from("advance_requests").update({ status: "cancelled" }).eq("id", str(f, "id")).eq("status", "pending"));
  revalidatePath("/benim");
}

/* ---------------- İzin talebi (personel) ---------------- */
export async function requestLeaveSelf(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  const supabase = await createClient();
  const start = str(f, "start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, message: "Başlangıç tarihini seçin." };
  const startTime = str(f, "start_time") || null;
  const endTime = str(f, "end_time") || null;

  // Rapor belgesi (fotoğraf/PDF) personelin kendi klasörüne yüklenir
  let document: string | null = null;
  const file = f.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { ok: false, message: "Dosya 10 MB'tan büyük olamaz." };
    const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
    if (!me) return { ok: false, message: "Hesabınız bir personel kaydına bağlı değil." };
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    document = `${s.companyId}/employees/${me.id}/rapor-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(document, file, { contentType: file.type || undefined });
    if (error) return { ok: false, message: error.message.includes("policy") ? "Belge yükleme izni yok (20261030000000_self_documents.sql çalıştırılmalı)." : error.message };
  }
  const args: Record<string, unknown> = { p_type: str(f, "typeId"), p_start: start, p_end: str(f, "end") || null, p_note: str(f, "note") || null };
  if (startTime || endTime || document) Object.assign(args, { p_start_time: startTime, p_end_time: endTime, p_document: document });
  const { data, error } = await supabase.rpc("request_leave_self", args);
  if (error) return { ok: false, message: /p_start_time|p_document/.test(error.message) ? "Saatlik izin ve rapor için sunucu güncellemesi gerekli (20261031000000_mobile_self_service.sql)." : error.message };
  revalidatePath("/benim");
  revalidatePath("/benim/izin");
  const d = data as { days: number; hours?: number | null };
  return { ok: true, message: d.hours ? `${d.hours} saatlik izin talebiniz iletildi.` : document ? `${d.days} günlük raporunuz iletildi; İK onaylayınca izne işlenir.` : `${d.days} günlük izin talebiniz iletildi.` };
}

/* ---------------- Bildirimler ---------------- */
export async function markNotificationsRead() {
  const s = await getSession();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", s.userId).is("read_at", null);
  revalidatePath("/bildirimler");
}
