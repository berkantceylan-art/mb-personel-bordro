"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const allowed = (r: string) => ["owner", "accountant", "hr"].includes(r);

/** Ofis bilgisayarındaki aktarıcı için yeni anahtar: yalnız bir kez gösterilir, özeti saklanır */
export async function createPdksAgent(name: string): Promise<{ ok: boolean; message?: string; token?: string }> {
  const s = await getSession();
  if (!allowed(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const n = (name || "Ofis bilgisayarı").trim().slice(0, 80);
  const token = randomBytes(32).toString("hex");
  const { error } = await createAdminClient().from("pdks_agents").insert({ company_id: s.companyId, name: n, token_hash: createHash("sha256").update(token).digest("hex"), created_by: s.userId });
  if (error) return { ok: false, message: /pdks_agents/.test(error.message) ? "Supabase'de 20270238000000_pdks_agent.sql çalıştırılmalı." : error.message };
  revalidatePath("/puantaj/otomatik");
  return { ok: true, token };
}

export async function setPdksAgentActive(id: string, active: boolean): Promise<{ ok: boolean; message?: string }> {
  const s = await getSession();
  if (!allowed(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const { error } = await createAdminClient().from("pdks_agents").update({ is_active: active }).eq("id", id).eq("company_id", s.companyId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/puantaj/otomatik");
  return { ok: true };
}
