"use server";
import { revalidatePath } from "next/cache";
import { countLeaveDays } from "@mb/core";
import { done, fail } from "@/lib/flash";
import { addWorkdays } from "@/lib/labor";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const HR = ["owner", "accountant", "hr"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("disciplinary") || m.includes("condition_changes") || m.includes("compensatory") || m.includes("maternity") || m.includes("leave_plans") || m.includes("contract_type") || m.includes("disabled") ? "Supabase'de 20261117000000_labor_law.sql çalıştırılmalı." : m);
async function hr() {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  return { s, supabase: await createClient() };
}
async function holidays(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("public_holidays").select("date").gte("date", todayIso()).limit(100);
  return new Set((data ?? []).map((h) => h.date as string));
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const back = (_tab: string) => { revalidatePath("/is-hukuku"); revalidatePath("/benim/yazilar"); };

/* ------------------------------------------------------------ Disiplin */
export async function saveCase(f: FormData) {
  const { s, supabase } = await hr();
  if (!str(f, "employee_id") || !str(f, "description") || !str(f, "incident_at")) await fail("Personel, olay zamanı ve açıklama zorunlu.");
  const { error } = await supabase.from("disciplinary_cases").insert({
    company_id: s.companyId, employee_id: str(f, "employee_id"), incident_at: `${str(f, "incident_at")}:00+03:00`, learned_at: str(f, "learned_at") || todayIso(),
    category: str(f, "category") || "Diğer", description: str(f, "description"), witnesses: str(f, "witnesses") || null,
  });
  if (error) await fail(missing(error.message));
  back("disiplin");
  await done("Tutanak kaydedildi. Savunma istemeden karar vermeyin (md. 19).");
}

export async function requestDefense(f: FormData) {
  const { supabase } = await hr();
  const days = Math.max(1, Math.min(10, Number(str(f, "days")) || 2));
  const due = addWorkdays(todayIso(), days, await holidays(supabase));
  const { error } = await supabase.from("disciplinary_cases").update({ defense_requested_at: new Date().toISOString(), defense_due: due }).eq("id", str(f, "id"));
  if (error) await fail(error.message);
  back("disiplin");
  await done(`Savunma istendi; son gün ${due.split("-").reverse().join(".")}. Personel uygulamadan bildirim aldı; yazılı tebliğ için savunma istem yazısını yazdırıp imzalatın.`);
}

export async function recordDefense(f: FormData) {
  const { supabase } = await hr();
  const text = str(f, "defense_text");
  if (!text) await fail("Savunma metnini yazın (yazılı savunmadan aktarın) ya da 'savunma vermedi' notu düşün.");
  const { error } = await supabase.from("disciplinary_cases").update({ defense_text: text, defense_received_at: new Date().toISOString(), defense_channel: "yazili" }).eq("id", str(f, "id"));
  if (error) await fail(error.message);
  back("disiplin");
  await done("Savunma kaydedildi.");
}

export async function decideCase(f: FormData) {
  const { s, supabase } = await hr();
  const id = str(f, "id");
  const decision = str(f, "decision");
  const { data: c } = await supabase.from("disciplinary_cases").select("*").eq("id", id).maybeSingle();
  if (!c) await fail("Kayıt bulunamadı.");
  if (["ihtar", "ucret_kesme", "gecerli_fesih", "hakli_fesih"].includes(decision) && !c!.defense_requested_at) await fail("Önce savunma isteyin (md. 19: savunması alınmadan fesih yapılamaz).");
  let cut: number | null = null;
  let period: string | null = null;
  if (decision === "ucret_kesme") {
    cut = Number(str(f, "wage_cut_days").replace(",", "."));
    period = str(f, "wage_cut_period") || todayIso().slice(0, 7);
    if (!(cut > 0 && cut <= 2)) await fail("Ücret kesme cezası en çok 2 günlük ücret olabilir (md. 38).");
    const { data: others } = await supabase.from("disciplinary_cases").select("wage_cut_days").eq("employee_id", c!.employee_id).eq("decision", "ucret_kesme").eq("wage_cut_period", period).neq("id", id);
    const used = (others ?? []).reduce((a, x) => a + Number(x.wage_cut_days ?? 0), 0);
    if (used + cut > 2) await fail(`Bu ay için zaten ${used} günlük ücret kesildi; aylık toplam 2 günü geçemez (md. 38).`);
  }
  if (decision === "hakli_fesih" && f.get("override") !== "on") {
    const limit = addWorkdays(c!.learned_at, 6);
    if (todayIso() > limit) await fail(`Haklı fesih hakkı, öğrenmeden itibaren 6 iş günü içinde (son gün ${limit.split("-").reverse().join(".")}) kullanılmalıydı (md. 26). Avukat görüşü varsa "süreyi biliyorum" kutusunu işaretleyin.`);
  }
  const { error } = await supabase.from("disciplinary_cases").update({ decision, wage_cut_days: cut, wage_cut_period: period, decision_note: str(f, "decision_note") || null, decided_at: new Date().toISOString(), decided_by: s.userId }).eq("id", id);
  if (error) await fail(error.message);
  back("disiplin");
  await done(decision === "ucret_kesme" ? "Karar kaydedildi. Kesintiyi Ay sonu ekranında eksik gün / kesinti olarak işleyin ve gerekçesini personele yazılı bildirin." : decision.endsWith("fesih") ? "Karar kaydedildi. Fesih için İşten çıkış sihirbazını kullanın." : "Karar kaydedildi.");
}

/* ------------------------------------------------------------ Esaslı değişiklik */
export async function saveChange(f: FormData) {
  const { s, supabase } = await hr();
  if (!str(f, "employee_id") || !str(f, "description")) await fail("Personel ve değişiklik açıklaması zorunlu.");
  const due = addWorkdays(todayIso(), 6, await holidays(supabase));
  const { error } = await supabase.from("condition_changes").insert({ company_id: s.companyId, employee_id: str(f, "employee_id"), change_type: str(f, "change_type") || "Diğer", description: str(f, "description"), effective_date: str(f, "effective_date") || null, response_due: due });
  if (error) await fail(missing(error.message));
  back("degisiklik");
  await done(`Bildirim gönderildi; personelin yazılı kabul için son günü ${due.split("-").reverse().join(".")} (6 iş günü). Yanıt vermezse değişiklik onu bağlamaz.`);
}

/* ------------------------------------------------------------ Telafi */
export async function saveTelafi(f: FormData) {
  const { s, supabase } = await hr();
  const off = str(f, "off_date");
  const ids = f.getAll("employee_ids").map(String);
  const hours = Number(str(f, "hours").replace(",", "."));
  if (!off || !ids.length || !(hours > 0)) await fail("Çalışılmayan gün, saat ve en az bir personel seçin.");
  const deadline = new Date(Date.parse(off + "T12:00:00Z"));
  deadline.setUTCMonth(deadline.getUTCMonth() + 2);
  const { error } = await supabase.from("compensatory_work").insert({ company_id: s.companyId, reason: str(f, "reason") || "Diğer", off_date: off, hours, deadline: deadline.toISOString().slice(0, 10), employee_ids: ids, note: str(f, "note") || null });
  if (error) await fail(missing(error.message));
  back("telafi");
  await done("Telafi kaydı oluşturuldu; 2 ay içinde, günde en çok 3 saat telafi yapılabilir.");
}

export async function addTelafiEntry(f: FormData) {
  const { s, supabase } = await hr();
  const id = str(f, "work_id"); const date = str(f, "work_date");
  const hours = Number(str(f, "hours").replace(",", "."));
  const { data: w } = await supabase.from("compensatory_work").select("deadline, off_date").eq("id", id).maybeSingle();
  if (!w) await fail("Kayıt bulunamadı.");
  if (!(hours > 0 && hours <= 3)) await fail("Telafi çalışması günde en çok 3 saat olabilir (md. 64).");
  if (date > w!.deadline || date <= w!.off_date) await fail(`Telafi ${w!.off_date.split("-").reverse().join(".")} sonrası ve ${w!.deadline.split("-").reverse().join(".")} tarihine kadar yapılmalı.`);
  const { data: hol } = await supabase.from("public_holidays").select("date").eq("date", date).maybeSingle();
  if (hol || new Date(date + "T12:00:00Z").getUTCDay() === 0) await fail("Telafi çalışması tatil günlerinde yaptırılamaz (md. 64).");
  const { error } = await supabase.from("compensatory_entries").upsert({ company_id: s.companyId, work_id: id, work_date: date, hours }, { onConflict: "work_id,work_date" });
  if (error) await fail(error.message);
  back("telafi");
  await done("Telafi günü kaydedildi. Bu süre fazla mesai sayılmaz; puantajda o günü fazla mesai onayından çıkarın.");
}

/* ------------------------------------------------------------ Analık */
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
export async function saveMaternity(f: FormData) {
  const { s, supabase } = await hr();
  const expected = str(f, "expected_birth") || null; const birth = str(f, "birth_date") || null;
  if (!str(f, "employee_id") || (!expected && !birth)) await fail("Personel ve beklenen / gerçekleşen doğum tarihi zorunlu.");
  const multiple = f.get("multiple") === "on";
  const pre = (multiple ? 10 : 8) * 7;
  const start = expected ? addDays(expected, -pre) : null;
  const ref = birth ?? expected!;
  // Doğumdan sonra 16 hafta; doğum öncesi kullanılmayan süre doğum sonrasına eklenir
  let end = addDays(ref, 16 * 7);
  if (birth && expected && birth < expected) end = addDays(end, Math.round((Date.parse(expected) - Date.parse(birth)) / 86_400_000));
  const row = { company_id: s.companyId, employee_id: str(f, "employee_id"), expected_birth: expected, birth_date: birth, multiple, leave_start: start, leave_end: end, milk_until: birth ? addDays(birth, 365) : null, note: str(f, "note") || null };
  const id = str(f, "id");
  const { error } = id ? await supabase.from("maternity_records").update(row).eq("id", id) : await supabase.from("maternity_records").insert(row);
  if (error) await fail(missing(error.message));
  back("analik");
  await done("Analık tarihleri hesaplandı ve kaydedildi.");
}

/* ------------------------------------------------------------ İzin planı */
export async function savePlan(f: FormData) {
  const { s, supabase } = await hr();
  const start = str(f, "start_date"); const end = str(f, "end_date");
  if (!str(f, "employee_id") || !start || !end || end < start) await fail("Personel ve geçerli tarih aralığı seçin.");
  const { data: hol } = await supabase.from("public_holidays").select("date").gte("date", start).lte("date", end).eq("half_day", false);
  const days = Number(str(f, "days").replace(",", ".")) || Math.max(1, countLeaveDays(start, end, { holidays: new Set((hol ?? []).map((h) => h.date as string)) }));
  const { error } = await supabase.from("leave_plans").insert({ company_id: s.companyId, employee_id: str(f, "employee_id"), year: Number(start.slice(0, 4)), start_date: start, end_date: end, days, note: str(f, "note") || null });
  if (error) await fail(missing(error.message));
  const { data: parts } = await supabase.from("leave_plans").select("days").eq("employee_id", str(f, "employee_id")).eq("year", Number(start.slice(0, 4)));
  back("izin");
  await done(`İzin planına eklendi (${days} iş günü).${(parts ?? []).some((p) => Number(p.days) >= 10) ? "" : " Dikkat: yıllık izin bölünürse bölümlerden biri en az 10 gün olmalı (md. 56)."}`);
}
export async function deletePlan(f: FormData) {
  const { supabase } = await hr();
  await supabase.from("leave_plans").delete().eq("id", str(f, "id"));
  back("izin");
}

/* ------------------------------------------------------------ Sözleşme ve engelli */
export async function saveContract(f: FormData) {
  const { supabase } = await hr();
  const type = str(f, "contract_type");
  if (type === "belirli" && !str(f, "contract_end")) await fail("Belirli süreli sözleşmede bitiş tarihi zorunlu.");
  if (type === "belirli" && !str(f, "fixed_term_reason")) await fail("Belirli süreli sözleşme için objektif neden yazın (md. 11: belirli bir işin tamamlanması, mevsimlik iş vb.).");
  const { error } = await supabase.from("employees").update({
    contract_type: type, contract_end: str(f, "contract_end") || null, weekly_hours: str(f, "weekly_hours") ? Number(str(f, "weekly_hours").replace(",", ".")) : null,
    contract_renewals: Number(str(f, "contract_renewals")) || 0, fixed_term_reason: str(f, "fixed_term_reason") || null,
  }).eq("id", str(f, "employee_id"));
  if (error) await fail(missing(error.message));
  back("sozlesme");
  await done("Sözleşme bilgisi kaydedildi.");
}

export async function saveDisability(f: FormData) {
  const { s, supabase } = await hr();
  const deg = str(f, "disability_degree");
  const { error } = await supabase.from("employee_private").upsert({ employee_id: str(f, "employee_id"), company_id: s.companyId, disabled: f.get("disabled") === "on", disability_degree: deg ? Number(deg) : null, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
  if (error) await fail(missing(error.message));
  back("engelli");
  await done("Kaydedildi.");
}

export async function askOvertimeConsent() {
  const { supabase } = await hr();
  const { data, error } = await supabase.rpc("request_overtime_consent");
  if (error) await fail(missing(error.message.includes("request_overtime") ? "contract_type" : error.message));
  back("mesai");
  await done(`${data ?? 0} personele imza bildirimi gönderildi.`);
}
