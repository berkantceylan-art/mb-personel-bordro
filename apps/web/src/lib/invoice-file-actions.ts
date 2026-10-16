"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const MOD: Record<string, string> = { sale: "sales", purchase: "purchases" };

async function canEdit(invoiceId: string) {
  const s = await getSession();
  const admin = createAdminClient();
  const { data: inv } = await admin.from("inv_invoices").select("id, direction, company_id").eq("id", invoiceId).maybeSingle();
  if (!inv || inv.company_id !== s.companyId) return { s, admin, ok: false as const };
  const lvl = Math.max(s.modules[MOD[inv.direction as string] ?? "purchases"] ?? 0, s.modules.finance ?? 0, s.role === "owner" ? 3 : 0);
  return { s, admin, ok: lvl >= 2 };
}

/** Yüklenen görüntüyü / PDF'i faturaya bağla (dosya önce tarayıcıdan receipts/<kullanıcı>/ altına yüklenir) */
export async function attachInvoiceFile(invoiceId: string, path: string, name: string | null, mime: string | null, size: number | null): Promise<{ ok: boolean; message: string }> {
  const { s, admin, ok } = await canEdit(invoiceId);
  if (!ok) return { ok: false, message: "Bu faturaya dosya ekleme yetkiniz yok." };
  if (!path.startsWith(`${s.userId}/`) || path.includes("..")) return { ok: false, message: "Geçersiz dosya." };
  const { error } = await admin.from("inv_invoice_files").insert({ company_id: s.companyId, invoice_id: invoiceId, path, name: name?.slice(0, 200) ?? null, mime: mime?.slice(0, 80) ?? null, size, created_by: s.userId });
  if (error) return { ok: false, message: /inv_invoice_files/.test(error.message) ? "Supabase'de mbdental-fatura-gorsel.sql çalıştırılmalı." : error.message };
  revalidatePath(`/fatura/${invoiceId}`);
  return { ok: true, message: "Fatura görüntüsü kaydedildi." };
}

export async function deleteInvoiceFile(fileId: string): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  const admin = createAdminClient();
  const { data: f } = await admin.from("inv_invoice_files").select("id, invoice_id, path, company_id").eq("id", fileId).maybeSingle();
  if (!f || f.company_id !== s.companyId) return { ok: false, message: "Dosya bulunamadı." };
  const c = await canEdit(f.invoice_id as string);
  if (!c.ok) return { ok: false, message: "Silme yetkiniz yok." };
  await admin.from("inv_invoice_files").delete().eq("id", fileId);
  await admin.storage.from("receipts").remove([f.path as string]);
  revalidatePath(`/fatura/${f.invoice_id}`);
  return { ok: true, message: "Silindi." };
}
