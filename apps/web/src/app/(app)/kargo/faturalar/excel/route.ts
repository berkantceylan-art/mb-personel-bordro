import { getSession } from "@/lib/session";
import { carrierReport, carrierWorkbook } from "@/lib/carrier-report";

/** Kargo kontrol Excel'i: ?firma=ups|dhl&ay=6&kapsam=tum|itiraz — her kontrol ayrı sayfa, fatura no + fatura tarihi ile */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1) return new Response("Yetkiniz yok", { status: 403 });
  const u = new URL(req.url).searchParams;
  const months = Math.min(24, Math.max(1, Number(u.get("ay")) || 6));
  const carrier = u.get("firma") === "dhl" ? "dhl" : "ups";
  const kapsam = u.get("kapsam") === "itiraz" ? "itiraz" : "tum";
  const buf = carrierWorkbook(await carrierReport(carrier, months), carrier, kapsam);
  const name = `${carrier}-${kapsam === "itiraz" ? "itiraz" : "kontrol"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` } });
}
