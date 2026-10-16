"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Dentalsis aktarımında bakiyeyi eşitlemek için açılan 31.12.2025 tarihli "DEVİR BAKİYESİ" işini ve
 * "Dentalsis bakiye eşitleme" mahsubunu bu cariden kaldırır. Gerçek işlere ve tahsilatlara dokunmaz.
 */
export async function removeDsisOpening(customerId: string): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  const lvl = Math.max(s.modules.finance ?? 0, s.modules.sales ?? 0, s.role === "owner" ? 3 : 0);
  if (lvl < 2 || !s.logistics) return { ok: false, message: "Bu düzeltme için yetkiniz yok." };
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return { ok: false, message: "Geçersiz cari." };
  const admin = createAdminClient();
  const { data: c } = await admin.from("lab_customers").select("id, company_id").eq("id", customerId).maybeSingle();
  if (!c || c.company_id !== s.companyId) return { ok: false, message: "Cari bulunamadı." };
  const { data: j, error: je } = await admin.from("jobs").delete().eq("customer_id", customerId).lt("legacy_id", 0).eq("patient", "DEVİR BAKİYESİ").select("id");
  if (je) return { ok: false, message: `Devir işi silinemedi: ${je.message}` };
  const { data: p, error: pe } = await admin.from("lab_payments").delete().eq("customer_id", customerId).eq("legacy_ref", `dsis-adj:${customerId}`).select("id");
  if (pe) return { ok: false, message: `Eşitleme mahsubu silinemedi: ${pe.message}` };
  revalidatePath(`/isler/hekimler/${customerId}`);
  revalidatePath("/isler/cari");
  const n = (j?.length ?? 0) + (p?.length ?? 0);
  return { ok: true, message: n ? "Dentalsis devir / eşitleme kaydı kaldırıldı; bakiye yeniden hesaplandı." : "Bu caride Dentalsis devir kaydı yok." };
}
