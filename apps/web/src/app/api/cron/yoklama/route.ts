import { createClient as createAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { todayFrom } from "@/lib/boss";
import { todayIso } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SB = Parameters<typeof loadMonth>[0];

/**
 * Sabah yoklaması (Vercel Cron, 10:30 İstanbul): bir bölümde 3 veya daha fazla kişi gelmediyse
 * patronlara anlık uyarı. Günde bir kez (job_runs).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "ayarlı değil" }, { status: 501 });
  const admin = createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const forced = new URL(req.url).searchParams.get("tarih");
  const today = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? forced : todayIso();
  const { data: companies } = await admin.from("companies").select("id");
  const report: Record<string, unknown> = {};
  for (const c of companies ?? []) {
    const { data: claimed } = await admin.from("job_runs").upsert({ job: "yoklama", run_date: today, company_id: c.id }, { onConflict: "job,run_date,company_id", ignoreDuplicates: true }).select("job");
    if (!claimed?.length) { report[c.id] = "bugün çalıştı"; continue; }
    const m = await loadMonth(admin as unknown as SB, today.slice(0, 7));
    const t = todayFrom(m, today);
    const hot = t.depts.filter((d) => d.missing >= 3);
    if (!hot.length || t.expected === 0) { report[c.id] = { expected: t.expected, absent: t.absent.length, alert: false }; continue; }
    const { data: ms } = await admin.from("memberships").select("user_id, role, is_boss").eq("company_id", c.id);
    const bosses = [...new Set((ms ?? []).filter((x) => x.is_boss || x.role === "owner").map((x) => x.user_id as string))];
    const pct = Math.round((t.present.length / t.expected) * 100);
    const body = `${hot.map((d) => `${d.dept}: ${d.missing}/${d.expected} kişi yok`).join(" · ")} — toplam ${t.absent.length} kişi gelmedi, doluluk %${pct}.`;
    if (bosses.length) await admin.from("notifications").insert(bosses.map((user_id) => ({ company_id: c.id, user_id, title: "Bölümde eksik personel", body: body.slice(0, 300), link: "/patron" })));
    await admin.from("job_runs").update({ result: { body } }).eq("job", "yoklama").eq("run_date", today).eq("company_id", c.id);
    report[c.id] = { alert: true, body };
  }
  return NextResponse.json({ ok: true, today, report });
}
