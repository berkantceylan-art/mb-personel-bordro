"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { syncAttMonth } from "@/lib/att-control";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const CAN = ["owner", "hr", "accountant", "branch_manager"];

function errText(m: string) {
  if (/att_|schema cache|does not exist/.test(m) && /function|relation|column|schema/.test(m)) return "Supabase'de mbdental-puantaj-kontrol.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu personeli düzeltme yetkiniz yok (bölüm şefi yalnız kendi ekibini düzeltir).";
  if (/period_closed/.test(m)) return "Bu ayın puantajı kapatıldı; değişiklik için önce ayı açın.";
  if (/reason_required/.test(m)) return "Sebep yazın.";
  if (/open_days:(\d+)/.test(m)) return `Ay kapatılamaz: ${m.match(/open_days:(\d+)/)![1]} hatalı gün hâlâ açık. Önce kontrol merkezinde düzeltin ya da kabul edin.`;
  if (/leave_exists/.test(m)) return "Bu gün için zaten izin kaydı var.";
  if (/overtime_exists/.test(m)) return "Bu günün fazla mesaisi zaten onaylanmış.";
  if (/no_overtime/.test(m)) return "Bu günde işlenecek fazla mesai yok.";
  return m;
}

function refresh() {
  for (const p of ["/puantaj/kontrol", "/puantaj", "/fazla-mesai", "/izin", "/talepler", "/bordro/sihirbaz", "/ay-sonu", "/benim/puantaj"]) revalidatePath(p);
}

type Day = { employee_id: string; work_date: string; shift_start: string | null; shift_end: string | null; first_in: string | null; last_out: string | null; issues: string[]; overtime_min: number; overtime_rate: number };
const nextDay = (start: string | null, end: string | null) => !!start && !!end && end.slice(0, 5) <= start.slice(0, 5);

/** Tek bir günü düzelt; dönen: kullanıcıya gösterilecek kısa sonuç */
async function applyFix(sb: Awaited<ReturnType<typeof createClient>>, d: Day, action: string, f: FormData | null, reason: string): Promise<string> {
  const tin = f ? str(f, "time_in") : "";
  const tout = f ? str(f, "time_out") : "";
  const sIn = (TIME.test(tin) ? tin : d.shift_start?.slice(0, 5)) ?? "";
  const sOut = (TIME.test(tout) ? tout : d.shift_end?.slice(0, 5)) ?? "";
  const nd = nextDay(d.shift_start, d.shift_end) && !TIME.test(tout);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(errText(error.message));
    return data as unknown;
  };

  if (action === "forgot_card" || action === "shift_fill") {
    const items: { direction: "IN" | "OUT"; time: string; next_day?: boolean }[] = [];
    const needIn = d.issues.includes("MISSING_IN") || (action === "shift_fill" && !d.first_in);
    const needOut = d.issues.includes("MISSING_OUT") || (action === "shift_fill" && !d.last_out);
    if (needIn) { if (!sIn) throw new Error("Vardiyası olmayan günde giriş saatini yazın."); items.push({ direction: "IN", time: sIn }); }
    if (needOut) { if (!sOut) throw new Error("Vardiyası olmayan günde çıkış saatini yazın."); items.push({ direction: "OUT", time: sOut, next_day: nd }); }
    if (!items.length) throw new Error(action === "forgot_card" ? "Bu günde eksik okutma yok; “Kart unuttu” yalnız eksik giriş / çıkışta kullanılır." : "Bu günde eksik okutma yok.");
    if (action === "forgot_card") {
      const r = await rpc("att_forgot_card", { p_employee: d.employee_id, p_date: d.work_date, p_items: items, p_reason: reason });
      return r === "pending" ? "Aylık kart unuttu hakkı dolduğu için onaya gönderildi." : r === "applied_over" ? "İşlendi (aylık hak aşıldı, raporda görünür)." : "Kart unuttu işlendi.";
    }
    await rpc("att_shift_fill", { p_employee: d.employee_id, p_date: d.work_date, p_items: items, p_reason: reason });
    return "Vardiya saatlerine göre işlendi.";
  }
  if (action === "overtime") {
    const h = f ? Number(str(f, "ot_hours").replace(",", ".")) : NaN;
    const minutes = h > 0 ? Math.round(h * 60) : d.overtime_min;
    await rpc("att_overtime", { p_employee: d.employee_id, p_date: d.work_date, p_minutes: minutes, p_rate: d.overtime_rate || 1.5, p_reason: reason });
    return "Fazla mesai onaya gönderildi.";
  }
  if (action === "leave") {
    const t = f ? str(f, "leave_type") : "";
    if (!UUID.test(t)) throw new Error("İzin türünü seçin.");
    const r = await rpc("att_leave", { p_employee: d.employee_id, p_date: d.work_date, p_type: t, p_reason: reason });
    return r === "pending" ? "İzin kaydı onaya gönderildi." : "İzinli olarak işlendi.";
  }
  if (action === "shift_change") {
    const sid = f ? str(f, "shift_id") : "";
    await rpc("att_shift_change", { p_employee: d.employee_id, p_date: d.work_date, p_shift: sid === "off" || !sid ? null : sid, p_reason: reason });
    return sid === "off" || !sid ? "Hafta tatili yapıldı." : "Vardiya değiştirildi.";
  }
  if (action === "absent" || action === "accept") {
    await rpc("att_log", { p_employee: d.employee_id, p_date: d.work_date, p_action: action, p_detail: {}, p_reason: reason, p_status: "applied", p_over_limit: false, p_mark: "accepted" });
    return action === "absent" ? "Devamsız olarak onaylandı (eksik gün puantaja yansır)." : "Olduğu gibi kabul edildi.";
  }
  if (action === "reopen") {
    await rpc("att_log", { p_employee: d.employee_id, p_date: d.work_date, p_action: "reopen", p_detail: {}, p_reason: reason, p_status: "applied", p_over_limit: false, p_mark: "reopen" });
    return "Gün yeniden açıldı.";
  }
  throw new Error("Geçersiz işlem.");
}

async function loadDay(sb: Awaited<ReturnType<typeof createClient>>, emp: string, date: string): Promise<Day> {
  const { data, error } = await sb.from("att_days").select("employee_id, work_date, shift_start, shift_end, first_in, last_out, issues, overtime_min, overtime_rate").eq("employee_id", emp).eq("work_date", date).maybeSingle();
  if (error) throw new Error(errText(error.message));
  if (!data) throw new Error("Gün kaydı bulunamadı; önce yeniden hesaplayın.");
  return data as Day;
}

/** Tek gün düzeltme (satırdaki düğmeler) */
export async function fixAttDay(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const emp = str(f, "employee_id");
  const date = str(f, "date");
  const action = str(f, "action");
  const reason = str(f, "reason");
  if (!UUID.test(emp) || !DATE.test(date)) await fail("Geçersiz gün.");
  if (["forgot_card", "shift_fill", "absent", "leave", "shift_change"].includes(action) && !reason) await fail("Sebep yazın (ör. “kartını evde unuttu”, “raporlu”).");
  const sb = await createClient();
  let msg = "";
  try {
    msg = await applyFix(sb, await loadDay(sb, emp, date), action, f, reason || (action === "accept" ? "Kontrol edildi, uygun" : action === "overtime" ? "Fazla mesai" : ""));
    await syncAttMonth(sb, s.companyId, date.slice(0, 7), emp);
  } catch (e) {
    await fail(errText((e as Error).message));
  }
  refresh();
  await done(msg);
}

/** Toplu düzeltme: seçili günlere aynı işlem */
export async function bulkFixAtt(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const action = str(f, "action");
  const reason = str(f, "reason");
  const sel = f.getAll("sel").map(String).filter((x) => /^[0-9a-f-]{36}\|\d{4}-\d{2}-\d{2}$/i.test(x)).slice(0, 300);
  if (!sel.length) await fail("Önce listeden gün seçin.");
  if (!["accept", "absent", "shift_fill", "forgot_card", "overtime"].includes(action)) await fail("Toplu işlem seçin.");
  if (action !== "accept" && action !== "overtime" && !reason) await fail("Toplu işlem için sebep yazın.");
  const sb = await createClient();
  let ok = 0;
  const errs = new Map<string, number>();
  const touched = new Set<string>();
  for (const x of sel) {
    const [emp, date] = x.split("|") as [string, string];
    try {
      await applyFix(sb, await loadDay(sb, emp, date), action, null, reason || (action === "accept" ? "Toplu kontrol, uygun" : "Fazla mesai"));
      ok++;
      touched.add(`${emp}|${date.slice(0, 7)}`);
    } catch (e) {
      const m = errText((e as Error).message);
      errs.set(m, (errs.get(m) ?? 0) + 1);
    }
  }
  try {
    for (const t of touched) { const [emp, p] = t.split("|") as [string, string]; await syncAttMonth(sb, s.companyId, p, emp); }
  } catch { /* gece yeniden hesaplanır */ }
  refresh();
  const errTxt = [...errs.entries()].map(([m, n]) => `${n} gün: ${m}`).join(" · ");
  if (!ok) await fail(errTxt || "Hiçbir gün düzeltilemedi.");
  await done(`${ok} gün düzeltildi.${errTxt ? ` Düzeltilemeyen: ${errTxt}` : ""}`);
}

/** Ayı yeniden hesapla */
export async function resyncAtt(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const p = str(f, "period");
  if (!/^\d{4}-\d{2}$/.test(p)) await fail("Dönem seçin.");
  let n = 0;
  try { n = await syncAttMonth(await createClient(), s.companyId, p); } catch (e) { await fail(errText((e as Error).message)); }
  refresh();
  await done(`${n} personel-gün yeniden hesaplandı.`);
}

export async function closeAttMonth(f: FormData) {
  const p = str(f, "period");
  const sb = await createClient();
  const s = await getSession();
  try { await syncAttMonth(sb, s.companyId, p); } catch { /* kapanış yine denenir */ }
  const { error } = await sb.rpc("att_month_close", { p_period: p });
  if (error) await fail(errText(error.message));
  refresh();
  await done(`${p} puantajı kapatıldı. Bu ayın elle okutma, izin, fazla mesai ve vardiya kayıtları artık değiştirilemez.`);
}

export async function reopenAttMonth(f: FormData) {
  const { error } = await (await createClient()).rpc("att_month_reopen", { p_period: str(f, "period") });
  if (error) await fail(errText(error.message));
  refresh();
  await done("Ay yeniden açıldı.");
}

export async function saveAttSettings(f: FormData) {
  const n = Number(str(f, "forgot_free"));
  const { error } = await (await createClient()).rpc("att_settings_save", { p_forgot_free: Number.isFinite(n) ? n : 2 });
  if (error) await fail(errText(error.message));
  refresh();
  await done("Ayar kaydedildi.");
}
