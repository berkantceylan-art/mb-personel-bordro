/** Gelir tablosu ve nakit akış tablosu için ortak hesaplama (sayfa, Excel ve müşavir paketi aynı rakamı üretir) */

export type IsRow = { code: string; name: string; amount: number; from_cost: boolean };
export type IsLine = { label: string; kind: "section" | "line" | "total"; code?: string };

// Tek Düzen gelir tablosu kalemleri: [başlık, hesap grubu (2 hane)]
export const IS_SECTIONS: Array<[string, string]> = [
  ["A. BRÜT SATIŞLAR", "60"], ["B. SATIŞ İNDİRİMLERİ (-)", "61"], ["D. SATIŞLARIN MALİYETİ (-)", "62"], ["E. FAALİYET GİDERLERİ (-)", "63"],
  ["F. DİĞER FAALİYETLERDEN OLAĞAN GELİR VE KÂRLAR", "64"], ["G. DİĞER FAALİYETLERDEN OLAĞAN GİDER VE ZARARLAR (-)", "65"], ["H. FİNANSMAN GİDERLERİ (-)", "66"],
  ["J. OLAĞANDIŞI GELİR VE KÂRLAR", "67"], ["K. OLAĞANDIŞI GİDER VE ZARARLAR (-)", "68"],
];
const TOTAL_AFTER: Record<number, string> = { 1: "C. NET SATIŞLAR", 2: "BRÜT SATIŞ KÂRI VEYA ZARARI", 3: "FAALİYET KÂRI VEYA ZARARI", 6: "OLAĞAN KÂR VEYA ZARAR", 8: "DÖNEM KÂRI VEYA ZARARI" };

const sum = (rows: IsRow[], p: string) => rows.filter((r) => r.code.startsWith(p)).reduce((x, r) => x + Number(r.amount), 0);

/** Bir gelir tablosu satırının değeri (bölüm, alt kalem veya ara toplam) */
export function isValue(rows: IsRow[], l: IsLine): number {
  if (l.kind === "line") return rows.filter((r) => r.code === l.code).reduce((x, r) => x + Number(r.amount), 0);
  if (l.kind === "section") return sum(rows, l.code!);
  const net = sum(rows, "60") + sum(rows, "61");
  const gross = net + sum(rows, "62");
  const op = gross + sum(rows, "63");
  const ord = op + sum(rows, "64") + sum(rows, "65") + sum(rows, "66");
  const pre = ord + sum(rows, "67") + sum(rows, "68");
  return ({ "C. NET SATIŞLAR": net, "BRÜT SATIŞ KÂRI VEYA ZARARI": gross, "FAALİYET KÂRI VEYA ZARARI": op, "OLAĞAN KÂR VEYA ZARAR": ord, "DÖNEM KÂRI VEYA ZARARI": pre } as Record<string, number>)[l.label] ?? 0;
}

/** Karşılaştırmalı tablo için satır listesi: dönemlerin hepsinde geçen alt kalemler birleşir */
export function isLines(periods: IsRow[][]): Array<IsLine & { name?: string }> {
  const out: Array<IsLine & { name?: string }> = [];
  IS_SECTIONS.forEach(([t, p], i) => {
    out.push({ label: t, kind: "section", code: p });
    const codes = new Map<string, string>();
    for (const rows of periods) for (const r of rows) if (r.code.startsWith(p)) codes.set(r.code, r.name);
    for (const [code, name] of [...codes.entries()].sort()) out.push({ label: `${code} ${name}`, kind: "line", code, name });
    if (TOTAL_AFTER[i]) out.push({ label: TOTAL_AFTER[i]!, kind: "total" });
  });
  return out;
}

export type CashFlow = {
  from: string; to: string; opening: number; closing: number; operating: number; investing: number; financing: number;
  rows: Array<{ code: string; name: string; amount: number; section: "operating" | "investing" | "financing" }>;
};
export const CF_SECTIONS: Array<[CashFlow["rows"][number]["section"], string]> = [
  ["operating", "A. İşletme faaliyetlerinden nakit akışları"],
  ["investing", "B. Yatırım faaliyetlerinden nakit akışları"],
  ["financing", "C. Finansman faaliyetlerinden nakit akışları"],
];

/** Ay için karşılaştırma dönemleri */
export function comparePeriods(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return [
    { key: "month", label: "Bu ay", from: `${y}-${pad(m)}-01`, to: end(y, m) },
    { key: "prev", label: "Önceki ay", from: `${pm.y}-${pad(pm.m)}-01`, to: end(pm.y, pm.m) },
    { key: "ly_month", label: "Geçen yıl aynı ay", from: `${y - 1}-${pad(m)}-01`, to: end(y - 1, m) },
    { key: "ytd", label: "Yıl başından", from: `${y}-01-01`, to: end(y, m) },
    { key: "ly_ytd", label: "Geçen yıl aynı dönem", from: `${y - 1}-01-01`, to: end(y - 1, m) },
  ];
}

export const pctChange = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
