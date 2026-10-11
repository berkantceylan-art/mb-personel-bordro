import ExcelJS from "exceljs";

/**
 * Muhasebe / SGK programından alınan "PERSONEL SİCİL LİSTESİ" Excel'ini okur.
 * Başlıklar ad üzerinden eşlenir; sütun sırası değişse de çalışır.
 */
export interface SicilRow {
  rowNo: number;
  firstName: string;
  lastName: string;
  gender: string | null;
  title: string | null;
  department: string | null;
  retired: boolean;
  sgkNo: string | null;
  nationalId: string | null;
  fatherName: string | null;
  motherName: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  city: string | null;
  district: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  terminationReason: string | null;
  address: string | null;
  phone: string | null;
  bankName: string | null;
  iban: string | null;
  bloodType: string | null;
  occupationCode: string | null;
  occupationName: string | null;
  salary: number;
  netGross: "N" | "B" | null;
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");

type Key =
  | "first" | "last" | "gender" | "title" | "dept" | "sgk" | "tc" | "father" | "mother" | "bplace" | "bdate"
  | "city" | "district" | "hire" | "exit" | "exitReason" | "address" | "phone" | "bank" | "account"
  | "salary" | "netGross" | "blood" | "occCode" | "occName";

function keyFor(header: string): Key | null {
  const h = norm(header);
  const map: Record<string, Key> = {
    ADI: "first", AD: "first", SOYADI: "last", SOYAD: "last", CİNSİYETİ: "gender", CİNSİYET: "gender",
    ÜNVAN: "title", ÜNVANI: "title", UNVAN: "title", BÖLÜM: "dept", BÖLÜMÜ: "dept",
    SSKNO: "sgk", SGKNO: "sgk", SGKSİCİLNO: "sgk", TCKİMLİKNO: "tc", TCKN: "tc", TCNO: "tc",
    BABAADI: "father", ANNEADI: "mother", DOĞUMYERİ: "bplace", DOĞUMTARİHİ: "bdate",
    NÜFUSAKAYITLIOLDUĞUİL: "city", NÜFUSAKAYITLIOLDUĞUİLÇE: "district",
    İŞEGİRİŞTARİHİ: "hire", İŞTENÇIKIŞTARİHİ: "exit", İŞTENAYRILIŞNEDENİ: "exitReason",
    ADRES: "address", TELEFON: "phone", BANKAŞUBEADI: "bank", HESAPNO: "account", IBAN: "account",
    ÜCRET: "salary", NETBRÜT: "netGross", KANGRUBU: "blood", MESLEKKODU: "occCode", MESLEKADI: "occName",
  };
  return map[h] ?? null;
}

const cellVal = (v: unknown): unknown => (typeof v === "object" && v && !(v instanceof Date) && "result" in v ? (v as { result: unknown }).result : v);
const text = (v: unknown): string | null => {
  const x = cellVal(v);
  if (x === null || x === undefined) return null;
  const s = (typeof x === "number" ? String(Math.round(x)) : String(x)).replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const digits = (v: unknown): string | null => {
  const x = cellVal(v);
  const s = typeof x === "number" ? String(Math.round(x)) : String(x ?? "").replace(/\D/g, "");
  return s ? s : null;
};
const isoDate = (v: unknown): string | null => {
  const x = cellVal(v);
  if (x instanceof Date) {
    // Excel tarihleri UTC gece yarısı gelir; saat dilimi kayması olmasın
    const d = new Date(x.getTime() + 12 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(String(x ?? "").trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
};
const num = (v: unknown): number => {
  const x = cellVal(v);
  if (typeof x === "number") return x;
  const n = Number(String(x ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const cap = (s: string | null) =>
  s ? s.split(/\s+/).map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr")).join(" ") : null;

/** TC kimlik no algoritma kontrolü */
export function validTckn(t: string | null): boolean {
  if (!t || !/^[1-9]\d{10}$/.test(t)) return false;
  const d = t.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}

const phone = (v: unknown): string | null => {
  let s = digits(v);
  if (!s) return null;
  if (s.length === 12 && s.startsWith("90")) s = s.slice(2);
  if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
  return s.length === 10 ? `0${s}` : s;
};
const blood = (v: unknown): string | null => {
  const raw = text(v);
  if (!raw) return null;
  const m = /^(0|O|A|B|AB)(\+|-|POZ\S*|NEG\S*)?$/.exec(raw.toLocaleUpperCase("tr").replace(/\s|RH/g, ""));
  if (!m) return raw;
  const sign = !m[2] ? "" : m[2].startsWith("+") || m[2].startsWith("POZ") ? " Rh+" : " Rh−";
  return `${m[1] === "O" ? "0" : m[1]}${sign}`;
};

/** Adresin sonundaki "İzmir Bornova" → il / ilçe (nüfus il-ilçesi değil, ikamet) */
const PROVINCES = ["İzmir", "İstanbul", "Ankara", "Manisa", "Aydın", "Muğla", "Denizli", "Balıkesir", "Bursa", "Antalya"];
function addrCity(a: string | null): { city: string | null; district: string | null } {
  const m = a ? new RegExp(`(${PROVINCES.join("|")})\\s+(\\S+)$`, "u").exec(a) : null;
  return m ? { city: m[1]!, district: cap(m[2]!)! } : { city: null, district: null };
}

/** Dosyanın sicil listesi olup olmadığı (başlıklarda Adı + Soyadı + TC Kimlik No) */
export async function isSicilWorkbook(buf: ArrayBuffer): Promise<boolean> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const keys = new Set<Key>();
  wb.worksheets[0]?.getRow(1).eachCell((c) => { const k = keyFor(String(c.value ?? "")); if (k) keys.add(k); });
  return keys.has("first") && keys.has("last") && keys.has("tc");
}

export async function parseSicilWorkbook(buf: ArrayBuffer): Promise<{ sheetName: string; rows: SicilRow[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel dosyasında sayfa yok");
  const cols = new Map<Key, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = keyFor(String(cell.value ?? ""));
    if (k && !cols.has(k)) cols.set(k, col);
  });
  if (!cols.has("first") || !cols.has("last")) throw new Error("'Adı' ve 'Soyadı' sütunları bulunamadı");
  const rows: SicilRow[] = [];
  ws.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const g = (k: Key) => (cols.has(k) ? row.getCell(cols.get(k)!).value : null);
    const first = cap(text(g("first")));
    if (!first) return;
    const dept = cap(text(g("dept")));
    const gender = norm(g("gender"));
    const ng = norm(g("netGross"));
    const occ = text(g("occCode"));
    const acc = (text(g("account")) ?? "").replace(/\s/g, "").toLocaleUpperCase("tr");
    rows.push({
      rowNo,
      firstName: first,
      lastName: cap(text(g("last"))) ?? "",
      gender: gender.startsWith("K") ? "Kadın" : gender.startsWith("E") ? "Erkek" : null,
      title: text(g("title")),
      department: dept && dept !== "Emekli" ? dept : null,
      retired: dept === "Emekli",
      sgkNo: digits(g("sgk")),
      nationalId: digits(g("tc")),
      fatherName: cap(text(g("father"))),
      motherName: cap(text(g("mother"))),
      birthPlace: cap(text(g("bplace"))),
      birthDate: isoDate(g("bdate")),
      ...addrCity(text(g("address"))),
      hireDate: isoDate(g("hire")),
      terminationDate: isoDate(g("exit")),
      terminationReason: text(g("exitReason")),
      address: text(g("address")),
      phone: phone(g("phone")),
      bankName: text(g("bank")),
      iban: /^TR\d{24}$/.test(acc) ? acc : null,
      bloodType: blood(g("blood")),
      occupationCode: occ && /^\d{4}\.\d{2}$/.test(occ) ? occ : null,
      occupationName: text(g("occName")),
      salary: num(g("salary")),
      netGross: ng === "N" || ng === "NET" ? "N" : ng === "B" || ng === "BRÜT" ? "B" : null,
    });
  });
  return { sheetName: ws.name, rows };
}
