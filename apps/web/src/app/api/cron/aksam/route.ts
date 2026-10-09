import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { todayIso } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Akşam işi (Vercel Cron, 20:30 İstanbul): bugün giriş okutup çıkış okutmayanlara hatırlatma.
 * Vardiyası gece devam edenler için yalnız "son okutması 19:00'dan önce giriş" olanlar uyarılır.
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

  const { data: punches } = await admin.from("attendance_punches").select("company_id, employee_id, direction, punched_at").gte("punched_at", `${today}T00:00:00`).lt("punched_at", `${today}T23:59:59`).not("employee_id", "is", null).order("punched_at");
  const last = new Map<string, { company_id: string; direction: string; at: string }>();
  for (const p of punches ?? []) last.set(p.employee_id as string, { company_id: p.company_id, direction: p.direction, at: p.punched_at.slice(11, 16) });
  const open = [...last.entries()].filter(([, v]) => v.direction === "IN" && v.at < "19:00");
  if (!open.length) return NextResponse.json({ ok: true, today, reminded: 0 });
  const { data: emps } = await admin.from("employees").select("id, user_id").in("id", open.map(([id]) => id)).not("user_id", "is", null);
  // Bugün zaten hatırlatıldıysa tekrar gönderme
  const { data: already } = await admin.from("notifications").select("user_id").eq("title", "Çıkış okutmayı unuttunuz mu?").gte("created_at", `${today}T00:00:00+03:00`);
  const done = new Set((already ?? []).map((n) => n.user_id));
  const rows = (emps ?? []).filter((e) => !done.has(e.user_id)).map((e) => {
    const v = last.get(e.id)!;
    return { company_id: v.company_id, user_id: e.user_id as string, title: "Çıkış okutmayı unuttunuz mu?", body: `Bugün ${v.at} giriş yaptınız, çıkış okutmanız görünmüyor. Çıktıysanız saati bildirin; onaylanınca puantaja işlenir.`, link: `/benim/puantaj?eksik=${today}` };
  });
  if (rows.length) await admin.from("notifications").insert(rows);
  return NextResponse.json({ ok: true, today, open: open.length, reminded: rows.length });
}
