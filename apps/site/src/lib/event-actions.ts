"use server";
import { siteEvent } from "@/lib/track-server";
import { createClient } from "@/lib/supabase/server";

export type RegState = { ok?: boolean; error?: "full" | "err" | "past" } | null;

/** Eğitime kayıt (giriş gerektirmez) */
export async function registerEvent(_: RegState, f: FormData): Promise<RegState> {
  if (String(f.get("website") ?? "")) return { ok: true };
  const s = (k: string) => String(f.get(k) ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("event_register", { p_event: s("event_id"), p_name: s("name"), p_email: s("email"), p_phone: s("phone") || null, p_clinic: s("clinic") || null, p_city: s("city") || null });
  if (error) return { error: /event_full/.test(error.message) ? "full" : /event_past/.test(error.message) ? "past" : "err" };
  await siteEvent("event_register");
  return { ok: true };
}
