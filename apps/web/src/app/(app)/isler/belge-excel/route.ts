import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { docsXlsx, loadStatementDocs, loadWaybillDocs } from "@/lib/billing-docs";

export const maxDuration = 60;

/** İrsaliye / aylık fatura Excel: ?tur=irsaliye|fatura&id=a,b,c  ya da  ?tur=irsaliye&gun=YYYY-MM-DD  /  ?tur=fatura&ay=YYYY-MM */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  const q = req.nextUrl.searchParams;
  const kind = q.get("tur") === "fatura" ? "statement" : "waybill";
  const sb = await createClient();
  let list = (q.get("id") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  let name = "";
  if (!list.length && kind === "waybill" && /^\d{4}-\d{2}-\d{2}$/.test(q.get("gun") ?? "")) {
    const { data } = await sb.from("lab_waybills").select("id").eq("ship_date", q.get("gun")!).neq("status", "cancelled").order("created_at");
    list = (data ?? []).map((w) => w.id as string); name = `irsaliyeler-${q.get("gun")}`;
  }
  if (!list.length && kind === "statement" && /^\d{4}-\d{2}$/.test(q.get("ay") ?? "")) {
    const ym = q.get("ay")!; const [y, m] = ym.split("-").map(Number) as [number, number];
    const { data } = await sb.from("lab_statements").select("id").eq("status", "issued").lte("period_from", new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)).gte("period_to", `${ym}-01`).order("no");
    list = (data ?? []).map((x) => x.id as string); name = `faturalar-${ym}`;
  }
  if (!list.length) return new NextResponse("Belge bulunamadı", { status: 404 });
  const docs = kind === "waybill" ? await loadWaybillDocs(sb, list) : await loadStatementDocs(sb, list);
  const buf = await docsXlsx(docs);
  try { await createAdminClient().from("lab_doc_events").insert(docs.map((d) => ({ company_id: s.companyId, doc_kind: kind, doc_id: d.id, action: "excel", by_user: s.userId }))); } catch { /* iz isteğe bağlı */ }
  const file = name || (docs.length === 1 ? docs[0]!.no : `${kind === "waybill" ? "irsaliyeler" : "faturalar"}-${docs.length}`);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}.xlsx` } });
}
