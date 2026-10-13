import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sistem temizlemeden önce seçilen modüllerin tüm kayıtlarını JSON yedek olarak indirir (yalnız şirket sahibi). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Giriş yapın" }, { status: 401 });
  const wanted = (req.nextUrl.searchParams.get("m") ?? "").split(",").filter(Boolean);
  const { data: plan, error } = await supabase.rpc("sys_reset_plan", { p_modules: wanted });
  if (error) return NextResponse.json({ error: /not_owner/.test(error.message) ? "Yalnız şirket sahibi" : error.message }, { status: 403 });
  const { data: c } = await supabase.rpc("sys_reset_company");
  const mods = new Set((plan as { modules: string[] }).modules);
  const { data: defs } = await supabase.rpc("sys_reset_modules");
  const tables = ((defs ?? []) as Array<{ key: string; tbls: string[] }>).filter((d) => mods.has(d.key)).flatMap((d) => d.tbls);
  const admin = createAdminClient();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      ctl.enqueue(enc.encode(`{"olusturma":${JSON.stringify(new Date().toISOString())},"moduller":${JSON.stringify([...mods])},"tablolar":{`));
      let firstT = true;
      for (const t of tables) {
        let scoped = true;
        let from = 0;
        let started = false;
        for (;;) {
          let q = admin.from(t).select("*").range(from, from + 999);
          if (scoped && c) q = q.eq("company_id", c as string);
          const { data, error: e } = await q;
          if (e && scoped && from === 0 && /company_id/.test(e.message)) { scoped = false; continue; }
          if (e) break;
          if (!started) { ctl.enqueue(enc.encode(`${firstT ? "" : ","}${JSON.stringify(t)}:[`)); firstT = false; started = true; }
          if (data?.length) ctl.enqueue(enc.encode((from ? "," : "") + data.map((r) => JSON.stringify(r)).join(",")));
          if (!data || data.length < 1000) break;
          from += 1000;
        }
        if (started) ctl.enqueue(enc.encode("]"));
      }
      ctl.enqueue(enc.encode("}}"));
      ctl.close();
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(stream, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="mbdental-yedek-${day}.json"`, "cache-control": "no-store" } });
}
