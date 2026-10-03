import ExcelJS from "exceljs";

/**
 * Mevcut aylık maaş Excel'ini (EKİM 2026 MAAŞ LİSTESİ formatı) okur.
 * Başlıklar ad üzerinden eşlenir; sütun sırası değişse de çalışır.
 */
export interface ImportRow {
  rowNo: number;
  department: string;
  firstName: string;
  lastName: string;
  monthlyTotal: number; // TL
  missingDays: number;
  hireDate: string | null; // ISO
  accrual: number; // TL
  deduction: number;
  cashAdvances: number[];
  bankAdvances: number[];
  bes: number;
  garnishment: number;
  bankPayments: number[];
  cashPayments: number[];
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");

type Key =
  | "dept" | "name" | "salary" | "missing" | "hire" | "accrual" | "deduction"
  | "cashAdv" | "bankAdv" | "bes" | "icra" | "bank" | "cash";

function keyFor(header: string): Key | null {
  const h = norm(header);
  if (h === "BÖLÜM") return "dept";
  if (h === "ADSOYAD") return "name";
  if (h === "MAAŞ") return "salary";
  if (h === "EKSİKGÜN") return "missing";
  if (h.startsWith("İŞEGİRİŞ")) return "hire";
  if (h === "HAKEDİŞ") return "accrual";
  if (h.startsWith("BORÇ")) return "deduction";
  if (h.startsWith("ELDENAVANS")) return "cashAdv";
  if (h.startsWith("BANKAAVANS")) return "bankAdv";
  if (h === "BES") return "bes";
  if (h === "İCRA") return "icra";
  if (/^BANKA\d*$/.test(h)) return "bank";
  if (/^ELDEN\d*$/.test(h)) return "cash";
  return null;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in v) return num((v as { result: unknown }).result);
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v && "result" in v) return isoDate((v as { result: unknown }).result);
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(String(v ?? "").trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
};

/** "AHMET KABAY" → Ahmet / Kabay ; tek kelime → soyad boş */
export function splitName(full: string): { firstName: string; lastName: string } {
  const cap = (w: string) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr");
  const parts = full.trim().split(/\s+/).filter(Boolean).map(cap);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

const MONTHS: Record<string, string> = {
  OCAK: "01", ŞUBAT: "02", MART: "03", NİSAN: "04", MAYIS: "05", HAZİRAN: "06",
  TEMMUZ: "07", AĞUSTOS: "08", EYLÜL: "09", EKİM: "10", KASIM: "11", ARALIK: "12",
};

export function guessPeriod(sheetName: string, year: number): string | null {
  const m = MONTHS[norm(sheetName)];
  return m ? `${year}-${m}` : null;
}

export async function parsePayrollWorkbook(buf: ArrayBuffer): Promise<{ sheetName: string; rows: ImportRow[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel dosyasında sayfa yok");

  const cols = new Map<number, Key>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = keyFor(String(cell.value ?? ""));
    if (k) cols.set(col, k);
  });
  if (![...cols.values()].includes("name")) throw new Error("'AD SOYAD' sütunu bulunamadı");

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const r: ImportRow = {
      rowNo, department: "", firstName: "", lastName: "", monthlyTotal: 0, missingDays: 0, hireDate: null,
      accrual: 0, deduction: 0, cashAdvances: [], bankAdvances: [], bes: 0, garnishment: 0, bankPayments: [], cashPayments: [],
    };
    let name = "";
    for (const [col, key] of cols) {
      const v = row.getCell(col).value;
      switch (key) {
        case "dept": r.department = String(v ?? "").trim(); break;
        case "name": name = String(v ?? "").trim(); break;
        case "salary": r.monthlyTotal = num(v); break;
        case "missing": r.missingDays = num(v); break;
        case "hire": r.hireDate = isoDate(v); break;
        case "accrual": r.accrual = num(v); break;
        case "deduction": r.deduction = num(v); break;
        case "cashAdv": if (num(v)) r.cashAdvances.push(num(v)); break;
        case "bankAdv": if (num(v)) r.bankAdvances.push(num(v)); break;
        case "bes": r.bes = num(v); break;
        case "icra": r.garnishment = num(v); break;
        case "bank": if (num(v)) r.bankPayments.push(num(v)); break;
        case "cash": if (num(v)) r.cashPayments.push(num(v)); break;
      }
    }
    // Toplam satırı ve boş satırlar atlanır
    if (!name || !r.department) return;
    Object.assign(r, splitName(name));
    rows.push(r);
  });
  return { sheetName: ws.name, rows };
}
