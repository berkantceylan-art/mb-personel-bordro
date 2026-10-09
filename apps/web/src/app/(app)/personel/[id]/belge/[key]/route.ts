import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { docData, renderTemplate, renderZip, TEMPLATES } from "@/lib/ozluk-docs";

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  zip: "application/zip",
};

/** Personel bilgileriyle doldurulmuş belge: /personel/:id/belge/:key  (key = şablon anahtarı veya "hepsi?adim=3") */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; key: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "safety"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const { id, key } = await ctx.params;
  const supabase = await createClient();
  const d = await docData(supabase, id, s.companyId);
  if (!d) return new NextResponse("Personel bulunamadı", { status: 404 });

  if (key === "hepsi") {
    const step = Number(new URL(req.url).searchParams.get("adim") || 0);
    let q = supabase.from("document_types").select("template_key, sort_order").not("template_key", "is", null).order("sort_order");
    if (step) q = q.eq("onboarding_step", step);
    const { data: types } = await q;
    const keys = [...new Set((types ?? []).map((t) => t.template_key as string).filter((k) => TEMPLATES[k]))];
    if (!keys.length) return new NextResponse("Şablon yok", { status: 404 });
    const buf = await renderZip(keys, d.data, d.fileBase);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": MIME.zip, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${d.fileBase}-belgeler${step ? `-adim${step}` : ""}.zip`)}` },
    });
  }

  const r = await renderTemplate(key, d.data);
  if (!r) return new NextResponse("Şablon bulunamadı", { status: 404 });
  return new NextResponse(new Uint8Array(r.buf), {
    headers: { "Content-Type": MIME[r.ext], "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${d.fileBase}-${key}.${r.ext}`)}` },
  });
}
