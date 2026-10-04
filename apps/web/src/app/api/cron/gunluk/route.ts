import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isoWeekday } from "@mb/core";
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
    await ctx.notify(await ctx.users(["owner", "accountant"]), "Haftalık özet", body, "/");
    return body;
  },
};
