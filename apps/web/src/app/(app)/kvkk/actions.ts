"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { CONSENT_PURPOSES, RETENTION_DEFAULTS, candidateNotice, employeeNotice } from "@/lib/kvkk";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("kvkk") ? "Supabase'de 20261115000000_kvkk.sql çalıştırılmalı." : m);
async function staff(ownerOnly = false) {
  const s = await getSession();
  if (!(ownerOnly ? ["owner"] : ["owner", "hr"]).includes(s.role)) await fail(ownerOnly ? "Bu işlemi yalnız şirket sahibi yapabilir." : "Yetkiniz yok.");
  return { s, supabase: await createClient() };
}

/** Örnek aydınlatma / açık rıza metinlerini ve saklama sürelerini oluşturur */
export async function seedKvkk() {
  const { s, supabase } = await staff();
  const { data: c } = await supabase.from("companies").select("*").eq("id", s.companyId).maybeSingle();
  const co = { name: c?.name ?? s.companyName, address: (c as { address?: string } | null)?.address, email: (c as { email?: string } | null)?.email };
  const { count } = await supabase.from("kvkk_notices").select("id", { count: "exact", head: true });
  if (!count) {
    const { error } = await supabase.from("kvkk_notices").insert([
      { company_id: s.companyId, audience: "employee", kind: "aydinlatma", title: "Çalışan aydınlatma metni", body: employeeNotice(co) },
      { company_id: s.companyId, audience: "candidate", kind: "aydinlatma", title: "Çalışan adayı aydınlatma metni", body: candidateNotice(co) },
      ...CONSENT_PURPOSES.map((p) => ({ company_id: s.companyId, audience: "employee", kind: "acik_riza", purpose_key: p.key, title: p.title, body: p.body })),
    ]);
    if (error) await fail(missing(error.message));
  }
  await supabase.from("kvkk_retention").upsert(RETENTION_DEFAULTS.map((r, i) => ({ ...r, company_id: s.companyId, sort: i })), { onConflict: "company_id,category", ignoreDuplicates: true });
  revalidatePath("/kvkk");
  await done("Örnek metinler ve saklama süreleri oluşturuldu. Metinleri avukatınızla gözden geçirip düzenleyin.");
}

/** Metni değiştirmek yeni sürüm yayınlar; önceki onaylar eski sürüme ait kalır */
export async function saveNotice(f: FormData) {
  const { s, supabase } = await staff();
  const id = str(f, "id");
  const { data: old } = await supabase.from("kvkk_notices").select("*").eq("id", id).maybeSingle();
  if (!old) await fail("Metin bulunamadı.");
  const body = str(f, "body");
  const title = str(f, "title");
  if (body === old!.body && title === old!.title) await done("Değişiklik yok.");
  await supabase.from("kvkk_notices").update({ active: false }).eq("id", id);
  const { error } = await supabase.from("kvkk_notices").insert({ company_id: s.companyId, audience: old!.audience, kind: old!.kind, purpose_key: old!.purpose_key, title, body, version: old!.version + 1 });
  if (error) await fail(error.message);
  revalidatePath("/kvkk");
  await done(`Sürüm ${old!.version + 1} yayınlandı; çalışanlardan yeniden onay istenecek.`);
}

export async function saveRequest(f: FormData) {
  const { s, supabase } = await staff();
  const id = str(f, "id");
  if (id) {
    const status = ["open", "in_progress", "answered", "rejected"].includes(str(f, "status")) ? str(f, "status") : "in_progress";
    const { error } = await supabase.from("kvkk_requests").update({ status, response: str(f, "response") || null, responded_at: ["answered", "rejected"].includes(status) ? new Date().toISOString() : null, handled_by: s.userId }).eq("id", id);
    if (error) await fail(error.message);
  } else {
    if (!str(f, "requester_name") || !str(f, "details")) await fail("Başvuran ve talep zorunlu.");
    const { error } = await supabase.from("kvkk_requests").insert({
      company_id: s.companyId, requester_name: str(f, "requester_name"), requester_contact: str(f, "requester_contact") || "-", requester_type: str(f, "requester_type") || "diger",
      request_type: str(f, "request_type") || "bilgi", details: str(f, "details"), ...(str(f, "received_at") ? { received_at: `${str(f, "received_at")}T12:00:00+03:00` } : {}),
    });
    if (error) await fail(missing(error.message));
  }
  revalidatePath("/kvkk");
  await done("Başvuru kaydedildi.");
}

export async function toggleCheck(f: FormData) {
  const { s, supabase } = await staff();
  const on = str(f, "on") === "1";
  const { error } = await supabase.from("kvkk_checklist").upsert({ company_id: s.companyId, key: str(f, "key"), done_at: on ? new Date().toISOString() : null, updated_by: s.userId }, { onConflict: "company_id,key" });
  if (error) await fail(missing(error.message));
  revalidatePath("/kvkk");
}

export async function saveBreach(f: FormData) {
  const { s, supabase } = await staff();
  if (!str(f, "description") || !str(f, "occurred_at")) await fail("Tarih ve açıklama zorunlu.");
  const { error } = await supabase.from("kvkk_breaches").insert({
    company_id: s.companyId, occurred_at: `${str(f, "occurred_at")}:00+03:00`, description: str(f, "description"), data_categories: str(f, "data_categories") || null,
    affected_count: Number(str(f, "affected_count")) || null, measures: str(f, "measures") || null, board_notified_at: str(f, "board_notified_at") ? `${str(f, "board_notified_at")}:00+03:00` : null,
  });
  if (error) await fail(missing(error.message));
  revalidatePath("/kvkk");
  await done("İhlal kaydedildi. Öğrenildiği andan itibaren 72 saat içinde Kurul'a bildirim yapılmalıdır.");
}

const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 86_400_000).toISOString();

/**
 * Periyodik imha (Silme Yönetmeliği md. 11): saklama süresi dolan kayıtlar silinir / anonimleştirilir ve tutanak yazılır.
 * Yalnız şirket sahibi çalıştırır; ekranda onay sorulur. Yalnız oturumdaki şirketin kayıtlarına dokunur.
 */
export async function runDisposal(f: FormData) {
  const { s } = await staff(true);
  const cat = str(f, "category");
  const admin = createAdminClient();
  const cid = s.companyId;
  let count = 0;
  let method = "";
  let detail = "";
  if (cat === "Puantaj (PDKS)") {
    const { data: old } = await admin.from("attendance_punches").select("id").eq("company_id", cid).lt("punched_at", yearsAgo(5).slice(0, 19)).limit(50000);
    const ids = (old ?? []).map((x) => x.id as string);
    for (let i = 0; i < ids.length; i += 500) await admin.from("attendance_punches").delete().eq("company_id", cid).in("id", ids.slice(i, i + 500));
    const { data: loc } = await admin.from("attendance_punches").update({ lat: null, lng: null, accuracy_m: null, distance_m: null }).eq("company_id", cid).lt("punched_at", yearsAgo(1).slice(0, 19)).not("lat", "is", null).select("id");
    count = ids.length; method = "Silme";
    detail = `${count} okutma silindi (5 yıldan eski); ${(loc ?? []).length} okutmanın konum bilgisi silindi (1 yıldan eski)`;
  } else if (cat === "Özlük dosyası" || cat === "Bordro ve ücret" || cat === "Sağlık ve İSG") {
    const yrs = cat === "Sağlık ve İSG" ? 15 : 10;
    const { data: emps } = await admin.from("employees").select("id").eq("company_id", cid).eq("status", "terminated").lt("termination_date", yearsAgo(yrs).slice(0, 10)).neq("first_name", "Anonim");
    for (const e of emps ?? []) {
      const { data: docs } = await admin.from("employee_documents").select("file_path").eq("employee_id", e.id);
      if (docs?.length) await admin.storage.from("documents").remove(docs.map((d) => d.file_path as string));
      await admin.from("employee_documents").delete().eq("employee_id", e.id);
      await admin.from("employee_private").delete().eq("employee_id", e.id);
      await admin.from("employees").update({ first_name: "Anonim", last_name: String(e.id).slice(0, 6), card_no: null, notes: null, position_title: null, user_id: null }).eq("id", e.id).eq("company_id", cid);
      await admin.from("audit_log").delete().in("table_name", ["employees", "employee_private"]).eq("row_id", e.id);
    }
    count = (emps ?? []).length; method = "Anonimleştirme";
    detail = `${yrs} yıldan önce ayrılan ${count} personelin kimlik, iletişim, banka bilgileri ve belgeleri silindi; kayıtlar anonim hâle getirildi (bordro tutarları korunur).`;
  } else if (cat === "İletişim ve duyurular") {
    const { data: n } = await admin.from("notifications").delete().eq("company_id", cid).lt("created_at", yearsAgo(2)).select("id");
    count = (n ?? []).length; method = "Silme"; detail = `${count} bildirim silindi (2 yıldan eski)`;
  } else if (cat === "Erişim kayıtları (log)") {
    const { data: n } = await admin.from("kvkk_access_log").delete().eq("company_id", cid).lt("at", yearsAgo(2)).select("id");
    count = (n ?? []).length; method = "Silme"; detail = `${count} erişim kaydı silindi (2 yıldan eski)`;
  } else if (cat === "Aday başvuruları") {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin.from("candidates").select("id, cv_path, file_paths").eq("company_id", cid).lt("purge_after", today).is("employee_id", null);
    const files = (data ?? []).flatMap((c) => [c.cv_path, ...((c.file_paths as string[] | null) ?? [])]).filter(Boolean) as string[];
    if (files.length) await admin.storage.from("documents").remove(files);
    if (data?.length) await admin.from("candidates").delete().eq("company_id", cid).in("id", data.map((c) => c.id));
    count = (data ?? []).length; method = "Silme"; detail = `${count} aday başvurusu ve ${files.length} dosya silindi`;
  } else await fail("Bu kategori için otomatik imha tanımlı değil.");
  await admin.from("kvkk_disposals").insert({ company_id: cid, category: cat, method, record_count: count, detail, done_by: s.userId });
  revalidatePath("/kvkk");
  await done(`İmha tamamlandı: ${detail}`);
}
