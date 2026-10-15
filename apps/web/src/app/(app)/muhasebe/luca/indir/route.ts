import JSZip from "jszip";
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { lucaChunks, lucaKind, lucaRows, type LucaColumn, type LucaVoucher } from "@/lib/luca-gl";

export const dynamic = "force-dynamic";

/** Luca aktarım paketi: fiş tipine göre ayrı, 50 fişlik dosyalar (tek dosyaysa doğrudan, çoksa ZIP) */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const u = new URL(req.url);
  const id = u.searchParams.get("paket") ?? "";
  const xls = u.searchParams.get("bicim") === "xls";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "paket" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_batch", { p_batch: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const d = data as { batch: { no: number }; settings: { columns: LucaColumn[] }; vouchers: LucaVoucher[] };
  const cols = d.settings.columns;
  const ext = xls ? "xls" : "xlsx";

  const files = lucaChunks(d.vouchers).map((c) => {
    const aoa: Array<Array<string | number | Date | null>> = [cols.map((x) => x.header)];
    for (const v of c.vouchers) aoa.push(...lucaRows(v, cols));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd.mm.yyyy" });
    ws["!cols"] = cols.map((x) => ({ wch: Math.max(10, x.header.length + 2, x.field.includes("aciklama") ? 40 : 0) }));
    // hesap kodu ve fiş / evrak no metin kalsın (baştaki sıfır ve noktalar korunur)
    cols.forEach((x, ci) => {
      if (!["hesap_kodu", "evrak_no", "vkn"].includes(x.field)) return;
      for (let r = 1; r < aoa.length; r++) { const a = XLSX.utils.encode_cell({ r, c: ci }); if (ws[a]) { ws[a].t = "s"; ws[a].v = String(ws[a].v); } }
    });
    cols.forEach((x, ci) => {
      if (!["borc", "alacak", "tutar", "doviz_tutar"].includes(x.field)) return;
      for (let r = 1; r < aoa.length; r++) { const a = XLSX.utils.encode_cell({ r, c: ci }); if (ws[a] && ws[a].t === "n") ws[a].z = "0.00"; }
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: xls ? "biff8" : "xlsx" }) as Buffer;
    const name = `luca-paket${d.batch.no}-${lucaKind(c.kind).toLocaleLowerCase("tr-TR").replace("ı", "i").replace("ç", "c").replace("ş", "s")}-${c.part}.${ext}`;
    return { name, buf };
  });

  if (!files.length) return NextResponse.json({ error: "Pakette fiş yok" }, { status: 400 });
  if (files.length === 1) {
    const f = files[0]!;
    return new NextResponse(new Uint8Array(f.buf), { headers: { "Content-Type": xls ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${f.name}"` } });
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.buf);
  const out = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(out as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="luca-paket${d.batch.no}.zip"` } });
}
