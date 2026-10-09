/**
 * Luca muhasebe yazılımı "Puantaj Listesi" dosyası.
 * Mali müşavirin gönderdiği şablonla aynı yerleşim: başlık bloğu, kod açıklamaları,
 * SIRA / ADI SOYADI / TC / GİRİŞ / ÇIKIŞ / 1..31 gün kodu / Çal·Ssk·İzin·Top·Eks / Eksik gün neden / İmza.
 */
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import type { createClient } from "@/lib/supabase/server";
import { loadMonth, type DayCell } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Luca gün kodları */
export const LUCA_CODES: Array<[string, string]> = [
  ["N", "Normal"], ["T", "Resmi Tatil"], ["H", "Hafta Tatili"], ["İ", "İzinli"], ["G", "Gece Mesaisi"],
  ["R", "Raporlu"], ["E", "Eksik Gün"], ["Y", "Yarım Gün"], ["S", "Yıllık İzin"], ["O", "Gündüz Mesaisi"],
  ["K", "Yarım Gün Resmi Tatil"], ["C", "Yarım Gün Hafta Tatili"],
];

/** SGK eksik gün nedeni kodları (Luca / e-Bildirge) */
const REASONS: Record<string, string> = {
  R: "01-İstirahat", U: "06-Ücretsiz izin", E: "07-Puantaj kayıtları", MIX: "12-Birden fazla",
};

export interface LucaRow {
  sira: number;
  ad: string;
  tc: string;
  giris: string;   // dd/mm/yyyy
  cikis: string;
  days: string[];  // 31 hücre; ayda olmayan günler ""
  cal: number;
  ssk: number;
  izin: number;
  top: number;
  eks: number;
  neden: string;
  dept: string;
  employeeId: string;
}

export interface LucaData {
  period: string;
  company: { name: string; tax_office: string; tax_no: string; sgk: string; address: string; web: string };
  weekdays: string[];  // 31 kısaltma
  rows: LucaRow[];
  warnings: string[];
}

const WD = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];
const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Zaman takibi hücresi → Luca kodu */
export function lucaCode(c: DayCell, halfHoliday = false): string {
  if (!c.employed) return "-";
  const lc = c.leaveCode ?? "";
  if (lc.startsWith("YILLIK")) return "S";
  if (lc.startsWith("RAPOR")) return "R";
  if (lc && !lc.startsWith("SAATLIK")) return "İ";
  if (halfHoliday || c.halfHoliday) return "K";
  if (c.status === "HOLIDAY" || (c.holidayName && c.status !== "WEEKLY_OFF")) return "T";
  if (c.status === "WEEKLY_OFF") return "H";
  if (c.status === "ABSENT") return "E";
  // WORKED, INCOMPLETE (eksik okutma ama gelmiş), NO_SHIFT (takip edilmeyen personel) → normal
  return "N";
}

export async function loadLuca(sb: SB, period: string, department?: string): Promise<LucaData> {
  const [y, mo] = period.split("-").map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const month = await loadMonth(sb, period, { department });
  const ids = month.employees.map((e) => e.id);
  const [{ data: company }, { data: privs }, { data: lines }, { data: leaveRows }] = await Promise.all([
    sb.from("companies").select("name, address, tax_office, tax_no, sgk_registration_no, email").limit(1).maybeSingle(),
    ids.length ? sb.from("employee_private").select("employee_id, national_id").in("employee_id", ids) : Promise.resolve({ data: [] as Array<{ employee_id: string; national_id: string | null }> }),
    ids.length ? sb.from("payroll_lines").select("employee_id, days").eq("period", period).in("employee_id", ids) : Promise.resolve({ data: [] as Array<{ employee_id: string; days: number }> }),
    sb.from("leave_requests").select("employee_id, start_date, end_date, leave_types(code, paid)").eq("status", "approved").lte("start_date", `${period}-${String(dim).padStart(2, "0")}`).gte("end_date", `${period}-01`),
  ]);
  const tc = new Map((privs ?? []).map((p) => [p.employee_id, p.national_id ?? ""]));
  const payrollDays = new Map((lines ?? []).map((l) => [l.employee_id, Number(l.days)]));
  // Ücretsiz izinler (SGK eksik gün sayılır)
  const unpaid = new Set<string>();
  for (const l of leaveRows ?? []) {
    const lt = l.leave_types as unknown as { code: string; paid: boolean } | null;
    if (!lt || lt.paid || lt.code === "RAPOR") continue;
    for (let d = new Date(l.start_date + "T00:00:00Z"); d.toISOString().slice(0, 10) <= l.end_date; d.setUTCDate(d.getUTCDate() + 1)) unpaid.add(`${l.employee_id}|${d.toISOString().slice(0, 10)}`);
  }

  const weekdays = Array.from({ length: 31 }, (_, i) => (i < dim ? WD[new Date(Date.UTC(y, mo - 1, i + 1)).getUTCDay()]! : ""));
  const warnings: string[] = [];
  const rows: LucaRow[] = [];
  const sorted = [...month.employees].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  let sira = 0;
  for (const e of sorted) {
    const cells = month.cells.get(e.id);
    if (!cells) continue;
    // Ay içinde hiç çalışmamış (ay bitmeden önce ayrılmış / ay sonrası girmiş) → listede yok
    const employedDays = month.days.filter((d) => cells.get(d)?.employed).length;
    if (!employedDays) continue;
    const codes: string[] = [];
    let cal = 0, izin = 0, eks = 0;
    const reasons = new Set<string>();
    for (let i = 0; i < 31; i++) {
      const d = month.days[i];
      if (!d) { codes.push(""); continue; }
      const c = cells.get(d)!;
      const code = lucaCode(c, !!month.holidays.get(d)?.half_day);
      codes.push(code);
      if (!c.employed) continue;
      if (code === "N" || code === "K") cal += 1;
      if (code === "S" || code === "İ" || code === "R") izin += 1;
      if (code === "R") { eks += 1; reasons.add("R"); }
      else if (code === "E") { eks += 1; reasons.add("E"); }
      else if (code === "İ" && unpaid.has(`${e.id}|${d}`)) { eks += 1; reasons.add("U"); }
    }
    // Bordro günü: ay içi giriş/çıkış 30 gün esasına göre; tam ay = 30
    const fullMonth = employedDays === dim;
    let top = fullMonth ? 30 : employedDays;
    if (!fullMonth && e.hireDate <= `${period}-01` && e.terminationDate && e.terminationDate >= `${period}-${String(dim).padStart(2, "0")}`) top = 30;
    let ssk = Math.max(0, top - eks);
    const pd = payrollDays.get(e.id);
    if (pd !== undefined && pd !== ssk) {
      warnings.push(`${e.name}: bordroda ${pd} SGK günü var, puantajdan ${ssk} çıkıyor; bordro günü kullanıldı.`);
      ssk = pd; eks = Math.max(0, top - pd);
    }
    const neden = eks === 0 ? "" : reasons.size > 1 ? REASONS.MIX : REASONS[[...reasons][0] ?? "E"] ?? REASONS.E;
    const id = tc.get(e.id) ?? "";
    if (!id) warnings.push(`${e.name}: TC kimlik no eksik`);
    rows.push({
      sira: ++sira, ad: e.name.toLocaleUpperCase("tr"), tc: id, giris: dmy(e.hireDate),
      cikis: e.terminationDate && e.terminationDate <= `${period}-${String(dim).padStart(2, "0")}` ? dmy(e.terminationDate) : "",
      days: codes, cal, ssk, izin, top, eks, neden, dept: e.dept, employeeId: e.id,
    });
  }
  const c = company ?? { name: "", address: "", tax_office: "", tax_no: "", sgk_registration_no: "", email: "" };
  return {
    period,
    company: { name: c.name ?? "", tax_office: c.tax_office ?? "", tax_no: c.tax_no ?? "", sgk: c.sgk_registration_no ?? "", address: c.address ?? "", web: "" },
    weekdays, rows, warnings,
  };
}

const MONTHS = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];

/** Hücre matrisi (0 tabanlı satır/sütun) ve birleştirmeler: hem xlsx hem xls için ortak */
function grid(d: LucaData, department?: string) {
  const [y, mo] = d.period.split("-").map(Number);
  const rows: Array<Array<string | number>> = [];
  const put = (r: number, c: number, v: string | number) => { (rows[r] ??= [])[c] = v; };
  put(0, 0, `İşyeri:${d.company.name.split(" ").slice(0, 2).join(" ")} Bölüm:${department ?? "Tümü"}                                             ${MONTHS[mo - 1]}/${y} ayı Puantaj Listesi`);
  put(1, 0, d.company.name);
  put(2, 0, `Vergi Dairesi: ${d.company.tax_office}`); put(2, 4, `Vergi No: ${d.company.tax_no}`);
  put(3, 0, `SGK Sicil No: ${d.company.sgk}`); put(3, 4, "Mersis No: ");
  put(4, 0, `Adres: ${d.company.address}`);
  put(5, 0, `Merkez Adres: ${d.company.address}`);
  put(6, 0, `Web Adresi: ${d.company.web}`);
  // Kod açıklamaları: 2. satırdan itibaren 5 sütunluk bloklar (16/17, 21/22, 26/27, 31/32, 36/37)
  LUCA_CODES.forEach(([k, v], i) => { const r = 2 + Math.floor(i / 5); const c = 16 + (i % 5) * 5; put(r, c, k); put(r, c + 1, v); });
  put(6, 36, "Toplam"); put(6, 41, "Eksik Gün Neden"); put(6, 42, "İMZA");
  put(7, 0, "SIRA"); put(8, 0, "NO"); put(8, 1, " ADI SOYADI"); put(7, 2, "T.C."); put(8, 2, "KİMLİK NO");
  put(7, 3, "GİRİŞ"); put(8, 3, "TARİHİ"); put(7, 4, "ÇIKIŞ"); put(8, 4, "TARİHİ");
  for (let i = 0; i < 31; i++) { put(7, 5 + i, String(i + 1)); put(8, 5 + i, d.weekdays[i] ?? ""); }
  [["Çal", "Gün"], ["Ssk", "Gün"], ["İzin", "Gün"], ["Gün", "Top"], ["Eks", "Gün"]].forEach(([a, b], i) => { put(7, 36 + i, a!); put(8, 36 + i, b!); });
  d.rows.forEach((r, i) => {
    const R = 9 + i;
    put(R, 0, r.sira); put(R, 1, r.ad); put(R, 2, r.tc); put(R, 3, r.giris); put(R, 4, r.cikis);
    r.days.forEach((c, j) => put(R, 5 + j, c));
    put(R, 36, r.cal); put(R, 37, r.ssk); put(R, 38, r.izin); put(R, 39, r.top); put(R, 40, r.eks); put(R, 41, r.neden); put(R, 42, "");
  });
  const merges: Array<[number, number, number, number]> = [
    [0, 0, 0, 42], [1, 0, 1, 13], [2, 0, 2, 3], [2, 4, 2, 13], [3, 0, 3, 3], [3, 4, 3, 13], [4, 0, 4, 13], [5, 0, 5, 13], [6, 0, 6, 13],
    [6, 36, 6, 40], [6, 41, 8, 41], [6, 42, 8, 42],
  ];
  for (const r of [2, 3]) for (const c of [17, 22, 27, 32, 37]) merges.push([r, c, r, c + 3]);
  merges.push([4, 17, 4, 25], [4, 27, 4, 35]);
  const widths = [6, 22, 13, 10, 10, ...Array(31).fill(3.2), 4.5, 4.5, 5, 5, 5, 18, 14];
  return { rows, merges, widths };
}

export async function lucaXlsx(d: LucaData, department?: string): Promise<ArrayBuffer> {
  const { rows, merges, widths } = grid(d, department);
  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Personel & Bordro";
  const ws = wb.addWorksheet("Sheet1", { pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  rows.forEach((r, ri) => r?.forEach((v, ci) => { if (v !== undefined) ws.getCell(ri + 1, ci + 1).value = v; }));
  for (const [r1, c1, r2, c2] of merges) ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
  const thin: Partial<ExcelJS.Borders> = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  ws.getRow(1).font = { bold: true, size: 11 }; ws.getRow(2).font = { bold: true };
  for (let r = 1; r <= 7; r++) ws.getRow(r).font = { ...ws.getRow(r).font, size: r > 2 ? 8 : 11 };
  for (let r = 8; r <= 9 + d.rows.length; r++) {
    const row = ws.getRow(r);
    row.font = { size: 8, bold: r <= 9 };
    for (let c = 1; c <= 43; c++) {
      const cell = row.getCell(c);
      cell.border = thin;
      cell.alignment = { horizontal: c === 2 || c === 42 ? "left" : "center", vertical: "middle" };
      if (r <= 9) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
      else if (c >= 6 && c <= 36) {
        const v = String(cell.value ?? "");
        if (v === "E") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEA" } };
        else if (v === "R") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E0" } };
        else if (v === "H" || v === "T" || v === "K") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FB" } };
        else if (v === "S" || v === "İ") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4EC" } };
      }
    }
    if (r > 9) row.getCell(3).numFmt = "@";
  }
  ws.views = [{ state: "frozen", xSplit: 5, ySplit: 9 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Eski Excel (.xls, BIFF8) — Luca'nın şablonu bu biçimdeydi */
export function lucaXls(d: LucaData, department?: string): Buffer {
  const { rows, merges, widths } = grid(d, department);
  const aoa = rows.map((r) => Array.from({ length: 43 }, (_, i) => (r?.[i] === undefined ? "" : r[i]!)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges.map(([r1, c1, r2, c2]) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }));
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  // TC kimlik no metin kalsın
  for (let i = 0; i < d.rows.length; i++) { const a = XLSX.utils.encode_cell({ r: 9 + i, c: 2 }); if (ws[a]) ws[a].t = "s"; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
}
