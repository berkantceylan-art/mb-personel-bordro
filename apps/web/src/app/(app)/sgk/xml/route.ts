import { NextResponse, type NextRequest } from "next/server";
import { logAccess } from "@/lib/kvkk";
import { cikisRows, cikisXml, companySgk, girisRows, girisXml } from "@/lib/sgk/data";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/** SGK toplu işe giriş / işten ayrılış XML dosyası (uyg.sgk.gov.tr/SgkTescil4a → dosya yükle) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!["owner", "hr", "accountant"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const tur = sp.get("tur") === "cikis" ? "cikis" : "giris";
  const supabase = await createClient();
  const comp = await companySgk(supabase);
  if (!comp || !ids.length) return new NextResponse("Personel seçilmedi", { status: 400 });
  const xml = tur === "giris" ? girisXml(comp, await girisRows(supabase, ids)) : cikisXml(comp, await cikisRows(supabase, ids));
  await logAccess(supabase, s.companyId, s.userId, "export", "sgk_xml", null, `${tur} ${ids.length} kişi`);
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="sgk-${tur === "giris" ? "ise-giris" : "isten-cikis"}-${todayIso()}.xml"` } });
}
