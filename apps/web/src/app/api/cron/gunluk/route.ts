import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isoWeekday, periodBounds } from "@mb/core";
import { missed, tracked } from "@/lib/boss";
import { loadCompliance } from "@/lib/compliance";
import { openPeriod } from "@/lib/periods";
import { formatDate, periodLabel, todayIso } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";

export const runtime = "nodejs";
export const maxDuration = 60;

type SB = Parameters<typeof loadMonth>[0];
type Role = "owner" | "accountant" | "hr" | "branch_manager" | "safety" | "employee";

/**
 * Günlük zamanlanmış iş (Vercel Cron, her sabah ~07:15).
 * - Ayın ilk günlerinde dönem açılmamışsa açar ve hakedişleri yazar
 * - Dün eksik okutması olan personele ve İK'ya bildirim
 * - İSG eğitimi / sağlık muayenesi bitişine 30, 15, 7 gün kala ve bittiği gün bildirim
 * - Pazartesi: sahip ve muhasebeye haftalık özet
 * Her iş şirket ve gün başına bir kez çalışır (job_runs).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "ayarlı değil" }, { status: 501 });
  const admin = createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // ?tarih=YYYY-MM-DD yalnız deneme için (gizli anahtarla çağrıldığında)
  const forced = new URL(req.url).searchParams.get("tarih");
  const today = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? forced : todayIso();
  const { data: companies } = await admin.from("companies").select("id");
  const report: Record<string, unknown> = {};
  for (const c of companies ?? []) {
    const ctx = new JobContext(admin, c.id, today);
    const out: Record<string, unknown> = {};
    for (const [name, job] of Object.entries(JOBS)) {
      let claimed = false;
      try {
        claimed = await ctx.claim(name);
        out[name] = claimed ? await job(ctx) : "bugün çalıştı";
      } catch (e) {
        out[name] = { error: e instanceof Error ? e.message : String(e) };
      }
      if (claimed) await ctx.finish(name, out[name]);
    }
    report[c.id] = out;
  }
  return NextResponse.json({ ok: true, today, report });
}

class JobContext {
  private roleCache?: Array<{ user_id: string; role: Role }>;
  constructor(readonly sb: SupabaseClient, readonly companyId: string, readonly today: string) {}

  /** İşi bugün için sahiplenir; daha önce çalıştıysa false */
  async claim(job: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("job_runs")
      .upsert({ job, run_date: this.today, company_id: this.companyId }, { onConflict: "job,run_date,company_id", ignoreDuplicates: true })
      .select("job");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  async finish(job: string, result: unknown) {
    await this.sb.from("job_runs").update({ result: result as object }).eq("job", job).eq("run_date", this.today).eq("company_id", this.companyId);
  }

  async users(roles: Role[]): Promise<string[]> {
    if (!this.roleCache) {
      const { data } = await this.sb.from("memberships").select("user_id, role").eq("company_id", this.companyId);
      this.roleCache = (data ?? []) as Array<{ user_id: string; role: Role }>;
    }
    return [...new Set(this.roleCache.filter((m) => roles.includes(m.role)).map((m) => m.user_id))];
  }

  /** Bildirim yazar; telefon bildirimi veritabanı tetikleyicisiyle gider */
  async notify(userIds: string[], title: string, body: string, link: string): Promise<number> {
    const rows = [...new Set(userIds)].map((user_id) => ({ company_id: this.companyId, user_id, title, body: body.slice(0, 300), link }));
    if (!rows.length) return 0;
    const { error } = await this.sb.from("notifications").insert(rows);
    if (error) throw new Error(error.message);
    return rows.length;
  }
}

const prevPeriod = (p: string) => { const [y, m] = p.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const daysUntil = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const names = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} ve ${xs.length - max} kişi daha` : xs.join(", "));

const JOBS: Record<string, (ctx: JobContext) => Promise<unknown>> = {
  /** Ayın ilk 5 gününde dönem açılmamışsa açar */
  async donem(ctx) {
    const day = Number(ctx.today.slice(8, 10));
    if (day > 5) return "ay başı değil";
    const period = ctx.today.slice(0, 7);
    const { data: p } = await ctx.sb.from("payroll_periods").select("period").eq("company_id", ctx.companyId).eq("period", period).maybeSingle();
    if (p) return "zaten açık";
    const r = await openPeriod(ctx.sb, ctx.companyId, period);
    if (r.ok) await ctx.notify(await ctx.users(["owner", "accountant"]), `${periodLabel(period)} dönemi açıldı`, r.message, "/ay-sonu");
    return r;
  },

  /** Dün eksik okutma: personele kendi bildirimi, İK'ya özet */
  async okutma(ctx) {
    const y = addDays(ctx.today, -1);
    const m = await loadMonth(ctx.sb as unknown as SB, y.slice(0, 7));
    const missing = m.anomalies.filter((a) => (a.kind === "MISSING_IN" || a.kind === "MISSING_OUT") && a.at.slice(0, 10) === y);
    const absent = m.employees.filter((e) => m.cells.get(e.id)?.get(y)?.status === "ABSENT");
    if (!missing.length && !absent.length) return "eksik yok";
    const empIds = [...new Set(missing.map((a) => a.employeeId))];
    const { data: links } = empIds.length ? await ctx.sb.from("employees").select("id, user_id").in("id", empIds) : { data: [] };
    let sent = 0;
    for (const l of links ?? []) {
      if (!l.user_id) continue;
      const kinds = missing.filter((a) => a.employeeId === l.id).map((a) => (a.kind === "MISSING_IN" ? "giriş" : "çıkış")).sort();
      sent += await ctx.notify([l.user_id], "Eksik okutma", `${formatDate(y)} tarihinde ${[...new Set(kinds)].join(" ve ")} okutmanız görünmüyor. Yöneticinize bildirin.`, "/benim");
    }
    const name = new Map(m.employees.map((e) => [e.id, e.name]));
    const parts = [
      missing.length && `${empIds.length} kişide eksik okutma (${names(empIds.map((id) => name.get(id) ?? "?"))})`,
      absent.length && `${absent.length} kişi devamsız (${names(absent.map((e) => e.name))})`,
    ].filter(Boolean);
    sent += await ctx.notify(await ctx.users(["owner", "hr"]), `Dünün puantajı: ${formatDate(y)}`, parts.join(" · "), `/puantaj?donem=${y.slice(0, 7)}`);
    return { missing: empIds.length, absent: absent.length, sent };
  },

  /** İSG eğitimi ve sağlık muayenesi bitişine 30/15/7 gün kala ve bittiği gün */
  async uyum(ctx) {
    const marks = new Set([30, 15, 7, 0]);
    const result: Record<string, number> = {};
    for (const [cat, label, link, roles] of [
      ["TRAINING", "İSG eğitimi", "/isg", ["owner", "hr", "safety"]],
      ["HEALTH", "Sağlık muayenesi", "/saglik", ["owner", "hr", "safety"]],
    ] as const) {
      const d = await loadCompliance(ctx.sb as unknown as SB, cat);
      const due = d.alerts.filter((a) => a.daysLeft !== null && marks.has(a.daysLeft));
      result[cat] = due.length;
      if (!due.length) continue;
      const byDays = new Map<number, string[]>();
      for (const a of due) byDays.set(a.daysLeft!, [...(byDays.get(a.daysLeft!) ?? []), `${a.name} (${a.typeName})`]);
      const body = [...byDays.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([days, xs]) => `${days === 0 ? "Bugün bitiyor" : `${days} gün kaldı`}: ${names(xs, 4)}`)
        .join(" · ");
      await ctx.notify(await ctx.users([...roles]), `${label}: ${due.length} süre doluyor`, body, link);
    }
    return result;
  },

  /** Deneme süresi bitmeden 14, 7, 2 gün kala ve son gün karar hatırlatması */
  async deneme(ctx) {
    const { data } = await ctx.sb.from("employee_onboarding").select("employee_id, probation_end, employees!employee_onboarding_employee_id_fkey(first_name, last_name, status)").eq("company_id", ctx.companyId).is("probation_decision", null).gte("probation_end", ctx.today).lte("probation_end", addDays(ctx.today, 14));
    let sent = 0;
    for (const o of data ?? []) {
      const left = daysUntil(ctx.today, o.probation_end as string);
      const e = o.employees as unknown as { first_name: string; last_name: string; status: string } | null;
      if (![14, 7, 2, 0].includes(left) || !e || e.status === "terminated") continue;
      const { data: mgr } = await ctx.sb.rpc("managers_for_employee", { p_employee: o.employee_id });
      const users = [...new Set([...((mgr as string[] | null) ?? []), ...(await ctx.users(["owner", "hr"]))])];
      sent += await ctx.notify(users, left === 0 ? "Deneme süresi bugün bitiyor" : `Deneme süresi ${left} gün sonra bitiyor`, `${e.first_name} ${e.last_name} için değerlendirme ve karar (devam / sonlandır) bekleniyor.`, `/uyum/${o.employee_id}`);
    }
    return { sent };
  },

  /** Yarınki etkinlikler: katılacak / belki diyenlere hatırlatma */
  async etkinlik(ctx) {
    const from = `${addDays(ctx.today, 1)}T00:00:00+03:00`, to = `${addDays(ctx.today, 1)}T23:59:59+03:00`;
    const { data } = await ctx.sb.from("announcements").select("id, title, event_at, location").eq("company_id", ctx.companyId).eq("kind", "event").gte("event_at", from).lte("event_at", to);
    let sent = 0;
    for (const a of data ?? []) {
      const { data: r } = await ctx.sb.from("event_rsvps").select("user_id").eq("announcement_id", a.id).in("status", ["yes", "maybe"]);
      const saat = new Date(a.event_at as string).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
      sent += await ctx.notify((r ?? []).map((x) => x.user_id as string), `Yarın: ${a.title}`, `Saat ${saat}${a.location ? ` · ${a.location}` : ""}`, `/duyurular/${a.id}`);
    }
    return { sent };
  },

  /** KVKK: başvuruların 30 günlük süresi (7, 3, 0 gün kala ve gecikince) ve 6 aylık periyodik imha hatırlatması */
  async kvkk(ctx) {
    const out: string[] = [];
    const { data: reqs } = await ctx.sb.from("kvkk_requests").select("requester_name, due_on").eq("company_id", ctx.companyId).in("status", ["open", "in_progress"]);
    const due = (reqs ?? []).filter((r) => [7, 3, 0, -1, -7].includes(daysUntil(ctx.today, r.due_on as string)));
    if (due.length) {
      await ctx.notify(await ctx.users(["owner", "hr"]), "KVKK başvurusu süresi", due.map((r) => `${r.requester_name}: ${daysUntil(ctx.today, r.due_on as string) < 0 ? "süresi geçti" : `son gün ${formatDate(r.due_on as string)}`}`).join(" · "), "/kvkk?sekme=basvuru");
      out.push("basvuru");
    }
    if (["01-02", "07-02"].includes(ctx.today.slice(5))) {
      await ctx.notify(await ctx.users(["owner"]), "KVKK periyodik imha zamanı", "Saklama süresi dolan kayıtlar için 6 aylık periyodik imhayı çalıştırın; işlem tutanağa yazılır.", "/kvkk?sekme=imha");
      out.push("imha");
    }
    return out.length ? out : "yok";
  },

  /** KVKK: saklama süresi dolan aday başvurularını ve dosyalarını siler */
  async adayImha(ctx) {
    const { data } = await ctx.sb.from("candidates").select("id, cv_path, file_paths").eq("company_id", ctx.companyId).lt("purge_after", ctx.today).is("employee_id", null).limit(500);
    if (!data?.length) return "silinecek yok";
    const files = data.flatMap((c) => [c.cv_path, ...((c.file_paths as string[] | null) ?? [])]).filter(Boolean) as string[];
    if (files.length) await ctx.sb.storage.from("documents").remove(files);
    const { error } = await ctx.sb.from("candidates").delete().in("id", data.map((c) => c.id));
    if (error) throw new Error(error.message);
    return { silinen: data.length, dosya: files.length };
  },

  /** Patron: pazartesi haftalık özet, ayın 1'i ay özeti, SGK / muhtasar / maaş günü yaklaşınca uyarı */
  async patron(ctx) {
    const { data: ms } = await ctx.sb.from("memberships").select("user_id, role, is_boss").eq("company_id", ctx.companyId);
    const bosses = [...new Set((ms ?? []).filter((m) => m.is_boss || m.role === "owner").map((m) => m.user_id as string))];
    if (!bosses.length) return "patron yok";
    const out: string[] = [];
    const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " TL";
    const cur = ctx.today.slice(0, 7);
    const prev = prevPeriod(cur);
    const { data: company } = await ctx.sb.from("companies").select("*").eq("id", ctx.companyId).maybeSingle();
    const payDay = Number((company as { salary_pay_day?: number } | null)?.salary_pay_day ?? 5);
    const balance = async (p: string) => {
      const { data } = await ctx.sb.from("ledger_period_summary").select("balance, accrued").eq("company_id", ctx.companyId).eq("period", p);
      return { remain: (data ?? []).reduce((a, r) => a + Math.max(0, Number(r.balance ?? 0)), 0), accrued: (data ?? []).reduce((a, r) => a + Number(r.accrued ?? 0), 0), people: (data ?? []).filter((r) => Number(r.balance ?? 0) > 0).length };
    };

    // Ödeme günü yaklaşıyor: maaş (2 gün kala, o gün), SGK ve muhtasar (3 gün, 1 gün, o gün)
    const payDate = `${cur}-${String(payDay).padStart(2, "0")}`;
    const toPay = daysUntil(ctx.today, payDate);
    if (toPay === 2 || toPay === 0) {
      const b = await balance(prev);
      if (b.remain > 0) { await ctx.notify(bosses, toPay === 0 ? "Bugün maaş günü" : "Maaş günü 2 gün sonra", `${periodLabel(prev)} için ${b.people} kişiye toplam ${tl(b.remain)} ödeme kaldı (banka + elden).`, "/patron?sekme=para#takvim"); out.push("maaş"); }
    }
    const { data: sgk } = await ctx.sb.from("sgk_payments").select("*").eq("company_id", ctx.companyId).eq("period", prev).maybeSingle();
    const due = (sgk as { due_on?: string | null } | null)?.due_on ?? `${cur}-26`;
    const toDue = daysUntil(ctx.today, due);
    if ([3, 1, 0].includes(toDue)) {
      const r = (sgk ?? {}) as { accrued?: number; paid?: number; tax_accrued?: number; tax_paid?: number };
      const sgkOpen = !sgk || Number(r.accrued ?? 0) === 0 || Number(r.paid ?? 0) < Number(r.accrued ?? 0);
      const taxOpen = !sgk || Number(r.tax_accrued ?? 0) === 0 || Number(r.tax_paid ?? 0) < Number(r.tax_accrued ?? 0);
      if (sgkOpen || taxOpen) {
        const what = [sgkOpen && "SGK primi", taxOpen && "muhtasar"].filter(Boolean).join(" ve ");
        const amt = sgk ? ` · kalan ${tl(Math.max(0, Number(r.accrued ?? 0) - Number(r.paid ?? 0)) + Math.max(0, Number(r.tax_accrued ?? 0) - Number(r.tax_paid ?? 0)))}` : "";
        await ctx.notify(bosses, toDue === 0 ? `Bugün son gün: ${what}` : `${what} için ${toDue} gün kaldı`, `${periodLabel(prev)} ${what} son ödeme ${formatDate(due)}${amt}. Ödeyince patron ekranından işaretleyin.`, "/patron?sekme=para#sgk");
        out.push("sgk");
      }
    }

    // Ayın 1'i: geçen ayın özeti
    if (ctx.today.slice(8, 10) === "01") {
      const [a, b] = await Promise.all([balance(prev), balance(prevPeriod(prev))]);
      const { start, end } = periodBounds(prev);
      const [{ count: hired }, { count: left }, { data: ot }, { data: pl }] = await Promise.all([
        ctx.sb.from("employees").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).gte("hire_date", start).lte("hire_date", end),
        ctx.sb.from("employees").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).gte("termination_date", start).lte("termination_date", end),
        ctx.sb.from("overtime_records").select("minutes").eq("company_id", ctx.companyId).eq("period", prev).eq("status", "approved"),
        ctx.sb.from("payroll_lines").select("employer_cost, official_net").eq("company_id", ctx.companyId).eq("period", prev),
      ]);
      const ch = b.accrued ? Math.round(((a.accrued - b.accrued) / b.accrued) * 1000) / 10 : null;
      const state = (pl ?? []).reduce((x, r) => x + Number(r.employer_cost) - Number(r.official_net), 0);
      const body = [
        `Net hakediş ${tl(a.accrued)}${ch !== null ? ` (${ch > 0 ? "▲" : "▼"} %${Math.abs(ch).toLocaleString("tr-TR")})` : ""}`,
        state ? `SGK + vergi ${tl(state)}, toplam ${tl(a.accrued + state)}` : null,
        `${hired ?? 0} giriş, ${left ?? 0} çıkış`,
        `fazla mesai ${Math.round((ot ?? []).reduce((x, r) => x + Number(r.minutes), 0) / 6) / 10} saat`,
        a.remain ? `ödenecek kalan ${tl(a.remain)}` : "tüm ödemeler yapıldı",
      ].filter(Boolean).join(" · ");
      await ctx.notify(bosses, `${periodLabel(prev)} özeti`, body, `/patron?sekme=para&donem=${prev}`);
      out.push("ay");
    }

    // Pazartesi: geçen hafta + bu haftanın ödemeleri
    if (isoWeekday(ctx.today) === 1) {
      const from = addDays(ctx.today, -7);
      const weeks = new Set([from.slice(0, 7), addDays(ctx.today, -1).slice(0, 7)]);
      let absent = 0; let late = 0;
      for (const p of weeks) {
        const m = await loadMonth(ctx.sb as unknown as SB, p);
        for (const [, row] of m.cells) for (const [d, c] of row) {
          if (d < from || d >= ctx.today || !c.employed || !tracked(row)) continue;
          if (missed(c, d)) absent++;
          if (c.lateMin > 0) late++;
        }
      }
      const [{ data: ot }, { count: pAdv }, { count: pLeave }, { count: pOt }] = await Promise.all([
        ctx.sb.from("overtime_records").select("minutes").eq("company_id", ctx.companyId).eq("status", "approved").gte("work_date", from).lt("work_date", ctx.today),
        ctx.sb.from("advance_requests").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending"),
        ctx.sb.from("leave_requests").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending"),
        ctx.sb.from("overtime_records").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending"),
      ]);
      const pays: string[] = [];
      if (toPay >= 0 && toPay <= 6) { const b = await balance(prev); if (b.remain) pays.push(`maaş ${formatDate(payDate)} · ${tl(b.remain)}`); }
      if (toDue >= 0 && toDue <= 6) pays.push(`SGK + muhtasar ${formatDate(due)}`);
      const pend = (pAdv ?? 0) + (pLeave ?? 0) + (pOt ?? 0);
      const body = [
        `Geçen hafta ${absent} gün devamsızlık, ${late} geç kalma`,
        `fazla mesai ${Math.round((ot ?? []).reduce((x, r) => x + Number(r.minutes), 0) / 6) / 10} saat`,
        pays.length ? `bu hafta ödemeler: ${pays.join(", ")}` : "bu hafta büyük ödeme yok",
        pend ? `onayınızı bekleyen ${pend} talep` : null,
      ].filter(Boolean).join(" · ");
      await ctx.notify(bosses, "Patron haftalık özet", body, "/patron");
      out.push("hafta");
    }
    return out.length ? out : "bildirim yok";
  },

  /** Pazartesi: haftalık özet */
  async haftalik(ctx) {
    if (isoWeekday(ctx.today) !== 1) return "pazartesi değil";
    const from = addDays(ctx.today, -7);
    const [{ count: leave }, { count: adv }, { data: ot }, { count: newcomers }] = await Promise.all([
      ctx.sb.from("leave_requests").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending"),
      ctx.sb.from("advance_requests").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending"),
      ctx.sb.from("overtime_records").select("minutes").eq("company_id", ctx.companyId).eq("status", "approved").gte("work_date", from).lt("work_date", ctx.today),
      ctx.sb.from("employees").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).gte("hire_date", from).lt("hire_date", ctx.today),
    ]);
    const otH = Math.round(((ot ?? []).reduce((a, r) => a + Number(r.minutes), 0) / 60) * 10) / 10;
    const body = [
      `Bekleyen ${leave ?? 0} izin, ${adv ?? 0} avans talebi`,
      `geçen hafta onaylı fazla mesai ${otH.toLocaleString("tr-TR")} saat`,
      newcomers ? `${newcomers} yeni personel` : null,
    ].filter(Boolean).join(" · ");
    // Patronlar ayrıntılı "Patron haftalık özet" alır; burada yalnız diğer sahip / muhasebe kullanıcıları
    const { data: ms } = await ctx.sb.from("memberships").select("user_id, role, is_boss").eq("company_id", ctx.companyId);
    const bosses = new Set((ms ?? []).filter((m) => m.is_boss || m.role === "owner").map((m) => m.user_id as string));
    await ctx.notify((await ctx.users(["owner", "accountant"])).filter((u) => !bosses.has(u)), "Haftalık özet", body, "/");
    return body;
  },
};
