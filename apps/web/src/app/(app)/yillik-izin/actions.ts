"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { leaveWorkdays, loadLeaveData, type Holidays } from "@/lib/annual-leave";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const HR = ["owner", "accountant", "hr"];
const APPROVERS = [...HR, "branch_manager"];
const missing = (m: string) => (/stage|travel_days|leave_service_gaps|collective|leave_max|leave_seniority|status|source/.test(m) ? "Supabase'de 20261118000000_annual_leave.sql çalıştırılmalı." : m);

async function ctx(roles = HR) {
  const s = await getSession();
  if (!roles.includes(s.role)) await fail("Bu işlem için yetkiniz yok.");
  return { s, supabase: await createClient() };
}
const refresh = () => { for (const p of ["/yillik-izin", "/izin", "/talepler", "/puantaj", "/benim/izin"]) revalidatePath(p); };
async function holidays(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Holidays> {
  const { data } = await supabase.from("public_holidays").select("date, half_day");
  return new Map((data ?? []).map((h) => [h.date as string, !!h.half_day]));
}

/* --------------------------------------------------------------- Onay */
export async function decideRequest(f: FormData) {
  const { s, supabase } = await ctx(APPROVERS);
  const status = str(f, "status") === "rejected" ? "rejected" : "approved";
  const patch: Record<string, unknown> = { status, decision_note: str(f, "note") || null };
  if (status === "approved") { patch.decided_by = s.userId; patch.decided_at = new Date().toISOString(); }
  else { patch.decided_by = s.userId; patch.decided_at = new Date().toISOString(); }
  if (str(f, "substitute")) patch.substitute_employee_id = str(f, "substitute");
  const { data, error } = await supabase.from("leave_requests").update(patch).eq("id", str(f, "id")).eq("status", "pending").select("status, stage");
  if (error) await fail(missing(error.message));
  if (!data?.length) await fail("Bu talep zaten sonuçlanmış.");
  refresh();
  const r = data![0]!;
  await done(status === "rejected" ? "Talep reddedildi; personele bildirildi." : r.status === "pending" ? "Şef onayı verildi; talep İK onayına gönderildi." : "İzin onaylandı; personele bildirildi.");
}

export async function decideBulk(f: FormData) {
  const { s, supabase } = await ctx(APPROVERS);
  const ids = f.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) await fail("Önce talep seçin.");
  const status = str(f, "status") === "rejected" ? "rejected" : "approved";
  const { data, error } = await supabase.from("leave_requests").update({ status, decided_by: s.userId, decided_at: new Date().toISOString() }).in("id", ids).eq("status", "pending").select("status");
  if (error) await fail(missing(error.message));
  refresh();
  const fwd = (data ?? []).filter((d) => d.status === "pending").length;
  await done(`${data?.length ?? 0} talep işlendi${fwd ? ` (${fwd} tanesi İK onayına gönderildi)` : ""}.`);
}

/** Onaylı izinden geri çağırma: izin, işbaşı gününden bir gün önce biter; kalan gün bakiyeye döner */
export async function recallLeave(f: FormData) {
  const { s, supabase } = await ctx(["owner", "hr"]);
  const back = str(f, "back_date");
  const { data: r } = await supabase.from("leave_requests").select("id, start_date, end_date, status, travel_days").eq("id", str(f, "id")).single();
  if (!r || r.status !== "approved") await fail("Yalnız onaylı izin geri çağrılabilir.");
  if (!isDate(back) || back <= r!.start_date || back > r!.end_date) await fail("İşbaşı tarihi iznin ikinci günü ile bitişi arasında olmalı. İzin hiç başlamadıysa iptal edin.");
  const end = new Date(Date.parse(back + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const days = leaveWorkdays(r!.start_date, end, await holidays(supabase));
  const { error } = await supabase.from("leave_requests").update({ end_date: end, days, recalled_at: new Date().toISOString(), recall_note: str(f, "note") || null, decided_by: s.userId }).eq("id", r!.id);
  if (error) await fail(missing(error.message));
  await supabase.from("leave_requests").delete().eq("parent_id", r!.id);
  refresh();
  await done(`İzin ${days} güne indirildi; personele bildirim gitti.`);
}

/* --------------------------------------------------------------- Ayarlar */
export async function saveDeptLimits(f: FormData) {
  const { supabase } = await ctx(["owner", "hr"]);
  const ids = f.getAll("dept").map(String);
  for (const id of ids) {
    const pct = Number(str(f, `pct_${id}`).replace(",", ".")) || null;
    const people = Number(str(f, `people_${id}`)) || null;
    if (pct !== null && (pct <= 0 || pct > 100)) await fail("Yüzde 1–100 arasında olmalı.");
    const { error } = await supabase.from("departments").update({ leave_max_pct: pct, leave_max_people: people }).eq("id", id);
    if (error) await fail(missing(error.message));
  }
  refresh();
  await done("Bölüm sınırları kaydedildi.");
}

export async function saveSeniority(f: FormData) {
  const { supabase } = await ctx();
  const d = str(f, "date");
  if (d && !isDate(d)) await fail("Geçerli tarih girin.");
  const { error } = await supabase.from("employees").update({ leave_seniority_start: d || null }).eq("id", str(f, "employee_id"));
  if (error) await fail(missing(error.message));
  refresh();
  await done(d ? "Kıdem başlangıcı kaydedildi; hak edişler yeniden hesaplandı." : "Kıdem başlangıcı işe giriş tarihine döndü.");
}

export async function addGap(f: FormData) {
  const { s, supabase } = await ctx();
  const a = str(f, "start"), b = str(f, "end");
  if (!isDate(a) || !isDate(b) || b < a || !str(f, "reason")) await fail("Tarih aralığı ve neden zorunlu.");
  const { error } = await supabase.from("leave_service_gaps").insert({ company_id: s.companyId, employee_id: str(f, "employee_id"), start_date: a, end_date: b, reason: str(f, "reason") });
  if (error) await fail(missing(error.message));
  refresh();
  await done("Kesinti kaydedildi; hak ediş tarihi ötelendi.");
}
export async function deleteGap(f: FormData) {
  const { supabase } = await ctx();
  await supabase.from("leave_service_gaps").delete().eq("id", str(f, "id"));
  refresh();
  await done("Kesinti silindi.");
}

export async function addAdjustment(f: FormData) {
  const { s, supabase } = await ctx();
  const days = Number(str(f, "days").replace(",", "."));
  if (!Number.isFinite(days) || days === 0) await fail("Gün sayısı girin (eksi değer de olabilir).");
  const { error } = await supabase.from("leave_adjustments").insert({ company_id: s.companyId, employee_id: str(f, "employee_id"), days, note: str(f, "note") || "Düzeltme" });
  if (error) await fail(error.message);
  refresh();
  await done("Düzeltme kaydedildi.");
}

/**
 * Açılış bakiyesi aktarımı. Her satır: kart no veya TC ; gün ; not
 * mod=kalan: girilen gün bugünkü kalan bakiye kabul edilir, fark düzeltme olarak yazılır. mod=ek: gün olduğu gibi eklenir.
 */
export async function importOpening(f: FormData) {
  const { s, supabase } = await ctx();
  const mode = str(f, "mode") === "ek" ? "ek" : "kalan";
  const lines = str(f, "rows").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) await fail("Satır girin.");
  const data = await loadLeaveData(supabase, todayIso());
  const { data: privs } = await supabase.from("employee_private").select("employee_id, national_id");
  const byTc = new Map((privs ?? []).filter((p) => p.national_id).map((p) => [String(p.national_id), p.employee_id as string]));
  const byCard = new Map(data.emps.filter((e) => e.card_no).map((e) => [String(e.card_no), e.id]));
  const rows: Array<{ company_id: string; employee_id: string; days: number; note: string }> = [];
  const bad: string[] = [];
  for (const l of lines) {
    const [key = "", d = "", note = ""] = l.split(/[;\t]/).map((x) => x.trim());
    const id = byTc.get(key) ?? byCard.get(key);
    const n = Number(d.replace(",", "."));
    if (!id || !Number.isFinite(n)) { bad.push(key || l.slice(0, 20)); continue; }
    const diff = mode === "kalan" ? Math.round((n - (data.ledgers.get(id)?.balance ?? 0)) * 10) / 10 : n;
    if (diff !== 0) rows.push({ company_id: s.companyId, employee_id: id, days: diff, note: note || (mode === "kalan" ? `Açılış bakiyesi (${n} gün kalan)` : "Devreden izin") });
  }
  if (rows.length) { const { error } = await supabase.from("leave_adjustments").insert(rows); if (error) await fail(error.message); }
  refresh();
  await done(`${rows.length} personelin bakiyesi güncellendi.${bad.length ? ` Eşleşmeyen: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? "…" : ""}` : ""}`);
}

/* --------------------------------------------------------------- Plan */
export async function addPlan(f: FormData) {
  const { s, supabase } = await ctx();
  const a = str(f, "start"), b = str(f, "end");
  if (!str(f, "employee_id") || !isDate(a) || !isDate(b) || b < a) await fail("Personel ve geçerli tarih aralığı seçin.");
  const days = leaveWorkdays(a, b, await holidays(supabase));
  const { error } = await supabase.from("leave_plans").insert({ company_id: s.companyId, employee_id: str(f, "employee_id"), year: Number(a.slice(0, 4)), start_date: a, end_date: b, days, note: str(f, "note") || null, status: "onayli", source: "hr" });
  if (error) await fail(missing(error.message));
  refresh();
  await done(`Plana eklendi (${days} iş günü).`);
}
export async function setPlanStatus(f: FormData) {
  const { supabase } = await ctx();
  const st = str(f, "status");
  if (!["onayli", "reddedildi"].includes(st)) await fail("Geçersiz durum.");
  const { error } = await supabase.from("leave_plans").update({ status: st }).eq("id", str(f, "id"));
  if (error) await fail(missing(error.message));
  refresh();
  await done(st === "onayli" ? "Tercih plana alındı." : "Tercih reddedildi.");
}
export async function deletePlanRow(f: FormData) {
  const { supabase } = await ctx();
  await supabase.from("leave_plans").delete().eq("id", str(f, "id"));
  refresh();
  await done("Plandan çıkarıldı.");
}
/** Onaylı planı izin kaydına dönüştürür (İK onaylı yıllık izin) */
export async function planToLeave(f: FormData) {
  const { s, supabase } = await ctx();
  const { data: p } = await supabase.from("leave_plans").select("id, employee_id, start_date, end_date, note").eq("id", str(f, "id")).single();
  if (!p) await fail("Plan bulunamadı.");
  const { data: t } = await supabase.from("leave_types").select("id").is("company_id", null).eq("code", "YILLIK").single();
  const { data: clash } = await supabase.from("leave_requests").select("id").eq("employee_id", p!.employee_id).in("status", ["pending", "approved"]).lte("start_date", p!.end_date).gte("end_date", p!.start_date).limit(1);
  if (clash?.length) await fail("Bu tarihlerde personelin başka izni var.");
  const days = leaveWorkdays(p!.start_date, p!.end_date, await holidays(supabase));
  const { error } = await supabase.from("leave_requests").insert({ company_id: s.companyId, employee_id: p!.employee_id, leave_type_id: t!.id, start_date: p!.start_date, end_date: p!.end_date, days, status: "approved", decided_by: s.userId, decided_at: new Date().toISOString(), note: p!.note ?? "Yıllık izin planından" });
  if (error) await fail(missing(error.message));
  await supabase.from("leave_plans").update({ status: "talebe-donustu" }).eq("id", p!.id);
  refresh();
  await done(`${days} günlük yıllık izin kaydı oluşturuldu.`);
}

/** Toplu izin: seçilen bölümlerdeki tüm aktif personele onaylı yıllık izin + duyuru */
export async function createCollective(f: FormData) {
  const { s, supabase } = await ctx(["owner", "hr"]);
  const a = str(f, "start"), b = str(f, "end"), title = str(f, "title") || "Toplu yıllık izin";
  if (!isDate(a) || !isDate(b) || b < a) await fail("Geçerli tarih aralığı girin.");
  const depts = f.getAll("dept").map(String).filter(Boolean);
  const hol = await holidays(supabase);
  const days = leaveWorkdays(a, b, hol);
  if (days <= 0) await fail("Seçilen aralıkta iş günü yok.");
  let q = supabase.from("employees").select("id").eq("status", "active");
  if (depts.length) q = q.in("department_id", depts);
  const [{ data: emps }, { data: t }, { data: busy }] = await Promise.all([
    q,
    supabase.from("leave_types").select("id").is("company_id", null).eq("code", "YILLIK").single(),
    supabase.from("leave_requests").select("employee_id").in("status", ["pending", "approved"]).lte("start_date", b).gte("end_date", a),
  ]);
  const skip = new Set((busy ?? []).map((x) => x.employee_id));
  const { data: col, error: ce } = await supabase.from("collective_leaves").insert({ company_id: s.companyId, title, start_date: a, end_date: b, department_ids: depts.length ? depts : null, note: str(f, "note") || null }).select("id").single();
  if (ce) await fail(missing(ce.message));
  const rows = (emps ?? []).filter((e) => !skip.has(e.id)).map((e) => ({ company_id: s.companyId, employee_id: e.id, leave_type_id: t!.id, start_date: a, end_date: b, days, status: "approved", decided_by: s.userId, decided_at: new Date().toISOString(), note: title, collective_id: col!.id }));
  if (rows.length) { const { error } = await supabase.from("leave_requests").insert(rows); if (error) await fail(missing(error.message)); }
  const fmt = (d: string) => d.split("-").reverse().join(".");
  await supabase.from("announcements").insert({
    company_id: s.companyId, title, audience: depts.length ? "DEPARTMENT" : "ALL", department_ids: depts, branch_ids: [], pinned: true, push: true, kind: "info", require_ack: true,
    body: `${fmt(a)} – ${fmt(b)} tarihleri arasında toplu yıllık izin uygulanacaktır (${days} iş günü). Bu süre yıllık izin bakiyenizden düşülür. İşbaşı tarihi: ${fmt(new Date(Date.parse(b + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10))}.${str(f, "note") ? `\n${str(f, "note")}` : ""}`,
  });
  refresh();
  revalidatePath("/duyurular");
  await done(`${rows.length} personele ${days} günlük toplu izin işlendi; duyuru yayınlandı.${skip.size ? ` ${skip.size} kişinin o tarihlerde zaten izni olduğu için atlandı.` : ""}`);
}
