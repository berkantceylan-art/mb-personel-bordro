"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export async function saveVoice(_: { ok?: boolean; message: string } | null, f: FormData): Promise<{ ok?: boolean; message: string }> {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const template = String(f.get("template") ?? "").trim().slice(0, 400);
  if (!template) return { ok: false, message: "Karşılama metnini yazın." };
  const rate = Math.min(1.6, Math.max(0.5, Number(f.get("rate")) || 1));
  const supabase = await createClient();
  const { error } = await supabase.from("company_voice").upsert({ company_id: s.companyId, enabled: f.get("enabled") === "on", template, announce: f.get("announce") === "on", rate, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: /company_voice/.test(error.message) ? "Supabase'de 20270109000000_voice.sql çalıştırılmalı." : error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Kaydedildi. Kullanıcılar bir sonraki girişte (ilk dokunuşta) karşılanır." };
}
