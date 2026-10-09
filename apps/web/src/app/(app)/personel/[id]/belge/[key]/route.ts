import { NextResponse } from "next/server";
import { annualLeaveEntitlement } from "@mb/core";
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

  // Çıkış belgeleri: sihirbazdan gelen tutarlar (brut/tavan) ile ibraname kalemleri
  const q = new URL(req.url).searchParams;
  if (q.get("brut") || q.get("tavan")) {
    const num = (v: string | null) => (v ? Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) : null);
    const { data: e } = await supabase.from("employees").select("hire_date, termination_date").eq("id", id).maybeSingle();
    const { data: priv } = await supabase.from("employee_private").select("birth_date").eq("employee_id", id).maybeSingle();
    if (e?.hire_date) {
      const end = e.termination_date ?? new Date().toISOString().slice(0, 10);
      const days = Math.round((Date.parse(end) - Date.parse(e.hire_date)) / 86_400_000) + 1;
      const years = days / 365;
      const brut = num(q.get("brut")) ?? 0; const cap = num(q.get("tavan"));
      const daily = Math.round(brut / 30);
      const weeks = years < 0.5 ? 2 : years < 1.5 ? 4 : years < 3 ? 6 : 8;
      const [{ data: leaves }, { data: adjs }] = await Promise.all([
        supabase.from("leave_requests").select("days, leave_types!inner(code)").eq("employee_id", id).eq("status", "approved").eq("leave_types.code", "YILLIK"),
        supabase.from("leave_adjustments").select("days").eq("employee_id", id),
      ]);
      const ent = annualLeaveEntitlement(e.hire_date, end, priv?.birth_date as string | null);
      const unused = Math.max(0, ent.earned + (adjs ?? []).reduce((a, l) => a + Number(l.days), 0) - (leaves ?? []).reduce((a, l) => a + Number(l.days), 0));
      const kidem = years >= 1 ? Math.round((cap ? Math.min(brut, cap) : brut) * years) : 0;
      const ihbar = weeks * 7 * daily; const izin = Math.round(unused * daily);
      const rows = await (async () => { const { data } = await supabase.from("ledger_period_summary").select("balance").eq("employee_id", id); return (data ?? []).reduce((a, r) => a + Number(r.balance ?? 0), 0); })();
      const f = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      Object.assign(d.data, { kidem: f(kidem), ihbar: f(ihbar), izin_gun: String(unused), izin_ucreti: f(izin), son_ucret: f(Math.max(0, rows)), diger: "0,00", toplam: f(kidem + ihbar + izin + Math.max(0, rows)) });
    }
  }
  const r = await renderTemplate(key, d.data);
  if (!r) return new NextResponse("Şablon bulunamadı", { status: 404 });
  return new NextResponse(new Uint8Array(r.buf), {
    headers: { "Content-Type": MIME[r.ext], "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${d.fileBase}-${key}.${r.ext}`)}` },
  });
}
