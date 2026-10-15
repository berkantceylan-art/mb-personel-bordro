import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Luca'da açılması gereken hesaplar (ERP'de var, Luca hesap planında yok) */
export async function GET() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_new_accounts");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const rows = (data ?? []) as Array<{ luca_code: string; name: string; erp_code: string; used: boolean }>;
  const aoa = [["Hesap Kodu", "Hesap Adı", "ERP Kodu", "Kullanıldı"], ...rows.map((r) => [r.luca_code, r.name, r.erp_code, r.used ? "Evet" : "Hayır"])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 1; r < aoa.length; r++) for (const c of [0, 2]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].t = "s"; }
  ws["!cols"] = [{ wch: 16 }, { wch: 44 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hesaplar");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="luca-acilacak-hesaplar.xlsx"` } });
}
