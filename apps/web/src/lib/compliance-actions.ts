"use server";
import { revalidatePath } from "next/cache";
import { expiryDate, type ComplianceType, type HazardClass } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { must } from "@/lib/flash";

const canSafety = (r: string) => ["owner", "hr", "safety"].includes(r);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
type R = { ok: boolean; message: string };

async function uploadFile(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, folder: string, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error("Dosya 10 MB'tan büyük olamaz");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${companyId}/${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

export async function setHazardClass(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const v = str(f, "hazard_class");
  if (!["AZ", "TEHLIKELI", "COK"].includes(v)) return;
  const supabase = await createClient();
  await supabase.from("companies").update({ hazard_class: v }).eq("id", s.companyId);
  revalidatePath("/isg");
  revalidatePath("/saglik");
}

/** Toplu kayıt: aynı eğitime / muayeneye katılan birden çok personel */
export async function addComplianceRecords(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (!canSafety(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const category = str(f, "category") === "HEALTH" ? "HEALTH" : "TRAINING";
  const typeId = str(f, "typeId");
  const date = str(f, "date");
  const ids = f.getAll("employeeId").map(String).filter(Boolean);
  if (!typeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Tür ve tarih zorunlu." };
  if (!ids.length) return { ok: false, message: "En az bir personel seçin." };
  const supabase = await createClient();
  const [{ data: t }, { data: company }] = await Promise.all([
    supabase.from("compliance_types").select("*").eq("id", typeId).single(),
    supabase.from("companies").select("hazard_class").eq("id", s.companyId).single(),
  ]);
  if (!t) return { ok: false, message: "Tür bulunamadı." };
  const ct: ComplianceType = { id: t.id, name: t.name, validityMonths: t.validity_months, validityByClass: t.validity_by_class, required: t.required };
  const explicit = str(f, "expires_on") || null;
  const exp = expiryDate(date, ct, (company?.hazard_class ?? "COK") as HazardClass, explicit);
  let doc: string | null = null;
  try {
    doc = await uploadFile(supabase, s.companyId, category === "TRAINING" ? "isg" : "saglik", f.get("file"));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const sessionId = crypto.randomUUID();
  const { error } =
    category === "TRAINING"
      ? await supabase.from("training_records").insert(
          ids.map((employee_id) => ({
            company_id: s.companyId, employee_id, type_id: typeId, done_on: date, expires_on: exp,
            hours: str(f, "hours") ? Number(str(f, "hours").replace(",", ".")) : t.min_hours, trainer: str(f, "trainer") || null,
            provider: str(f, "provider") || null, certificate_path: doc, session_id: sessionId, note: str(f, "note") || null,
          })),
        )
      : await supabase.from("health_exams").insert(
          ids.map((employee_id) => ({
            company_id: s.companyId, employee_id, type_id: typeId, exam_date: date, expires_on: exp,
            result: str(f, "result") || "UYGUN", restrictions: str(f, "restrictions") || null, doctor: str(f, "doctor") || null,
            institution: str(f, "institution") || null, report_path: doc, note: str(f, "note") || null,
          })),
        );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/isg");
  revalidatePath("/saglik");
  return { ok: true, message: `${ids.length} personele kaydedildi${exp ? `; geçerlilik ${exp.split("-").reverse().join(".")} tarihine kadar` : ""}.` };
}

export async function deleteComplianceRecord(f: FormData) {
  const s = await getSession();
  if (!canSafety(s.role)) return;
  const supabase = await createClient();
  await must(supabase.from(str(f, "category") === "HEALTH" ? "health_exams" : "training_records").delete().eq("id", str(f, "id")));
  revalidatePath("/isg");
  revalidatePath("/saglik");
  if (str(f, "employeeId")) revalidatePath(`/personel/${str(f, "employeeId")}`);
}

export async function addPpe(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (!canSafety(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const ids = f.getAll("employeeId").map(String).filter(Boolean);
  const item = str(f, "item");
  const date = str(f, "issued_on");
  if (!ids.length || !item || !date) return { ok: false, message: "Personel, malzeme ve tarih zorunlu." };
  const supabase = await createClient();
  const { error } = await supabase.from("ppe_issues").insert(
    ids.map((employee_id) => ({
      company_id: s.companyId, employee_id, item, size: str(f, "size") || null, quantity: Number(str(f, "quantity") || 1),
      issued_on: date, renew_months: str(f, "renew_months") ? Number(str(f, "renew_months")) : null, note: str(f, "note") || null,
    })),
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/isg");
  return { ok: true, message: `${ids.length} kişiye zimmetlendi.` };
}

export async function returnPpe(f: FormData) {
  const s = await getSession();
  if (!canSafety(s.role)) return;
  const supabase = await createClient();
  await supabase.from("ppe_issues").update({ returned_on: new Date().toISOString().slice(0, 10) }).eq("id", str(f, "id"));
  revalidatePath("/isg");
}

export async function addIncident(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (!canSafety(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const kind = str(f, "kind");
  const at = str(f, "occurred_at");
  if (!["KAZA", "RAMAK_KALA", "MESLEK_HASTALIGI"].includes(kind) || !at || !str(f, "description")) return { ok: false, message: "Tür, tarih ve açıklama zorunlu." };
  const supabase = await createClient();
  const { error } = await supabase.from("safety_incidents").insert({
    company_id: s.companyId, employee_id: str(f, "employeeId") || null, kind, occurred_at: at.length === 16 ? `${at}:00+03:00` : at,
    location: str(f, "location") || null, description: str(f, "description"), injury: str(f, "injury") || null,
    lost_days: str(f, "lost_days") ? Number(str(f, "lost_days")) : null, sgk_notified_on: str(f, "sgk_notified_on") || null,
    actions_taken: str(f, "actions_taken") || null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/isg");
  return { ok: true, message: kind === "KAZA" ? "Kaza kaydedildi. SGK'ya 3 iş günü içinde bildirim yapılmalıdır." : "Kaydedildi." };
}

export async function closeIncident(f: FormData) {
  const s = await getSession();
  if (!canSafety(s.role)) return;
  const supabase = await createClient();
  await supabase.from("safety_incidents").update({ status: "closed", sgk_notified_on: str(f, "sgk_notified_on") || undefined }).eq("id", str(f, "id"));
  revalidatePath("/isg");
}

/** İstirahat raporu: onaylı "Sağlık raporu" izni + belge */
export async function addSickReport(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant"].includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = str(f, "employeeId");
  const start = str(f, "start");
  const end = str(f, "end") || start;
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || end < start) return { ok: false, message: "Personel ve tarihler zorunlu." };
  const supabase = await createClient();
  const { data: type } = await supabase.from("leave_types").select("id").eq("code", "RAPOR").is("company_id", null).single();
  const { data: overlap } = await supabase.from("leave_requests").select("id").eq("employee_id", employeeId).in("status", ["pending", "approved"]).lte("start_date", end).gte("end_date", start).limit(1);
  if (overlap?.length) return { ok: false, message: "Bu tarihlerde personelin başka bir izni / raporu var." };
  let doc: string | null = null;
  try {
    doc = await uploadFile(supabase, s.companyId, `employees/${employeeId}/rapor`, f.get("file"));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  const note = [str(f, "institution"), str(f, "diagnosis_note")].filter(Boolean).join(" · ") || null;
  const { error } = await supabase.from("leave_requests").insert({
    company_id: s.companyId, employee_id: employeeId, leave_type_id: type!.id, start_date: start, end_date: end, days,
    status: "approved", decided_by: s.userId, decided_at: new Date().toISOString(), note, document_path: doc,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/saglik");
  revalidatePath("/izin");
  revalidatePath("/puantaj");
  return { ok: true, message: `${days} günlük rapor izin ve puantaja işlendi.` };
}
