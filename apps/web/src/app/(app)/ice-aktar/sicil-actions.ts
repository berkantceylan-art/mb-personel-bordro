"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";
import { parseSicilWorkbook, validTckn, type SicilRow } from "@/lib/sicil-import";

export interface SicilResult {
  ok?: boolean;
  preview?: boolean;
  message: string;
  details?: string[];
}

type Emp = { id: string; first_name: string; last_name: string; hire_date: string; position_title: string | null; department_id: string | null; sgk_occupation_code?: string | null; is_retired?: boolean; status: string };
type Priv = Record<string, unknown> & { employee_id: string };

const key = (f: string, l: string) => `${f}${l === "-" ? "" : l}`.toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
const PRIV_MAP: [keyof SicilRow, string][] = [
  ["nationalId", "national_id"], ["sgkNo", "sgk_no"], ["birthDate", "birth_date"], ["birthPlace", "birth_place"], ["gender", "gender"],
  ["fatherName", "father_name"], ["motherName", "mother_name"], ["address", "address"], ["phone", "phone"], ["city", "city"],
  ["district", "district"], ["bankName", "bank_name"], ["iban", "iban"], ["bloodType", "blood_type"],
];

/**
 * Personel sicil listesi aktarımı.
 * Eşleştirme: önce TC kimlik no, yoksa ad + soyad. Var olan bilgiler boş hücreyle SİLİNMEZ; yalnız dolu hücreler yazılır.
 * Ücret sütunu aktarılmaz (mevcut ücret sözleşmeleri korunur).
 */
export async function importSicil(_: SicilResult | null, fd: FormData): Promise<SicilResult> {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) return { message: "Bu işlem için yetkiniz yok." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Excel dosyası seçin." };
  const apply = fd.get("mode") === "apply";

  let rows: SicilRow[];
  try {
    ({ rows } = await parseSicilWorkbook(await file.arrayBuffer()));
  } catch (e) {
    return { message: `Dosya okunamadı: ${(e as Error).message}` };
  }
  if (rows.length === 0) return { message: "Dosyada personel satırı bulunamadı." };

  const supabase = await createClient();
  const { data: branch } = await supabase.from("branches").select("id").eq("company_id", s.companyId).order("created_at").limit(1).single();
  if (!branch) return { message: "Önce bir şube tanımlayın." };

  let empRes = await supabase.from("employees").select("id, first_name, last_name, hire_date, position_title, department_id, sgk_occupation_code, is_retired, status").eq("company_id", s.companyId);
  const hasSgkCol = !empRes.error;
  if (empRes.error) empRes = await supabase.from("employees").select("id, first_name, last_name, hire_date, position_title, department_id, status").eq("company_id", s.companyId) as typeof empRes;
  if (empRes.error) return { message: empRes.error.message };
  const emps = (empRes.data ?? []) as Emp[];
  const { data: privData, error: pErr } = await supabase.from("employee_private").select("*").eq("company_id", s.companyId);
  if (pErr) return { message: `Kişisel bilgiler okunamadı: ${pErr.message}` };
  const priv = new Map(((privData ?? []) as Priv[]).map((p) => [p.employee_id, p]));
  const byTc = new Map<string, string>();
  for (const p of priv.values()) if (p.national_id) byTc.set(String(p.national_id), p.employee_id);
  const byName = new Map(emps.map((e) => [key(e.first_name, e.last_name), e]));
  const byId = new Map(emps.map((e) => [e.id, e]));

  const deptNames = [...new Set(rows.map((r) => r.department).filter(Boolean))] as string[];
  if (apply && deptNames.length) {
    await supabase.from("departments").upsert(deptNames.map((name) => ({ company_id: s.companyId, name })), { onConflict: "company_id,name", ignoreDuplicates: true });
  }
  const { data: depts } = await supabase.from("departments").select("id, name").eq("company_id", s.companyId);
  const deptId = new Map((depts ?? []).map((d) => [String(d.name).toLocaleUpperCase("tr"), d.id as string]));

  const notes: string[] = [];
  const errors: string[] = [];
  const created: string[] = [];
  let updated = 0, unchanged = 0, fieldCount = 0, hireChanged = 0, terminated = 0;
  const seen = new Set<string>();

  for (const r of rows) {
    const label = `${r.firstName} ${r.lastName}`.trim();
    if (r.nationalId && !validTckn(r.nationalId)) {
      notes.push(`${label}: TC kimlik no geçersiz görünüyor (${r.nationalId.slice(0, 3)}…), aktarılmadı.`);
      r.nationalId = null;
    }
    let emp: Emp | undefined = r.nationalId && byTc.has(r.nationalId) ? byId.get(byTc.get(r.nationalId)!) : undefined;
    if (emp && key(emp.first_name, emp.last_name) !== key(r.firstName, r.lastName)) {
      notes.push(`${label}: TC no ile "${emp.first_name} ${emp.last_name}" kaydıyla eşleşti (isim farklı).`);
    }
    emp ??= byName.get(key(r.firstName, r.lastName));
    if (emp && seen.has(emp.id)) { notes.push(`${label}: dosyada iki kez geçiyor, ikinci satır atlandı.`); continue; }
    if (emp) seen.add(emp.id);
    const dId = r.department ? deptId.get(r.department.toLocaleUpperCase("tr")) ?? null : null;
    const title = r.title || r.occupationName;

    // Kişisel bilgiler: yalnız dolu ve farklı olanlar
    const cur = emp ? priv.get(emp.id) : undefined;
    const pPatch: Record<string, unknown> = {};
    for (const [from, to] of PRIV_MAP) {
      const v = r[from];
      if (v === null || v === undefined || v === "") continue;
      if (String(cur?.[to] ?? "") !== String(v)) pPatch[to] = v;
    }
    if (pPatch.national_id) {
      const other = byTc.get(String(pPatch.national_id));
      if (other && other !== emp?.id) { notes.push(`${label}: bu TC no başka bir personelde kayıtlı, TC aktarılmadı.`); delete pPatch.national_id; }
    }

    if (!emp) {
      created.push(label);
      if (!apply) continue;
      const ins: Record<string, unknown> = {
        company_id: s.companyId, branch_id: branch.id, department_id: dId, first_name: r.firstName, last_name: r.lastName || "-",
        position_title: title, hire_date: r.hireDate ?? todayIso(), is_retired: r.retired,
        ...(r.terminationDate ? { termination_date: r.terminationDate, termination_reason: r.terminationReason, status: "terminated" } : {}),
        ...(hasSgkCol && r.occupationCode ? { sgk_occupation_code: r.occupationCode } : {}),
      };
      const { data, error } = await supabase.from("employees").insert(ins).select("id").single();
      if (error || !data) { errors.push(`${label}: ${error?.message ?? "kaydedilemedi"}`); continue; }
      const { error: e2 } = await supabase.from("employee_private").upsert({ employee_id: data.id, company_id: s.companyId, ...pPatch, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
      if (e2) errors.push(`${label}: personel açıldı ama kişisel bilgiler yazılamadı (${e2.message})`);
      if (pPatch.national_id) byTc.set(String(pPatch.national_id), data.id as string);
      continue;
    }

    // Var olan personel
    const ePatch: Record<string, unknown> = {};
    if (r.hireDate && r.hireDate !== emp.hire_date) { ePatch.hire_date = r.hireDate; hireChanged++; notes.push(`${label}: işe giriş ${emp.hire_date} → ${r.hireDate}`); }
    if (title && !emp.position_title) ePatch.position_title = title;
    if (dId && !emp.department_id) ePatch.department_id = dId;
    if (hasSgkCol && r.occupationCode && r.occupationCode !== emp.sgk_occupation_code) ePatch.sgk_occupation_code = r.occupationCode;
    if (r.retired && emp.is_retired === false) ePatch.is_retired = true;
    if (r.terminationDate && emp.status === "active") {
      Object.assign(ePatch, { termination_date: r.terminationDate, termination_reason: r.terminationReason, status: "terminated" });
      terminated++;
      notes.push(`${label}: çıkış tarihi ${r.terminationDate}, pasife alınacak.`);
    }
    const n = Object.keys(ePatch).length + Object.keys(pPatch).length;
    if (n === 0) { unchanged++; continue; }
    updated++;
    fieldCount += n;
    if (!apply) continue;
    if (Object.keys(ePatch).length) {
      const { error } = await supabase.from("employees").update({ ...ePatch, updated_at: new Date().toISOString() }).eq("id", emp.id);
      if (error) errors.push(`${label}: ${error.message}`);
    }
    if (Object.keys(pPatch).length) {
      const { error } = await supabase.from("employee_private").upsert({ employee_id: emp.id, company_id: s.companyId, ...pPatch, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
      if (error) errors.push(`${label}: kişisel bilgiler yazılamadı (${error.message})`);
    }
  }

  const summary = `${rows.length} personel okundu · ${updated} kayıt güncellen${apply ? "di" : "ecek"} (${fieldCount} alan) · ${created.length} yeni personel ${apply ? "açıldı" : "açılacak"} · ${unchanged} kayıtta değişiklik yok${hireChanged ? ` · ${hireChanged} işe giriş tarihi düzelt${apply ? "ildi" : "ilecek"}` : ""}${terminated ? ` · ${terminated} çıkış` : ""}.`;
  const details = [
    ...errors,
    ...(created.length ? [`Yeni: ${created.join(", ")}${apply ? " — ücret sözleşmelerini personel profilinden girin." : ""}`] : []),
    ...notes,
  ];
  if (apply) {
    revalidatePath("/personel");
    revalidatePath("/");
    return { ok: errors.length === 0, message: summary, details };
  }
  return { preview: true, message: `Önizleme (henüz kaydedilmedi): ${summary}`, details };
}
