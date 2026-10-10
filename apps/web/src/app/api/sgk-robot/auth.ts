import { NextResponse } from "next/server";
import { tokenHash } from "@/lib/sgk/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

/** Eklentinin gönderdiği kişisel robot anahtarını doğrular */
export async function robotAuth(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!t.startsWith("mbsgk_")) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("sgk_robot_tokens").select("id, company_id, user_id, revoked_at").eq("token_hash", tokenHash(t)).maybeSingle();
  if (!data || data.revoked_at) return null;
  await admin.from("sgk_robot_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { admin, companyId: data.company_id as string, userId: data.user_id as string };
}
