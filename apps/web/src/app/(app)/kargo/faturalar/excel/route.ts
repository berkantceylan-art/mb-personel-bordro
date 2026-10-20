import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { FLAG_LABEL, flagItems, loadCarrierItems } from "@/lib/carrier-check";

/** İtiraz ve uyarı listesi (Excel): itiraz işaretli + mükerrer / ek hizmet / ortalamanın üstü / firma tartısı satırları */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1) return new Response("Yetkiniz yok", { status: 403 });
  const u = new URL(req.url).searchParams;
  const months = Math.min(24, Math.max(1, Number(u.get("ay")) || 6));
  const firma = u.get("firma") === "ups" ? "ups" : u.get("firma") === "dhl" ? "dhl" : undefined;
  const from = new Date(Date.now() - months * 31 * 86400000).toISOString().slice(0, 10);
  const items = (await flagItems((await loadCarrierItems(from, undefined, firma)).data)).filter((i) => i.disputed || i.flags.some((f) => ["dup", "premium", "high", "measured"].includes(f)));
  const rows = items.map((i) => ({
    "Firma": i.carrier_invoices?.carrier.toUpperCase(), "Fatura no": i.carrier_invoices?.invoice_no, "Gönderi tarihi": i.ship_date, "Konşimento": i.awb,
    "Alıcı": i.recipient_company ?? i.recipient, "Hekim": i.lab_customers?.name ?? "", "Ülke": i.dest_country ?? i.dest, "Kg": i.weight, "Kg kaynağı": i.weight_basis ?? "",
    "Taşıma (TL)": i.base_amount / 100, "Ek ücretler": i.extras.map((x) => `${x.name}: ${(x.amount / 100).toFixed(2)}`).join(" | "), "Toplam (TL)": i.total / 100,
    "Uyarı": i.flags.map((f) => FLAG_LABEL[f]).join(", "), "İtiraz": i.disputed ? "Evet" : "", "Not": i.note ?? "",
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Kargo kontrol");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${firma ?? "kargo"}-kontrol.xlsx"` } });
}
