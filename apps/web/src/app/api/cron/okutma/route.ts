import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { punchWatch, istanbulNow } from "@/lib/punch-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Okutma uyarıları (Vercel Cron, 10 dakikada bir): vardiyaya göre giriş / çıkış / öğle dönüşü / saatlik izin okutması
 * eksik olan personele bildirim. Her uyarı türü personel başına günde bir kez. Sabah 08:00–10:00 arası dünkü eksikler de hatırlatılır.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "ayarlı değil" }, { status: 501 });
  const admin = createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const forced = new URL(req.url).searchParams.get("an");
  const now = forced && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(forced) ? forced : istanbulNow();
  const today = now.slice(0, 10);
  const items = (await punchWatch(admin, now)).filter((i) => i.userId);

  // Dünkü açık eksik okutmalar (sabah bir kez)
  const hour = Number(now.slice(11, 13));
  if (hour >= 8 && hour < 10) {
    const y = new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
    const { data: days } = await admin.from("att_days").select("employee_id, issues, employees(user_id)").eq("work_date", y).eq("state", "open").overlaps("issues", ["MISSING_IN", "MISSING_OUT"]);
    for (const d of (days ?? []) as unknown as { employee_id: string; issues: string[]; employees: { user_id: string | null } | null }[]) {
      if (!d.employees?.user_id) continue;
      items.push({ employeeId: d.employee_id, userId: d.employees.user_id, kind: "NO_OUT_END", date: y, direction: d.issues.includes("MISSING_IN") ? "IN" : "OUT", suggest: "", title: "Dünkü okutmanız eksik", body: `Dün ${d.issues.includes("MISSING_IN") ? "giriş" : "çıkış"} okutmanız eksik. Uygulamayı açıp saatini bildirin; bildirmeden uygulama kullanılamaz.` });
    }
  }
  if (!items.length) return NextResponse.json({ ok: true, now, sent: 0 });

  const users = [...new Set(items.map((i) => i.userId!))];
  const { data: already } = await admin.from("notifications").select("user_id, title").in("user_id", users).gte("created_at", `${today}T00:00:00+03:00`);
  const sent = new Set(((already ?? []) as { user_id: string; title: string }[]).map((n) => `${n.user_id}|${n.title}`));
  const { data: comp } = await admin.from("employees").select("id, company_id").in("id", [...new Set(items.map((i) => i.employeeId))]);
  const cmap = new Map(((comp ?? []) as { id: string; company_id: string }[]).map((c) => [c.id, c.company_id]));
  const rows = items
    .filter((i) => !sent.has(`${i.userId}|${i.title}`))
    .filter((i, k, a) => a.findIndex((x) => x.userId === i.userId && x.title === i.title) === k)
    .map((i) => ({ company_id: cmap.get(i.employeeId), user_id: i.userId, title: i.title, body: i.body, link: `/benim/puantaj?eksik=${i.date}` }))
    .filter((r) => r.company_id);
  if (rows.length) await admin.from("notifications").insert(rows);
  return NextResponse.json({ ok: true, now, found: items.length, sent: rows.length });
}
