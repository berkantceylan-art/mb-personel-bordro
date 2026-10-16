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

/**
 * Kart kuralı ekle. IGNORE: bu kartın okutmaları hiç alınmaz ve kimseye bağlı olmayan eski kayıtları silinir.
 * MAP: bu kartın okutmaları seçilen personele yazılır; kimseye bağlı olmayan eski kayıtları da ona bağlanır.
 */
export async function addCardRule(input: { cardNo: string; action: "IGNORE" | "MAP"; employeeId?: string | null; note?: string }): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!allowed(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const card = String(input.cardNo ?? "").trim();
  if (!/^[0-9]{1,12}$/.test(card)) return { ok: false, message: "Kart no yalnız rakam olmalı." };
  const norm = card.replace(/^0+/, "") || "0";
  if (input.action !== "IGNORE" && input.action !== "MAP") return { ok: false, message: "Geçersiz işlem." };
  const admin = createAdminClient();
  let emp: { id: string; branch_id: string } | null = null;
  if (input.action === "MAP") {
    const { data } = await admin.from("employees").select("id, branch_id").eq("id", input.employeeId ?? "").eq("company_id", s.companyId).maybeSingle();
    if (!data) return { ok: false, message: "Personel seçin." };
    emp = data as { id: string; branch_id: string };
  }
  const { error } = await admin.from("pdks_card_rules").insert({ company_id: s.companyId, card_no: norm, action: input.action, employee_id: emp?.id ?? null, note: (input.note ?? "").trim().slice(0, 120) || null });
  if (error) return { ok: false, message: /duplicate|unique/i.test(error.message) ? "Bu kart için zaten bir kural var." : /pdks_card_rules/.test(error.message) ? "Supabase'de 20270239000000_pdks_card_rules.sql çalıştırılmalı." : error.message };

  // Eski kayıtlar: kart no baştaki sıfırlarla da yazılmış olabilir
  const { data: unlinked } = await admin.from("attendance_punches").select("id, card_no").eq("company_id", s.companyId).is("employee_id", null).like("card_no", `%${norm}`);
  const ids = (unlinked ?? []).filter((p) => String(p.card_no).replace(/^0+/, "") === norm).map((p) => p.id as string);
  let affected = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const q = emp
      ? admin.from("attendance_punches").update({ employee_id: emp.id, branch_id: emp.branch_id }).in("id", chunk)
      : admin.from("attendance_punches").delete().in("id", chunk);
    const { error: e2 } = await q;
    if (e2) return { ok: false, message: `Kural eklendi ama eski kayıtlar işlenemedi: ${e2.message}` };
    affected += chunk.length;
  }
  revalidatePath("/puantaj/otomatik");
  revalidatePath("/puantaj");
  return { ok: true, message: emp ? `Kural eklendi · ${affected} eski okutma personele bağlandı.` : `Kural eklendi · ${affected} eski okutma silindi.` };
}

export async function removeCardRule(id: string): Promise<{ ok: boolean; message?: string }> {
  const s = await getSession();
  if (!allowed(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const { error } = await createAdminClient().from("pdks_card_rules").delete().eq("id", id).eq("company_id", s.companyId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/puantaj/otomatik");
  return { ok: true };
}
