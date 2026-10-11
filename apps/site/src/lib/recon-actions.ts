"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

/** Mutabakat yanıtı (giriş gerektirmez; bağlantıdaki anahtarla) */
export async function respondReconciliation(f: FormData) {
  const token = s(f, "token", 80);
  const locale = ["tr", "en", "fr"].includes(s(f, "locale", 2)) ? s(f, "locale", 2) : "tr";
  const status = s(f, "status", 12) === "disputed" ? "disputed" : "confirmed";
  const raw = s(f, "their", 30).replace(/\s|[^\d.,-]/g, "");
  let their: number | null = null;
  if (raw) {
    const t = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    const n = Number(t);
    their = Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  if (!/^[0-9a-f]{24,80}$/.test(token)) redirect(`/${locale}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_recon_respond", { p_token: token, p_status: status, p_name: s(f, "name", 120), p_note: s(f, "note", 1000) || null, p_their: status === "disputed" ? their : null });
  const q = error ? (/name_required/.test(error.message) ? "ad" : /note_required/.test(error.message) ? "not" : "hata") : status;
  redirect(`/${locale}/mutabakat/${token}?s=${q}`);
}
