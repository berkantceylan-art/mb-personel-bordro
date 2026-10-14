"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f-]{36}$/;

function utsError(m: string) {
  if (/uts_|does not exist|schema cache/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270205000000_uts.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için stok yetkiniz yok.";
  if (/bad_status/.test(m)) return "Bildirim bu işlem için uygun durumda değil (sayfayı yenileyin).";
  return m;
}

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < level && (s.modules.production ?? 0) < level) await fail("Bu işlem için stok yetkiniz yok.");
  return s;
}

export async function saveUtsSettings(f: FormData) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 3 && s.role !== "owner") await fail("ÜTS ayarları için stok yönetici yetkisi gerekir.");
  const on = (k: string) => f.get(k) === "on";
  const supabase = await createClient();
  const { error } = await supabase.rpc("uts_settings_save", { p: { enabled: on("enabled"), auto_alma: on("auto_alma"), auto_kullanim: on("auto_kullanim"), auto_verme: on("auto_verme"), auto_ismarlama: on("auto_ismarlama"), env: str(f, "env") === "live" ? "live" : "test", start_date: str(f, "start_date", 10) || null } });
  if (error) await fail(utsError(error.message));
  revalidatePath("/stok/uts");
  await done("ÜTS ayarları kaydedildi.");
}

export async function utsAction(f: FormData) {
  await need(2);
  const id = str(f, "id", 40);
  const action = str(f, "action", 30);
  if (!UUID.test(id) || !["retry", "manual", "cancel", "cancelled_in_uts"].includes(action)) await fail("Geçersiz işlem.");
  const patch: Record<string, string> = {};
  for (const k of ["lot_no", "serial_no", "product_no", "counterparty_no", "qty"]) if (f.has(k)) patch[k] = str(f, k, 60);
  const supabase = await createClient();
  const { error } = await supabase.rpc("uts_action", { p_id: id, p_action: action, p_ref: str(f, "ref", 120) || null, p_patch: Object.keys(patch).length ? patch : null });
  if (error) await fail(utsError(error.message));
  revalidatePath("/stok/uts");
  await done(action === "retry" ? "Bildirim yeniden sıraya alındı; birkaç dakika içinde gönderilir." : action === "manual" ? "ÜTS'de elle yapıldı olarak işaretlendi." : action === "cancel" ? "Bildirim gönderilmeyecek." : "ÜTS'de iptal edildi olarak işaretlendi.");
}

export async function utsAdd(f: FormData) {
  await need(2);
  const supabase = await createClient();
  const p: Record<string, string> = {};
  for (const k of ["kind", "item_id", "item_name", "product_no", "lot_no", "serial_no", "qty", "expiry_date", "counterparty_no", "counterparty_name", "note"]) p[k] = str(f, k, 300);
  const { error } = await supabase.rpc("uts_add", { p });
  if (error) await fail(utsError(error.message));
  revalidatePath("/stok/uts");
  await done("Bildirim sıraya eklendi.");
}
