"use server";
import { createClient } from "@/lib/supabase/server";

export type WalkinState = { ok: boolean; message: string; token?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Kapıda kayıt (randevusuz ziyaretçi, giriş gerektirmez) */
export async function visWalkin(_: WalkinState | null, f: FormData): Promise<WalkinState> {
  if (s(f, "website")) return { ok: false, message: "Gönderilemedi." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vis_walkin", { p: {
    host_id: s(f, "host") || null, visitor_name: s(f, "name").slice(0, 120), visitor_company: s(f, "company").slice(0, 120), phone: s(f, "phone").slice(0, 40),
    purpose: s(f, "purpose").slice(0, 200), count: s(f, "count") || "1", visitor_type: s(f, "visitor_type") || null, plate: s(f, "plate").slice(0, 20), kvkk: f.get("kvkk") === "on",
  } });
  if (error) {
    const m = error.message;
    return { ok: false, message: /name_required/.test(m) ? "Adınızı ve soyadınızı yazın." : /phone_required/.test(m) ? "Telefon numaranızı yazın." : /kvkk_required/.test(m) ? "Aydınlatma metnini onaylayın." : /too_many/.test(m) ? "Çok fazla kayıt yapıldı; lütfen güvenliğe başvurun." : /vis_walkin|does not exist/.test(m) ? "Kapı kaydı henüz açık değil; lütfen güvenliğe başvurun." : "Kayıt yapılamadı, lütfen güvenliğe başvurun." };
  }
  return { ok: true, message: "Kaydınız alındı.", token: (data as { token: string }).token };
}
