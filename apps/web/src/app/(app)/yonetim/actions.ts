"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PERSONNEL_DOMAIN } from "@/lib/constants";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
type R = { ok: boolean; message: string };
const ROLES = ["owner", "accountant", "hr", "branch_manager", "safety", "employee"];

const code = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

async function requireAdmin() {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) throw new Error("Yetkiniz yok");
  return s;
}

/** Personel için giriş kimliği: e-posta varsa o, yoksa PDKS no@alan */
function loginFor(card: string | null, email: string | null, id: string) {
  if (email && /.+@.+\..+/.test(email)) return email.toLowerCase();
  return `${(card ?? id.slice(0, 8)).replace(/\D/g, "") || id.slice(0, 8)}@${PERSONNEL_DOMAIN}`;
}

export async function createInvite(_: R | null, f: FormData): Promise<R> {
  const s = await requireAdmin();
  const role = str(f, "role");
  if (!ROLES.includes(role)) return { ok: false, message: "Rol seçin." };
  if (role === "owner" && s.role !== "owner") return { ok: false, message: "Şirket sahibi davetini sadece sahip oluşturabilir." };
  const supabase = await createClient();
  const employeeId = str(f, "employeeId") || null;
  let login = str(f, "email").toLowerCase();
  let name = str(f, "display_name") || null;
  if (employeeId) {
    const [{ data: e }, { data: p }] = await Promise.all([
      supabase.from("employees").select("id, card_no, first_name, last_name").eq("id", employeeId).single(),
      supabase.from("employee_private").select("email").eq("employee_id", employeeId).maybeSingle(),
    ]);
    if (!e) return { ok: false, message: "Personel bulunamadı." };
    login = login || loginFor(e.card_no, p?.email ?? null, e.id);
    name = name ?? `${e.first_name} ${e.last_name}`;
  }
  if (!/.+@.+\..+/.test(login)) return { ok: false, message: "Personel seçin veya giriş e-postası yazın." };
  const c = code();
  const { error } = await supabase.from("invites").insert({ company_id: s.companyId, code: c, role, employee_id: employeeId, display_name: name, login_email: login });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/yonetim");
  return { ok: true, message: `Davet kodu: ${c} · giriş: ${login}` };
}

/** Hesabı olmayan tüm aktif personele davet kodu üretir */
export async function bulkInvites(_: R | null, f: FormData): Promise<R> {
  const s = await requireAdmin();
  const supabase = await createClient();
  const dept = str(f, "department_id");
  let q = supabase.from("employees").select("id, card_no, first_name, last_name").eq("status", "active").is("user_id", null);
  if (dept) q = q.eq("department_id", dept);
  const [{ data: emps }, { data: open }, { data: privs }] = await Promise.all([
    q,
    supabase.from("invites").select("employee_id").is("used_at", null).gt("expires_at", new Date().toISOString()),
    supabase.from("employee_private").select("employee_id, email"),
  ]);
  const has = new Set((open ?? []).map((i) => i.employee_id));
  const mail = new Map((privs ?? []).map((p) => [p.employee_id, p.email as string | null]));
  const rows = (emps ?? [])
    .filter((e) => !has.has(e.id))
    .map((e) => ({ company_id: s.companyId, code: code(), role: "employee", employee_id: e.id, display_name: `${e.first_name} ${e.last_name}`, login_email: loginFor(e.card_no, mail.get(e.id) ?? null, e.id) }));
  if (!rows.length) return { ok: true, message: "Yeni davet gereken personel yok." };
  const { error } = await supabase.from("invites").insert(rows);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/yonetim");
  return { ok: true, message: `${rows.length} personel için davet kodu oluşturuldu. "Davet listesini yazdır" ile dağıtabilirsiniz.` };
}

export async function deleteInvite(f: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("invites").delete().eq("id", str(f, "id"));
  revalidatePath("/yonetim");
}

export async function updateMember(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") throw new Error("Rolleri sadece şirket sahibi değiştirebilir");
  const userId = str(f, "userId");
  const role = str(f, "role");
  if (!ROLES.includes(role)) return;
  if (userId === s.userId && role !== "owner") throw new Error("Kendi sahiplik rolünüzü kaldıramazsınız");
  const supabase = await createClient();
  const branches = f.getAll("branch_id").map(String);
  const all = f.get("all_branches") === "on";
  await supabase.from("memberships").update({ role, all_branches: all, display_name: str(f, "display_name") || null }).eq("user_id", userId).eq("company_id", s.companyId);
  await supabase.from("membership_branches").delete().eq("user_id", userId).eq("company_id", s.companyId);
  if (!all && branches.length) await supabase.from("membership_branches").insert(branches.map((b) => ({ user_id: userId, company_id: s.companyId, branch_id: b })));
  revalidatePath("/yonetim");
}

export async function removeMember(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const userId = str(f, "userId");
  if (userId === s.userId) return;
  const supabase = await createClient();
  await supabase.from("employees").update({ user_id: null }).eq("user_id", userId);
  await supabase.from("memberships").delete().eq("user_id", userId).eq("company_id", s.companyId);
  revalidatePath("/yonetim");
}

export async function saveBranch(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (s.role !== "owner") return { ok: false, message: "Şubeleri sadece şirket sahibi düzenleyebilir." };
  const supabase = await createClient();
  const id = str(f, "id");
  const lat = str(f, "lat") ? Number(str(f, "lat").replace(",", ".")) : null;
  const lng = str(f, "lng") ? Number(str(f, "lng").replace(",", ".")) : null;
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) return { ok: false, message: "Konum geçersiz." };
  const row = {
    company_id: s.companyId,
    name: str(f, "name"),
    address: str(f, "address") || null,
    lat,
    lng,
    radius_m: Number(str(f, "radius_m") || 150),
    mobile_punch_enabled: f.get("mobile_punch_enabled") === "on",
  };
  if (!row.name) return { ok: false, message: "Şube adı zorunlu." };
  const { error } = id ? await supabase.from("branches").update(row).eq("id", id) : await supabase.from("branches").insert(row);
  if (error) return { ok: false, message: error.message };
  if (!id) {
    const { data: b } = await supabase.from("branches").select("id").eq("company_id", s.companyId).eq("name", row.name).single();
    if (b) await supabase.from("devices").insert([{ company_id: s.companyId, branch_id: b.id, code: "002", direction: "IN", name: "Giriş" }, { company_id: s.companyId, branch_id: b.id, code: "001", direction: "OUT", name: "Çıkış" }]);
  }
  revalidatePath("/yonetim");
  return { ok: true, message: "Şube kaydedildi." };
}

export async function saveDepartment(f: FormData) {
  await requireAdmin();
  const s = await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const name = str(f, "name");
  if (!name) return;
  if (id) await supabase.from("departments").update({ name }).eq("id", id);
  else await supabase.from("departments").insert({ company_id: s.companyId, name });
  revalidatePath("/yonetim");
}

export async function deleteDepartment(f: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const id = str(f, "id");
  const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("department_id", id);
  if ((count ?? 0) > 0) return;
  await supabase.from("departments").delete().eq("id", id);
  revalidatePath("/yonetim");
}

export async function saveDevice(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const supabase = await createClient();
  const id = str(f, "id");
  const row = { company_id: s.companyId, branch_id: str(f, "branch_id"), code: str(f, "code"), direction: str(f, "direction") === "OUT" ? "OUT" : "IN", name: str(f, "name") || null };
  if (!row.code || !row.branch_id) return;
  if (id) await supabase.from("devices").update(row).eq("id", id);
  else await supabase.from("devices").insert(row);
  revalidatePath("/yonetim");
}

export async function deleteDevice(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const supabase = await createClient();
  await supabase.from("devices").delete().eq("id", str(f, "id"));
  revalidatePath("/yonetim");
}
