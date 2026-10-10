import { cors, json, robotAuth } from "../../../auth";

export const runtime = "nodejs";
export async function OPTIONS() { return new Response(null, { headers: cors }); }

/** Görev sonucu: tamamlandı / hata / iptal, SGK referans numarası */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await robotAuth(req);
  if (!a) return json({ error: "Geçersiz robot anahtarı" }, 401);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; reference?: string; note?: string };
  const status = ["tamamlandi", "hata", "iptal"].includes(body.status ?? "") ? body.status! : "tamamlandi";
  const { data: job } = await a.admin.from("sgk_robot_jobs").select("*").eq("id", id).eq("company_id", a.companyId).maybeSingle();
  if (!job) return json({ error: "Görev bulunamadı" }, 404);
  const ref = (body.reference ?? "").slice(0, 100) || null;
  await a.admin.from("sgk_robot_jobs").update({ status, reference: ref, result_note: (body.note ?? "").slice(0, 500) || null, done_at: new Date().toISOString() }).eq("id", id);
  if (status === "tamamlandi") {
    if (job.kind === "toplu-giris" || job.kind === "toplu-cikis") {
      const kind = job.kind === "toplu-giris" ? "ise-giris" : "isten-cikis";
      await a.admin.from("sgk_transactions").insert((job.employee_ids as string[]).map((employee_id) => ({ company_id: a.companyId, account_id: job.account_id, kind, employee_id, status: "basarili", reference: ref, message: "Robot ile toplu XML yüklendi", created_by: a.userId })));
    }
    if (job.kind === "is-kazasi" && job.related_id) await a.admin.from("safety_incidents").update({ sgk_notified_on: new Date().toISOString().slice(0, 10), sgk_ref: ref }).eq("id", job.related_id).eq("company_id", a.companyId);
  }
  await a.admin.from("sgk_transactions").insert({ company_id: a.companyId, account_id: job.account_id, kind: `robot-${job.kind}`, status: status === "tamamlandi" ? "basarili" : "hata", reference: ref, message: `Robot görevi ${status === "tamamlandi" ? "tamamlandı" : status === "iptal" ? "iptal edildi" : "hata verdi"}: ${job.title}${body.note ? ` · ${body.note}` : ""}`, created_by: a.userId });
  return json({ ok: true });
}
