"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type NewCat = { ok: boolean; message?: string; cat?: { id: string; name: string; kind: string; code: string } };

/** Fatura / e-fatura aktarımı sırasında yeni gider türü (kira, elektrik, su …) aç; aynı adda varsa onu döndür */
export async function quickAddExpenseCategory(name: string): Promise<NewCat> {
  const s = await getSession();
  const lvl = Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0, s.role === "owner" ? 3 : 0);
  if (lvl < 2) return { ok: false, message: "Gider türü açma yetkiniz yok." };
  const n = (name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (n.length < 2) return { ok: false, message: "Gider türünün adını yazın." };
  const admin = createAdminClient();
  const { data: same } = await admin.from("fin_categories").select("id, name, kind, code").eq("company_id", s.companyId).eq("kind", "expense").ilike("name", n.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1).maybeSingle();
  if (same) {
    await admin.from("fin_categories").update({ is_active: true }).eq("id", same.id);
    return { ok: true, cat: same as NewCat["cat"] };
  }
  const code = `exp_${Date.now().toString(36)}`;
  const { data, error } = await admin.from("fin_categories").insert({ company_id: s.companyId, code, name: n, kind: "expense", sort: 50 }).select("id, name, kind, code").single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/finans/kategoriler");
  return { ok: true, cat: data as NewCat["cat"] };
}
