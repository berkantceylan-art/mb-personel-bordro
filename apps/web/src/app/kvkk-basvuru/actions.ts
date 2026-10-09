"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { REQUEST_TYPES } from "@/lib/kvkk";

export type R = { ok: boolean; message?: string };
const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

/** Herkese açık KVKK başvurusu (sunucuda doğrulanır; aynı iletişimden günde en çok 3 başvuru) */
export async function submitPublicKvkk(_: R | null, f: FormData): Promise<R> {
  if (s(f, "website")) return { ok: true };
  const name = s(f, "name", 100); const contact = s(f, "contact", 120); const details = s(f, "details", 4000);
  if (!name || !contact || details.length < 5) return { ok: false, message: "Ad, iletişim ve açıklama zorunlu." };
  const type = REQUEST_TYPES[s(f, "type")] ? s(f, "type") : "bilgi";
  const rel = ["aday", "eski_calisan", "calisan", "diger"].includes(s(f, "rel")) ? s(f, "rel") : "diger";
  const admin = createAdminClient();
  const companyId = process.env.PUBLIC_COMPANY_ID || (await admin.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id;
  if (!companyId) return { ok: false, message: "Başvuru şu an alınamıyor." };
  const { count } = await admin.from("kvkk_requests").select("id", { count: "exact", head: true }).eq("requester_contact", contact).gte("received_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 3) return { ok: false, message: "Bugün bu iletişim bilgisiyle başvuru yapılmış." };
  const { error } = await admin.from("kvkk_requests").insert({ company_id: companyId, requester_name: name, requester_contact: contact, requester_type: rel, request_type: type, details });
  return error ? { ok: false, message: "Başvuru kaydedilemedi, lütfen tekrar deneyin." } : { ok: true };
}
