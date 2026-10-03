"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const int = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number.parseInt(v, 10);
};

const PRIVATE_FIELDS = [
  "national_id", "sgk_no", "birth_date", "birth_place", "gender", "marital_status", "children_count", "father_name",
  "mother_name", "nationality", "blood_type", "phone", "phone2", "email", "address", "city", "district",
  "emergency_contact_name", "emergency_contact_relation", "emergency_contact_phone", "education_level", "school",
  "school_department", "graduation_year", "diploma_no", "license_class", "license_no", "license_date",
  "military_status", "bank_name", "iban", "iban_holder",
] as const;
const INT_FIELDS = new Set(["children_count", "graduation_year"]);

export interface EmployeeSaveResult {
  message: string;
}

export async function saveEmployee(_: EmployeeSaveResult | null, f: FormData): Promise<EmployeeSaveResult> {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) return { message: "Yetkiniz yok." };
  const supabase = await createClient();
  const id = str(f, "id");

  const firstName = str(f, "first_name");
  const lastName = str(f, "last_name");
  const hireDate = str(f, "hire_date");
  const branchId = str(f, "branch_id");
  if (!firstName || !lastName || !hireDate || !branchId) return { message: "Ad, soyad, şube ve işe giriş tarihi zorunludur." };

  let departmentId = str(f, "department_id");
  const newDept = str(f, "new_department");
  if (newDept) {
    const { data } = await supabase
      .from("departments")
      .upsert({ company_id: s.companyId, name: newDept }, { onConflict: "company_id,name" })
      .select("id")
      .single();
    departmentId = data?.id ?? departmentId;
  }

  const iban = str(f, "iban")?.replace(/\s/g, "").toUpperCase() ?? null;
  if (iban && !/^TR\d{24}$/.test(iban)) return { message: "IBAN TR ile başlayıp 26 karakter olmalı." };
  const tc = str(f, "national_id");
  if (tc && !/^\d{11}$/.test(tc)) return { message: "TC kimlik no 11 haneli olmalı." };

  const employee = {
    company_id: s.companyId,
    branch_id: branchId,
    department_id: departmentId,
    card_no: str(f, "card_no"),
    first_name: firstName,
    last_name: lastName,
    position_title: str(f, "position_title"),
    hire_date: hireDate,
    notes: str(f, "notes"),
    updated_at: new Date().toISOString(),
  };

  let employeeId = id;
  if (id) {
    const { error } = await supabase.from("employees").update(employee).eq("id", id);
    if (error) return { message: error.message.includes("card_no") ? "Bu PDKS numarası başka personelde kayıtlı." : error.message };
  } else {
    const { data, error } = await supabase.from("employees").insert(employee).select("id").single();
    if (error || !data) return { message: error?.message.includes("card_no") ? "Bu PDKS numarası başka personelde kayıtlı." : (error?.message ?? "Kaydedilemedi") };
    employeeId = data.id;

    const total = str(f, "total_net");
    if (total) {
      const insurance = str(f, "insurance_type") === "FIXED_NET" ? "FIXED_NET" : "MIN_WAGE";
      const fixed = str(f, "fixed_official_net");
      await supabase.from("pay_contracts").insert({
        company_id: s.companyId,
        employee_id: employeeId,
        valid_from: hireDate,
        total_net: parseTL(total),
        insurance_type: insurance,
        fixed_official_net: insurance === "FIXED_NET" && fixed ? parseTL(fixed) : null,
        bes_rate: f.get("bes") === "on" ? 0.03 : 0,
        change_reason: "İşe giriş",
      });
      if (f.get("bes") === "on") {
        await supabase.from("bes_enrollments").insert({ company_id: s.companyId, employee_id: employeeId, enrolled_on: hireDate, rate: 0.03 });
      }
    }
  }

  const priv: Record<string, unknown> = { employee_id: employeeId, company_id: s.companyId, updated_at: new Date().toISOString() };
  for (const k of PRIVATE_FIELDS) priv[k] = INT_FIELDS.has(k) ? int(f, k) : str(f, k);
  priv.iban = iban;
  const { error: pErr } = await supabase.from("employee_private").upsert(priv, { onConflict: "employee_id" });
  if (pErr) return { message: `Kişisel bilgiler kaydedilemedi: ${pErr.message}` };
  if (employee.card_no) await supabase.rpc("link_punches_to_employees", { p_company: s.companyId });

  revalidatePath("/personel");
  revalidatePath(`/personel/${employeeId}`);
  redirect(`/personel/${employeeId}`);
}

export async function terminateEmployee(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) throw new Error("Yetkiniz yok");
  const id = String(f.get("id"));
  const date = str(f, "termination_date");
  if (!date) throw new Error("Çıkış tarihi zorunlu");
  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({ termination_date: date, termination_reason: str(f, "termination_reason"), status: "terminated" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}`);
}

export async function reactivateEmployee(f: FormData) {
  const id = String(f.get("id"));
  const supabase = await createClient();
  await supabase.from("employees").update({ termination_date: null, termination_reason: null, status: "active" }).eq("id", id);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}`);
}

export async function deleteEmployee(_: EmployeeSaveResult | null, f: FormData): Promise<EmployeeSaveResult> {
  const s = await getSession();
  if (s.role !== "owner") return { message: "Personeli sadece şirket sahibi silebilir." };
  const id = String(f.get("id"));
  if (String(f.get("confirm") ?? "").trim().toLocaleUpperCase("tr") !== "SİL") return { message: "Onay için kutuya SİL yazın." };
  const supabase = await createClient();
  const { count } = await supabase.from("ledger_entries").select("id", { count: "exact", head: true }).eq("employee_id", id);
  if ((count ?? 0) > 0) {
    return { message: `Bu personelin ${count} cari hareketi var; kayıtların korunması için silinemez. "İşten çıkar" kullanın.` };
  }
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/personel");
  redirect("/personel");
}
