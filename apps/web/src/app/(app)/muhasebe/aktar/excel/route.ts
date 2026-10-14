import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DOC_TYPE, VOUCHER_KIND, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean; text?: boolean };

/**
 * Muhasebe Excel çıktıları
 *  tur=fis    : fiş satırları (mali müşavirin Luca / Zirve "Excel'den fiş aktarma" ekranında sütunlar eşleştirilir)
 *  tur=mizan  : mizan (seviye)
 *  tur=kebir  : hesap ekstresi
 */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const u = new URL(req.url);
  const sp = Object.fromEntries(u.searchParams) as Record<string, string>;
  const { from, to } = period(sp);
  const tur = sp.tur ?? "fis";
  const fmt = sp.bicim ?? "luca";
  const supabase = await createClient();
  let cols: Col[] = [];
  let rows: Array<Record<string, unknown>> = [];
  let name = "muhasebe";

  if (tur === "fis") {
    const { data, error } = await supabase.rpc("gl_export", { p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const r = (data ?? []) as Array<Record<string, unknown>>;
    if (fmt === "zirve") {
      cols = [
        { header: "Fiş No", key: "no", width: 10 }, { header: "Fiş Tarihi", key: "voucher_date", date: true }, { header: "Fiş Türü", key: "kind_label", width: 10 },
        { header: "Hesap Kodu", key: "code", width: 16, text: true }, { header: "Açıklama", key: "line_description", width: 40 },
        { header: "Borç", key: "debit", money: true }, { header: "Alacak", key: "credit", money: true },
        { header: "Evrak No", key: "doc_no", width: 18, text: true }, { header: "Evrak Tarihi", key: "doc_date", date: true }, { header: "Belge Türü", key: "doc_label", width: 14 },
        { header: "Döviz Tutarı", key: "fx", money: true }, { header: "Döviz Cinsi", key: "fx_cur", width: 8 }, { header: "VKN / TCKN", key: "party_tax_no", width: 14, text: true },
      ];
    } else {
      cols = [
        { header: "Fiş No", key: "no", width: 10 }, { header: "Yevmiye No", key: "journal_no", width: 10 }, { header: "Tarih", key: "voucher_date", date: true }, { header: "Fiş Türü", key: "kind_label", width: 10 },
        { header: "Fiş Açıklaması", key: "description", width: 36 }, { header: "Hesap Kodu", key: "code", width: 16, text: true }, { header: "Hesap Adı", key: "account", width: 30 },
        { header: "Satır Açıklaması", key: "line_description", width: 40 }, { header: "Borç", key: "debit", money: true }, { header: "Alacak", key: "credit", money: true },
        { header: "Belge Türü", key: "doc_label", width: 14 }, { header: "Belge No", key: "doc_no", width: 18, text: true }, { header: "Belge Tarihi", key: "doc_date", date: true },
        { header: "Döviz Cinsi", key: "fx_cur", width: 8 }, { header: "Döviz Tutarı", key: "fx", money: true }, { header: "Kur", key: "rate", width: 10 }, { header: "VKN / TCKN", key: "party_tax_no", width: 14, text: true },
      ];
    }
    rows = r.map((x) => ({
      ...x, kind_label: VOUCHER_KIND[String(x.kind)] ?? x.kind, doc_label: DOC_TYPE[String(x.doc_type ?? "other")] ?? "",
      fx: x.fx_amount ? Math.abs(Number(x.fx_amount)) : null, fx_cur: x.currency !== "TRY" ? x.currency : null,
    }));
    name = `muhasebe-fisleri-${from}-${to}`;
  } else if (tur === "mizan") {
    const lvl = [1, 2, 3, 4, 5].includes(Number(sp.seviye)) ? Number(sp.seviye) : 1;
    const { data, error } = await supabase.rpc("gl_trial_balance", { p_from: from, p_to: to, p_level: lvl, p_zero: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = (data ?? []) as Array<Record<string, unknown>>;
    cols = [
      { header: "Hesap Kodu", key: "code", width: 16, text: true }, { header: "Hesap Adı", key: "name", width: 36 },
      { header: "Devir Borç", key: "open_d", money: true }, { header: "Devir Alacak", key: "open_c", money: true },
      { header: "Dönem Borç", key: "per_d", money: true }, { header: "Dönem Alacak", key: "per_c", money: true },
      { header: "Toplam Borç", key: "tot_d", money: true }, { header: "Toplam Alacak", key: "tot_c", money: true },
      { header: "Borç Bakiye", key: "bal_d", money: true }, { header: "Alacak Bakiye", key: "bal_c", money: true },
    ];
    name = `mizan-${from}-${to}`;
  } else if (tur === "kebir") {
    const { data, error } = await supabase.rpc("gl_ledger", { p_code: sp.hesap ?? "", p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const d = data as { code: string; opening: number; rows: Array<Record<string, unknown>> };
    let run = Number(d.opening);
    rows = [{ date: null, no: null, description: "Devir", debit: null, credit: null, balance: run }, ...d.rows.map((x) => { run += Number(x.debit) - Number(x.credit); return { ...x, balance: run }; })];
    cols = [
      { header: "Tarih", key: "date", date: true }, { header: "Fiş No", key: "no", width: 10 }, { header: "Hesap", key: "code", width: 16, text: true },
      { header: "Açıklama", key: "description", width: 44 }, { header: "Belge No", key: "doc_no", width: 18, text: true },
      { header: "Borç", key: "debit", money: true }, { header: "Alacak", key: "credit", money: true }, { header: "Bakiye (B+ / A-)", key: "balance", money: true },
    ];
    name = `muavin-${d.code}-${from}-${to}`;
  } else {
    return NextResponse.json({ error: "tür" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Dental ERP";
  const ws = wb.addWorksheet(tur === "fis" ? "Fişler" : tur === "mizan" ? "Mizan" : "Muavin");
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (c.money ? 16 : c.date ? 12 : 14), style: c.money ? { numFmt: "#,##0.00" } : c.date ? { numFmt: "dd.mm.yyyy" } : c.text ? { numFmt: "@" } : {} }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(cols.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === "") return [c.key, null];
      if (c.money) return [c.key, Number(v) / 100];
      if (c.date) return [c.key, new Date(String(v).slice(0, 10) + "T00:00:00Z")];
      if (c.text) return [c.key, String(v)];
      return [c.key, v];
    })));
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx` },
  });
}
