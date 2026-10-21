import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { monthLabel, receivables } from "@/lib/receivables";
import { recvParams } from "../params";

/** Müşteri alacak raporu Excel: rapor ekranının filtreleriyle */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1 && (s.modules.sales ?? 0) < 1) return new Response("Yetkiniz yok", { status: 403 });
  const u = new URL(req.url).searchParams;
  const P = recvParams(Object.fromEntries(u.entries()));
  const { rows: all, months } = await receivables(P);
  const q = P.q.toLocaleLowerCase("tr");
  let rows = all.filter((r) => !q || r.name.toLocaleLowerCase("tr").includes(q));
  rows = P.onlyDebt ? rows.filter((r) => r.balance > 0) : rows.filter((r) => r.balance !== 0 || r.sales > 0 || r.paid > 0);
  rows.sort((a, b) => (P.sort === "ad" ? a.name.localeCompare(b.name, "tr") : P.sort === "ciro" ? b.sales - a.sales : b.balance - a.balance));
  const cols = ["devir", ...months].filter((k) => rows.some((r) => (r.aging[k] ?? 0) > 0));
  const v = (k: number) => Math.round(k) / 100;
  const data = rows.map((r) => ({
    "Müşteri": r.name, "Şehir": r.city ?? "", "Para": r.currency, "Devir": v(r.opening), "Ciro": v(r.sales), "Tahsilat": v(r.paid), "Kalan": v(r.balance),
    ...Object.fromEntries(cols.map((k) => [`Kalan · ${k === "devir" ? "Devir" : monthLabel(k)}`, v(r.aging[k] ?? 0)])),
    "Son tahsilat": r.lastPay ? r.lastPay.split("-").reverse().join(".") : "", "Son iş": r.lastJob ? r.lastJob.split("-").reverse().join(".") : "",
  }));
  const tot = (k: string) => data.reduce((a, r) => a + Number((r as Record<string, unknown>)[k] ?? 0), 0);
  const keys = Object.keys(data[0] ?? { "Müşteri": "" });
  data.push(Object.fromEntries(keys.map((k) => [k, k === "Müşteri" ? "TOPLAM" : ["Şehir", "Para", "Son tahsilat", "Son iş"].includes(k) ? "" : Math.round(tot(k) * 100) / 100])) as (typeof data)[number]);
  const ws = XLSX.utils.aoa_to_sheet([[`Müşteri alacak raporu · ${P.currency} · ${P.from.split("-").reverse().join(".")} – ${P.to.split("-").reverse().join(".")}`], []]);
  XLSX.utils.sheet_add_json(ws, data, { origin: "A3" });
  ws["!cols"] = keys.map((k) => ({ wch: k === "Müşteri" ? 38 : Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Alacaklar");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="musteri-alacaklari-${P.currency}-${P.to}.xlsx"` } });
}
