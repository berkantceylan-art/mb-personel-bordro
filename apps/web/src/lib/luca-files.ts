import "server-only";
import * as XLSX from "xlsx";
import { lucaChunks, lucaKind, lucaRows, type LucaColumn, type LucaVoucher } from "@/lib/luca-gl";

export type LucaBatchData = { batch: { no: number }; settings: { columns: LucaColumn[] }; vouchers: LucaVoucher[] };

/** Luca aktarım paketinin dosyaları: fiş tipine göre ayrı, 50 fişlik */
export function lucaBatchFiles(d: LucaBatchData, xls = false): Array<{ name: string; buf: Buffer }> {
  const cols = d.settings.columns;
  const ext = xls ? "xls" : "xlsx";
  return lucaChunks(d.vouchers).map((c) => {
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

}
