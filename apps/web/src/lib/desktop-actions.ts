"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { visibleNav } from "@/lib/nav";

export type Shortcut = { href: string; label: string; icon: string };
export type DeskState = { ok?: boolean; message: string };
const COLORS = ["yellow", "blue", "green", "pink", "purple", "gray"];
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"];
const SQL = "Supabase'de 20270103000000_desktop.sql çalıştırılmalı.";
const err = (m: string) => (/user_notes|user_reminders|shortcuts|schema cache|rem_fire/.test(m) ? SQL : m);
const back = () => { revalidatePath("/"); revalidatePath("/benim"); };

/** Masaüstü simgeleri: yalnız kullanıcının yetkili olduğu menü sayfaları kaydedilir */
export async function saveShortcuts(list: Shortcut[]): Promise<DeskState> {
  const s = await getSession();
  const allowed = new Set(visibleNav(s.role, s.siteAccess, s.logistics, s.modules).flatMap((g) => g.items.map((i) => i.href)));
  allowed.add("/").add("/benim");
  const clean = (Array.isArray(list) ? list : []).filter((x) => x && allowed.has(x.href)).slice(0, 40).map((x) => ({ href: x.href, label: String(x.label ?? "").slice(0, 40) || x.href, icon: String(x.icon ?? "").slice(0, 8) || "⭐" }));
  const supabase = await createClient();
  const { error } = await supabase.from("user_dashboard").upsert({ user_id: s.userId, shortcuts: clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return { ok: false, message: err(error.message) };
  back();
  return { ok: true, message: "Masaüstü kaydedildi." };
}

export async function saveNote(input: { id?: string; body: string; color?: string; pinned?: boolean }): Promise<DeskState & { id?: string }> {
  const body = String(input.body ?? "").trim().slice(0, 2000);
  const supabase = await createClient();
  if (!body) {
    if (input.id) await supabase.from("user_notes").delete().eq("id", input.id);
    back();
    return { ok: true, message: "Not silindi." };
  }
  const row = { body, color: COLORS.includes(input.color ?? "") ? input.color : "yellow", pinned: !!input.pinned, updated_at: new Date().toISOString() };
  const res = input.id ? await supabase.from("user_notes").update(row).eq("id", input.id).select("id").single() : await supabase.from("user_notes").insert(row).select("id").single();
  if (res.error) return { ok: false, message: err(res.error.message) };
  back();
  return { ok: true, message: "Not kaydedildi.", id: res.data.id as string };
}

export async function deleteNote(id: string) {
  const supabase = await createClient();
  await supabase.from("user_notes").delete().eq("id", id);
  back();
}

/** Hatırlatma ekle / düzenle (tarih-saat İstanbul) */
export async function saveReminder(_: DeskState | null, f: FormData): Promise<DeskState> {
  const title = String(f.get("title") ?? "").trim().slice(0, 160);
  const at = String(f.get("at") ?? "");
  if (!title) return { ok: false, message: "Ne hatırlatılsın?" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return { ok: false, message: "Tarih ve saat seçin." };
  const link = String(f.get("link") ?? "").trim();
  const repeat = String(f.get("repeat") ?? "none");
  const row = {
    title,
    note: String(f.get("note") ?? "").trim().slice(0, 1000) || null,
    remind_at: new Date(`${at}:00+03:00`).toISOString(),
    repeat: REPEATS.includes(repeat) ? repeat : "none",
    link: link.startsWith("/") ? link.slice(0, 300) : null,
    notified_at: null,
    done_at: null,
  };
  const id = String(f.get("id") ?? "");
  const supabase = await createClient();
  const { error } = id ? await supabase.from("user_reminders").update(row).eq("id", id) : await supabase.from("user_reminders").insert(row);
  if (error) return { ok: false, message: err(error.message) };
  back();
  return { ok: true, message: "Hatırlatma kuruldu; zamanı gelince bildirim gelir." };
}

export async function reminderAction(id: string, op: "done" | "delete" | "snooze") {
  const supabase = await createClient();
  if (op === "done") await supabase.from("user_reminders").update({ done_at: new Date().toISOString() }).eq("id", id);
  else if (op === "delete") await supabase.from("user_reminders").delete().eq("id", id);
  else if (op === "snooze") await supabase.from("user_reminders").update({ remind_at: new Date(Date.now() + 10 * 60000).toISOString(), notified_at: null, done_at: null }).eq("id", id);
  back();
}

/** Uygulama açıkken her dakika: zamanı gelenleri gönder, bu kullanıcıya yeni düşenleri döndür (ekranda uyarı için) */
export async function pollReminders(): Promise<{ id: string; title: string; body: string; link: string }[]> {
  const s = await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rem_fire");
  if (error) return [];
  const since = new Date(Date.now() - 75000).toISOString();
  const { data } = await supabase.from("notifications").select("id, title, body, link").eq("user_id", s.userId).like("title", "⏰%").is("read_at", null).gte("created_at", since).limit(5);
  return ((data ?? []) as { id: string; title: string; body: string | null; link: string | null }[]).map((n) => ({ id: n.id, title: n.title, body: n.body ?? "", link: n.link ?? "/" }));
}
