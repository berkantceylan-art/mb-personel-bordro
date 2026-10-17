/**
 * Okutma bekçisi: bugünkü vardiyaya göre eksik okutmaları bulur (uyarı bildirimi ve uygulama kilidi için).
 *  NO_IN       vardiya başladı (+20 dk), giriş okutması yok
 *  NO_OUT_END  vardiya bitti (+15 dk), son okutma giriş (çıkış yok)
 *  LUNCH       vardiya içinde çıkış okutup 75 dk'dır dönüş okutmadı (öğle arası / dışarı çıkış)
 *  HOURLY_OUT  saatlik izin başladı, çıkış okutması yok
 *  HOURLY_IN   saatlik izin bitti, dönüş girişi yok
 * Saatler İstanbul duvar saatiyle (attendance_punches.punched_at da öyle saklanır).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export type WatchKind = "NO_IN" | "NO_OUT_END" | "LUNCH" | "HOURLY_OUT" | "HOURLY_IN";
export type WatchItem = { employeeId: string; userId: string | null; kind: WatchKind; date: string; direction: "IN" | "OUT"; suggest: string; title: string; body: string };

const hmToMin = (t: string) => { const [h, m] = t.slice(0, 5).split(":").map(Number) as [number, number]; return h * 60 + m; };
const minToHm = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const isoDow = (d: string) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w === 0 ? 7 : w; };
const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Şu an İstanbul: "YYYY-MM-DDTHH:MM" */
export const istanbulNow = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16);

type Shift = { id: string; start_time: string; end_time: string; crosses_midnight: boolean; weekdays: number[]; break_minutes: number };

export async function punchWatch(sb: SB, now: string = istanbulNow(), only?: string[]): Promise<WatchItem[]> {
  const today = now.slice(0, 10);
  const yest = addDay(today, -1);
  const nowMin = hmToMin(now.slice(11, 16));
  let eq = sb.from("employees").select("id, user_id, first_name, default_shift_id, termination_date, hire_date").lte("hire_date", today).or(`termination_date.is.null,termination_date.gte.${today}`);
  if (only?.length) eq = eq.in("id", only);
  const { data: emps } = await eq;
  const list = (emps ?? []) as { id: string; user_id: string | null; first_name: string; default_shift_id: string | null }[];
  if (!list.length) return [];
  const ids = list.map((e) => e.id);
  const [{ data: shifts }, { data: asg }, { data: hol }, { data: leaves }, { data: punches }] = await Promise.all([
    sb.from("shifts").select("id, start_time, end_time, crosses_midnight, weekdays, break_minutes"),
    sb.from("shift_assignments").select("employee_id, work_date, shift_id, day_type").in("employee_id", ids).in("work_date", [yest, today]),
    sb.from("public_holidays").select("date, half_day").in("date", [yest, today]),
    sb.from("leave_requests").select("employee_id, start_date, end_date, hours, start_time, end_time").eq("status", "approved").lte("start_date", today).gte("end_date", yest).in("employee_id", ids),
    sb.from("attendance_punches").select("employee_id, direction, punched_at").in("employee_id", ids).gte("punched_at", `${yest}T00:00:00`).lte("punched_at", `${today}T23:59:59`).order("punched_at"),
  ]);
  const sm = new Map(((shifts ?? []) as Shift[]).map((s) => [s.id, s]));
  const amap = new Map(((asg ?? []) as { employee_id: string; work_date: string; shift_id: string | null; day_type: string | null }[]).map((a) => [`${a.employee_id}|${a.work_date}`, a]));
  const holFull = new Set(((hol ?? []) as { date: string; half_day: boolean }[]).filter((h) => !h.half_day).map((h) => h.date));
  const pmap = new Map<string, { dir: "IN" | "OUT"; at: string }[]>();
  for (const p of (punches ?? []) as { employee_id: string; direction: "IN" | "OUT"; punched_at: string }[]) {
    const l = pmap.get(p.employee_id) ?? [];
    l.push({ dir: p.direction, at: p.punched_at.slice(0, 16).replace(" ", "T") });
    pmap.set(p.employee_id, l);
  }
  const lv = (leaves ?? []) as { employee_id: string; start_date: string; end_date: string; hours: number | null; start_time: string | null; end_time: string | null }[];

  const shiftOf = (e: { id: string; default_shift_id: string | null }, d: string): Shift | null => {
    if (holFull.has(d)) return null;
    if (lv.some((l) => l.employee_id === e.id && !l.hours && l.start_date <= d && l.end_date >= d)) return null;
    const a = amap.get(`${e.id}|${d}`);
    if (a) return a.day_type === "WORK" && a.shift_id ? sm.get(a.shift_id) ?? null : null;
    const s = e.default_shift_id ? sm.get(e.default_shift_id) : undefined;
    return s && s.weekdays.includes(isoDow(d)) ? s : null;
  };
  // "YYYY-MM-DDTHH:MM" → bugün 00:00'dan dakika (dün negatif)
  const rel = (at: string) => (at.slice(0, 10) === today ? 0 : at.slice(0, 10) === yest ? -1440 : 1440) + hmToMin(at.slice(11, 16));

  const out: WatchItem[] = [];
  for (const e of list) {
    const ps = (pmap.get(e.id) ?? []).map((p) => ({ ...p, m: rel(p.at) }));
    const push = (kind: WatchKind, date: string, direction: "IN" | "OUT", suggest: string, title: string, body: string) =>
      out.push({ employeeId: e.id, userId: e.user_id, kind, date, direction, suggest, title, body });
    const st = shiftOf(e, today);
    const hourly = lv.filter((l) => l.employee_id === e.id && l.hours && l.start_date === today && l.start_time && l.end_time);

    if (st) {
      const start = hmToMin(st.start_time);
      let end = hmToMin(st.end_time);
      const cross = st.crosses_midnight || end <= start;
      if (cross) end += 1440;
      const coveredStart = hourly.some((h) => hmToMin(h.start_time!) <= start + 30);
      // Giriş yok
      if (!coveredStart && nowMin >= start + 20 && nowMin <= start + 240 && !ps.some((p) => p.dir === "IN" && p.m >= start - 180 && p.m <= nowMin)) {
        push("NO_IN", today, "IN", minToHm(start), "İşe giriş okutmanız yok", `Vardiyanız ${minToHm(start)}'da başladı, giriş okutmanız görünmüyor. Geldiyseniz geliş saatinizi bildirin.`);
      }
      // Çıkış yok (gündüz vardiyası bugün bitiyor)
      if (!cross) {
        const inShift = ps.filter((p) => p.m >= start - 180 && p.m <= nowMin);
        const last = inShift[inShift.length - 1];
        if (last && last.dir === "IN" && nowMin >= end + 15 && nowMin <= end + 360) {
          push("NO_OUT_END", today, "OUT", minToHm(end), "Çıkış okutmadınız", `Vardiyanız ${minToHm(end)}'da bitti, çıkış okutmanız görünmüyor. Çıktıysanız çıkış saatinizi bildirin.`);
        }
        // Öğle arası / dışarı çıkış: vardiya içinde çıkıp dönmedi
        if (last && last.dir === "OUT" && last.m >= start + 60 && last.m <= end - 60 && nowMin >= last.m + 75 && nowMin < end
          && !hourly.some((h) => Math.abs(hmToMin(h.start_time!) - last.m) <= 45)) {
          push("LUNCH", today, "IN", minToHm(last.m + Math.max(30, st.break_minutes || 60)), "Dönüş okutmanız yok", `${minToHm(last.m)}'da çıkış okuttunuz, dönüş girişiniz görünmüyor. Döndüyseniz dönüş saatinizi bildirin.`);
        }
      }
    }
    // Dün başlayan gece vardiyası bugün bitti, çıkış yok
    const sy = shiftOf(e, yest);
    if (sy) {
      const start = hmToMin(sy.start_time) - 1440;
      const endRaw = hmToMin(sy.end_time);
      if (sy.crosses_midnight || endRaw <= hmToMin(sy.start_time)) {
        const inShift = ps.filter((p) => p.m >= start - 180 && p.m <= nowMin);
        const last = inShift[inShift.length - 1];
        if (last && last.dir === "IN" && nowMin >= endRaw + 15 && nowMin <= endRaw + 360) {
          push("NO_OUT_END", yest, "OUT", minToHm(endRaw), "Çıkış okutmadınız", `Gece vardiyanız ${minToHm(endRaw)}'da bitti, çıkış okutmanız görünmüyor. Çıkış saatinizi bildirin.`);
        }
      }
    }
    // Saatlik izin
    for (const h of hourly) {
      const ls = hmToMin(h.start_time!);
      const le = hmToMin(h.end_time!);
      if (nowMin >= ls + 15 && nowMin <= le + 60 && !ps.some((p) => p.dir === "OUT" && Math.abs(p.m - ls) <= 45)) {
        push("HOURLY_OUT", today, "OUT", minToHm(ls), "Saatlik izne çıkış okutmadınız", `${minToHm(ls)}–${minToHm(le)} saatlik izniniz var, çıkış okutmanız görünmüyor. Çıkış saatinizi bildirin.`);
      }
      const shiftEnd = st ? hmToMin(st.end_time) : 24 * 60;
      if (le < shiftEnd - 15 && nowMin >= le + 15 && nowMin <= le + 240 && !ps.some((p) => p.dir === "IN" && p.m >= le - 45 && p.m <= nowMin)) {
        push("HOURLY_IN", today, "IN", minToHm(le), "İzin dönüşü giriş okutmadınız", `Saatlik izniniz ${minToHm(le)}'da bitti, dönüş girişiniz görünmüyor. Döndüyseniz saatinizi bildirin.`);
      }
    }
  }
  return out;
}

export type GateItem = { date: string; direction: "IN" | "OUT"; suggest: string; reason: string; kind: string };

/** Personelin kapatması gereken eksik okutmalar: bugünkü uyarılar + son 7 günün açık eksik okutmaları (bildirim yapılmışlar hariç) */
export async function gateItems(sb: SB, employeeId: string, skipToday: Set<string> = new Set()): Promise<GateItem[]> {
  const now = istanbulNow();
  const today = now.slice(0, 10);
  const from = addDay(today, -7);
  const [watch, { data: days }, { data: reqs }] = await Promise.all([
    punchWatch(sb, now, [employeeId]).catch(() => [] as WatchItem[]),
    sb.from("att_days").select("work_date, issues, shift_start, shift_end").eq("employee_id", employeeId).eq("state", "open").gte("work_date", from).lt("work_date", today),
    sb.from("punch_requests").select("on_date, direction").eq("employee_id", employeeId).gte("on_date", from),
  ]);
  const asked = new Set(((reqs ?? []) as { on_date: string; direction: string }[]).map((r) => `${r.on_date}|${r.direction}`));
  const items: GateItem[] = [];
  const add = (it: GateItem) => {
    const k = `${it.date}|${it.direction}`;
    if (asked.has(k) || skipToday.has(k) || items.some((x) => `${x.date}|${x.direction}` === k)) return;
    items.push(it);
  };
  for (const w of watch) add({ date: w.date, direction: w.direction, suggest: w.suggest, reason: w.body, kind: w.kind });
  for (const d of (days ?? []) as { work_date: string; issues: string[]; shift_start: string | null; shift_end: string | null }[]) {
    if (d.issues.includes("MISSING_IN")) add({ date: d.work_date, direction: "IN", suggest: d.shift_start?.slice(0, 5) ?? "08:30", reason: "Bu gün giriş okutmanız eksik.", kind: "PAST" });
    if (d.issues.includes("MISSING_OUT")) add({ date: d.work_date, direction: "OUT", suggest: d.shift_end?.slice(0, 5) ?? "18:00", reason: "Bu gün çıkış okutmanız eksik.", kind: "PAST" });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
