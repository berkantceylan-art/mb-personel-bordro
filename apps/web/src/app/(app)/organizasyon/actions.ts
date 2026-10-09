"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { done, fail } from "@/lib/flash";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("org_unit") || m.includes("job_titles") ? "Supabase'de 20261113000000_organization.sql çalıştırılmalı." : m);
async function admin() {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) await fail("Organizasyonu yalnız sahip ve İK düzenler.");
  return { s, supabase: await createClient() };
}

/** Mevcut şube ve bölümlerden ilk şemayı kurar */
export async function seedOrg() {
  const { s, supabase } = await admin();
  const { count } = await supabase.from("org_units").select("id", { count: "exact", head: true });
  if (count) await fail("Şema zaten var.");
  const [{ data: types }, { data: branches }, { data: depts }, { data: emps }] = await Promise.all([
    supabase.from("org_unit_types").select("id, name").is("company_id", null),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("employees").select("id, department_id, position_title").neq("status", "terminated"),
  ]);
  const t = (n: string) => (types ?? []).find((x) => x.name === n)?.id ?? null;
  const { data: root, error } = await supabase.from("org_units").insert({ company_id: s.companyId, name: s.companyName, type_id: t("Şirket"), sort: 0 }).select("id").single();
  if (error || !root) await fail(missing(error?.message ?? "Kurulamadı"));
  let parent = root!.id;
  if ((branches ?? []).length === 1) {
    const { data: b } = await supabase.from("org_units").insert({ company_id: s.companyId, parent_id: root!.id, name: branches![0]!.name, type_id: t("Şube"), branch_id: branches![0]!.id }).select("id").single();
    parent = b?.id ?? parent;
  }
  const map = new Map<string, string>();
  for (const [i, d] of (depts ?? []).entries()) {
    const { data: u } = await supabase.from("org_units").insert({ company_id: s.companyId, parent_id: parent, name: d.name, type_id: t("Bölüm"), department_id: d.id, sort: i }).select("id").single();
    if (u) map.set(d.id, u.id);
  }
  // Mevcut görev unvanlarından unvan listesi
  const titles = [...new Set((emps ?? []).map((e) => e.position_title).filter(Boolean) as string[])];
  if (titles.length) await supabase.from("job_titles").upsert(titles.map((n) => ({ company_id: s.companyId, name: n })), { onConflict: "company_id,name" });
  const { data: tl } = await supabase.from("job_titles").select("id, name");
  const tId = new Map((tl ?? []).map((x) => [x.name, x.id]));
  for (const e of emps ?? []) {
    const unit = e.department_id ? map.get(e.department_id) : null;
    const title = e.position_title ? tId.get(e.position_title) : null;
    if (unit || title) await supabase.from("employees").update({ org_unit_id: unit ?? null, title_id: title ?? null }).eq("id", e.id);
  }
  revalidatePath("/organizasyon");
  await done("Şema mevcut şube ve bölümlerden oluşturuldu. Grup, direktörlük gibi üst birimleri ekleyip yöneticileri atayın.");
}

export async function saveUnit(f: FormData) {
  const { s, supabase } = await admin();
  const id = str(f, "id");
  const row = {
    company_id: s.companyId, name: str(f, "name"), parent_id: str(f, "parent_id") || null, type_id: str(f, "type_id") || null, code: str(f, "code") || null,
    manager_employee_id: str(f, "manager") || null, department_id: str(f, "department_id") || null, branch_id: str(f, "branch_id") || null,
    headcount_target: str(f, "headcount_target") ? Math.max(0, Number(str(f, "headcount_target"))) : null, description: str(f, "description") || null,
  };
  if (!row.name) await fail("Birim adı zorunlu.");
  const { data, error } = id ? await supabase.from("org_units").update(row).eq("id", id).select("id").single() : await supabase.from("org_units").insert(row).select("id").single();
  if (error) await fail(missing(error.message.includes("alt birim") ? "Bir birim kendi alt birimine bağlanamaz." : error.message));
  revalidatePath("/organizasyon");
  redirect(`/organizasyon?birim=${data!.id}`);
}

export async function deleteUnit(f: FormData) {
  const { supabase } = await admin();
  const id = str(f, "id");
  const { data: u } = await supabase.from("org_units").select("parent_id").eq("id", id).maybeSingle();
  // Alt birimler ve personel bir üst birime taşınır
  await supabase.from("org_units").update({ parent_id: u?.parent_id ?? null }).eq("parent_id", id);
  await supabase.from("employees").update({ org_unit_id: u?.parent_id ?? null }).eq("org_unit_id", id);
  const { error } = await supabase.from("org_units").delete().eq("id", id);
  if (error) await fail(error.message);
  revalidatePath("/organizasyon");
  redirect("/organizasyon");
}

/** Birimdeki personelin unvanı ve bağlı olduğu yönetici (toplu) */
export async function saveMembers(f: FormData) {
  const { supabase } = await admin();
  const ids = f.getAll("emp").map(String);
  for (const id of ids) {
    const { error } = await supabase.from("employees").update({ org_unit_id: str(f, `unit_${id}`) || null, title_id: str(f, `title_${id}`) || null, manager_employee_id: str(f, `mgr_${id}`) || null }).eq("id", id);
    if (error) await fail(error.message.includes("astına") ? "Bir personel kendi astına bağlanamaz." : error.message);
  }
  const add = str(f, "add_employee");
  if (add) await supabase.from("employees").update({ org_unit_id: str(f, "unit_id") }).eq("id", add);
  revalidatePath("/organizasyon");
  await done("Personel atamaları kaydedildi.");
}

export async function saveTitle(f: FormData) {
  const { s, supabase } = await admin();
  const id = str(f, "id");
  const row = { company_id: s.companyId, name: str(f, "name"), grade: str(f, "grade") ? Number(str(f, "grade")) : null, is_manager: f.get("is_manager") === "on", description: str(f, "description") || null };
  if (!row.name) await fail("Unvan adı zorunlu.");
  const { error } = id ? await supabase.from("job_titles").update(row).eq("id", id) : await supabase.from("job_titles").insert(row);
  if (error) await fail(missing(error.message.includes("duplicate") ? "Bu unvan zaten var." : error.message));
  revalidatePath("/organizasyon");
  await done("Unvan kaydedildi.");
}

export async function deleteTitle(f: FormData) {
  const { supabase } = await admin();
  await supabase.from("job_titles").delete().eq("id", str(f, "id"));
  revalidatePath("/organizasyon");
}

export async function saveUnitType(f: FormData) {
  const { s, supabase } = await admin();
  if (!str(f, "name")) await fail("Tip adı zorunlu.");
  const { error } = await supabase.from("org_unit_types").insert({ company_id: s.companyId, name: str(f, "name"), level: Number(str(f, "level")) || 50, color: /^#[0-9a-f]{6}$/i.test(str(f, "color")) ? str(f, "color") : "#0A3D73" });
  if (error) await fail(missing(error.message));
  revalidatePath("/organizasyon");
  await done("Birim tipi eklendi.");
}
