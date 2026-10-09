"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/recruiting";

export type ApplyResult = { ok: boolean; message?: string; code?: string; token?: string };

const MAX_FILE = 8 * 1024 * 1024;
const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;
const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

/** Web sitesi / mobil başvuru (giriş gerektirmez). Sunucu tarafında doğrulanır, yönetici istemcisiyle yazılır. */
export async function submitApplication(_: ApplyResult | null, f: FormData): Promise<ApplyResult> {
  // Bot tuzağı: görünmeyen alan doluysa sessizce "alındı" gibi davran
  if (s(f, "website")) return { ok: true, code: "B-0000" };
  const first = s(f, "first_name", 60);
  const last = s(f, "last_name", 60);
  const phone = normalizePhone(s(f, "phone", 30));
  if (!first || !last) return { ok: false, message: "Ad ve soyad zorunlu." };
  if (!phone) return { ok: false, message: "Cep telefonunu 05xx xxx xx xx biçiminde yazın." };
  if (f.get("kvkk") !== "on") return { ok: false, message: "Devam etmek için KVKK aydınlatma metnini onaylayın." };
  const email = s(f, "email", 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "E-posta adresi geçersiz." };

  const files = [f.get("cv"), ...f.getAll("portfolio")].filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length > 4) return { ok: false, message: "En fazla 1 özgeçmiş ve 3 örnek dosya yükleyebilirsiniz." };
  for (const x of files) {
    if (x.size > MAX_FILE) return { ok: false, message: `${x.name} 8 MB'tan büyük.` };
    if (!OK_TYPES.test(x.type)) return { ok: false, message: `${x.name}: yalnız PDF, Word veya fotoğraf yükleyin.` };
  }

  const admin = createAdminClient();
  const postingId = s(f, "posting_id", 40) || null;
  let companyId: string | null = null;
  if (postingId) {
    const { data: p } = await admin.from("job_postings").select("company_id, status").eq("id", postingId).maybeSingle();
    if (!p || p.status !== "open") return { ok: false, message: "Bu ilan artık başvuruya kapalı." };
    companyId = p.company_id;
  } else {
    companyId = process.env.PUBLIC_COMPANY_ID || (await admin.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id || null;
  }
  if (!companyId) return { ok: false, message: "Başvuru şu an alınamıyor." };

  // Aynı numaradan 24 saatte en çok 3 başvuru
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("candidates").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
  if ((count ?? 0) >= 3) return { ok: false, message: "Bu numarayla bugün zaten başvuru yapılmış. Durumunuzu SMS ile gelen bağlantıdan takip edebilirsiniz." };

  const wageRaw = s(f, "expected_wage", 20).replace(/\D/g, "");
  const ua = (await headers()).get("user-agent") ?? "";
  const source = s(f, "source") === "mobile" || /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "web";
  const keep = f.get("keep_in_pool") === "on";
  const { data: c, error } = await admin.from("candidates").insert({
    company_id: companyId,
    posting_id: postingId,
    first_name: first,
    last_name: last,
    phone,
    email: email || null,
    birth_date: /^\d{4}-\d{2}-\d{2}$/.test(s(f, "birth_date")) ? s(f, "birth_date") : null,
    district: s(f, "district", 60) || null,
    military: s(f, "military", 40) || null,
    start_when: s(f, "start_when", 40) || null,
    education: s(f, "education", 80) || null,
    experience: s(f, "experience", 40) || null,
    last_employer: s(f, "last_employer", 120) || null,
    expected_wage: wageRaw ? Number(wageRaw) * 100 : null,
    skills: f.getAll("skills").map(String).slice(0, 12),
    about: s(f, "about", 2000) || null,
    source,
    heard_from: s(f, "heard_from", 60) || null,
    referrer_name: s(f, "referrer_name", 80) || null,
    kvkk_consent_at: new Date().toISOString(),
    keep_in_pool: keep,
    purge_after: new Date(Date.now() + (keep ? 365 : 180) * 86_400_000).toISOString().slice(0, 10),
  }).select("id, tracking_code, access_token").single();
  if (error || !c) return { ok: false, message: "Başvuru kaydedilemedi, lütfen tekrar deneyin." };

  // Dosyalar: <şirket>/candidates/<aday>/...
  const paths: string[] = [];
  let cvPath: string | null = null;
  for (const [i, x] of files.entries()) {
    const ext = (x.name.split(".").pop() || "dat").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    const path = `${companyId}/candidates/${c.id}/${i === 0 && f.get("cv") instanceof File && (f.get("cv") as File).size > 0 ? "ozgecmis" : `ornek-${i}`}.${ext}`;
    const { error: upErr } = await admin.storage.from("documents").upload(path, x, { contentType: x.type, upsert: true });
    if (upErr) continue;
    if (path.includes("/ozgecmis.")) cvPath = path; else paths.push(path);
  }
  if (cvPath || paths.length) await admin.from("candidates").update({ cv_path: cvPath, file_paths: paths }).eq("id", c.id);
  return { ok: true, code: c.tracking_code, token: c.access_token };
}

/** Aday, takip sayfasından mülakat davetine yanıt verir */
export async function replyInterview(token: string, reply: "confirmed" | "reschedule") {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false };
  const admin = createAdminClient();
  const { error } = await admin.rpc("candidate_reply", { p_token: token, p_reply: reply });
  return { ok: !error };
}
