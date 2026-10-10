import { loadAccount } from "@/lib/sgk/soap";
import { cors, json, robotAuth } from "../../../auth";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { headers: cors }); }

/** Görevi başlatır: görev verisi ve SGK giriş bilgileri (yalnız bu anahtara, HTTPS üzerinden) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await robotAuth(req);
  if (!a) return json({ error: "Geçersiz robot anahtarı" }, 401);
  const { id } = await params;
  const { data: job } = await a.admin.from("sgk_robot_jobs").select("*").eq("id", id).eq("company_id", a.companyId).maybeSingle();
  if (!job || !["bekliyor", "calisiyor"].includes(job.status)) return json({ error: "Görev bulunamadı veya bitmiş" }, 404);
  const acc = await loadAccount(a.companyId);
  await a.admin.from("sgk_robot_jobs").update({ status: "calisiyor", picked_at: new Date().toISOString() }).eq("id", id);
  await a.admin.from("sgk_transactions").insert({ company_id: a.companyId, account_id: acc?.id ?? null, kind: `robot-${job.kind}`, environment: acc?.environment ?? null, status: "robot", message: `Robot görevi başlatıldı: ${job.title}`, request_summary: { job: id }, created_by: a.userId });
  return json({
    job: { id: job.id, kind: job.kind, title: job.title, target_url: job.target_url, payload: job.payload },
    login: acc ? { kullaniciAdi: acc.kullanici_adi, isyeriKodu: acc.isyeri_kodu, sistemSifre: acc.sistem ?? "", isyeriSifre: acc.isyeri ?? "" } : null,
  });
}
