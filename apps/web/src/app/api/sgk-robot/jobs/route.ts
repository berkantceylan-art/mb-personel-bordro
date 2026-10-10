import { cors, json, robotAuth } from "../auth";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { headers: cors }); }

/** Bekleyen robot görevleri */
export async function GET(req: Request) {
  const a = await robotAuth(req);
  if (!a) return json({ error: "Geçersiz robot anahtarı" }, 401);
  const { data } = await a.admin.from("sgk_robot_jobs").select("id, kind, title, target_url, status, created_at").eq("company_id", a.companyId).in("status", ["bekliyor", "calisiyor"]).order("created_at");
  const { data: c } = await a.admin.from("companies").select("name").eq("id", a.companyId).single();
  return json({ company: c?.name ?? "", jobs: data ?? [] });
}
