import { describe, expect, it } from "vitest";
import { cellCents, cellDate, parseStatementWorkbook, sectionClosing } from "../src/supplier-statement";

const head = ["Tarih", "Ay", "Belge No", "Açıklama", "Hareket Tipi", "Ürün (Gözde adı)", "Miktar", "Birim", "Liste Fiyatı", "Borç", "Alacak", "Bakiye (formül)"];
const tlHead = ["Tarih", "Ay", "Açıklama", "Vade", "Hareket Tipi", "Borç", "Alacak", "Bakiye (formül)"];

describe("tedarikçi ekstresi ayrıştırma", () => {
  const euro: unknown[][] = [
    ["Gözde – Euro Cari"], ["kaynak"], [],
    head,
    [new Date(2026, 0, 1), "2026-01", 1, "DEVIR", "DEVIR", null, null, null, null, 16151.4, 0, 16151.4],
    [new Date(2026, 0, 5), "2026-01", 2, "HAVALE 250,000TL", "ODEME", null, null, null, null, 0, 5000, 11151.4],
    [new Date(2026, 0, 7), "2026-01", 3, "FATURAMIZ", "ALIS", "ALÇI TİP 4 - SARI", 6, "AD", 73, 438, 0, 0],
    [new Date(2026, 0, 7), "2026-01", 4, "FATURAMIZ", "ALIS", "CZR. ENAMEL 50GR E2", 1, "AD", 55, 55, 0, 0],
    [new Date(2026, 0, 7), "2026-01", 4, "FATURAMIZ", "ALIS", "CZR. ENAMEL 50GR E3", 1, "AD", 55, 55, 0, 0],
    [new Date(2026, 0, 19), "2026-01", 5, "FATURANIZ", "IADE", "YEŞİL TAŞ", 1, "KT", 6, 0, 6, 0],
    [new Date(2026, 0, 23), "2026-01", 6, "İSKONTO 1000EURO", "ISKONTO", null, null, null, null, 0, 1000, 0],
  ];
  const kdv: unknown[][] = [
    ["Gözde – KDV Cari"], [], [],
    tlHead,
    ["01.01.2026", "", "DEVIR", "01.01.2026", "DEVIR", 236740.5, 0],
    ["11.03.2026", "", "KDV 49.760TL", "11.03.2026", "KDV_BORC", 49760, 0],
    ["02.04.2026", "", "ÖDEME 276500 TL ÖDEME", "02.04.2026", "ODEME", 0, 286500.5],
  ];
  const items: unknown[][] = [
    ["Malzeme Kartları"], [], [],
    ["Kod", "Ürün (Gözde adı)", "Cari", "Birim", "İlk Liste Fiyatı", "Son Liste Fiyatı", "Fiyat Değişimi", "İskonto", "Net Fiyat", "İlk Alış", "Son Alış"],
    ["GZ-0001", "CZR. ENAMEL 50GR E2", "Euro", "AD", 55, 57, 0.036, 0.1, 51.3, 46029, 46316],
    ["GZ-0002", "SİGNUM COMPOSİTE ENAMEL ED", "Peşin", "AD", 25, 25, 0, 0, 25, 46029, 46316],
    ["GZ-0003", "ALÇI TİP 4 - SARI", "Euro", "AD", 73, 73, 0, 0.1, 65.7, 46029, 46090],
    ["GZ-0004", "ALÇI TİP 4 - SARI", "Peşin", "AD", 75, 75, 0, 0, 75, 46112, 46300],
  ];
  const r = parseStatementWorkbook({ "Özet": [["x"]], "Malzeme Kartları": items, "Euro Cari": euro, "KDV Cari": kdv });

  it("sayfaları carilere eşler", () => {
    expect(r.sections.map((s) => s.book)).toEqual(["slip", "vat"]);
    expect(r.warnings).toEqual([]);
  });
  it("aynı belgedeki alış satırlarını tek kalemli fişte toplar", () => {
    const e = r.sections[0]!;
    expect(e.slips).toHaveLength(2);
    expect(e.slips[1]!.lines.map((l) => l.name)).toEqual(["CZR. ENAMEL 50GR E2", "CZR. ENAMEL 50GR E3"]);
    expect(e.slips[0]!.lines[0]).toMatchObject({ qty: 6, unit: "AD", price: 7300, amount: 43800 });
    expect(e.slips[0]!.date).toBe("2026-01-07");
  });
  it("devir, ödeme, iade ve iskontoyu ayrı hareket olarak verir", () => {
    const e = r.sections[0]!;
    expect(e.moves.map((m) => m.tip)).toEqual(["DEVIR", "ODEME", "IADE", "ISKONTO"]);
    expect(e.opening).toBe(1615140);
    expect(sectionClosing(e)).toBe(1615140 - 500000 + 43800 + 11000 - 600 - 100000);
  });
  it("TL sayfası metin tarihleri ve KDV borcunu okur", () => {
    const k = r.sections[1]!;
    expect(k.moves.map((m) => [m.date, m.tip, m.debit, m.credit])).toEqual([
      ["2026-01-01", "DEVIR", 23674050, 0], ["2026-03-11", "KDV_BORC", 4976000, 0], ["2026-04-02", "ODEME", 0, 28650050],
    ]);
  });
  it("ürün listesinden kuralı ve son fiyatı alır; iki caride geçen ürün son alışın carisine gider", () => {
    expect(r.items).toEqual([
      { supplier_name: "CZR. ENAMEL 50GR E2", unit: "AD", route: "slip", price: 5700, currency: "EUR", price_date: "2026-10-21" },
      { supplier_name: "SİGNUM COMPOSİTE ENAMEL ED", unit: "AD", route: "nodisc", price: 2500, currency: "EUR", price_date: "2026-10-21" },
      { supplier_name: "ALÇI TİP 4 - SARI", unit: "AD", route: "nodisc", price: 7500, currency: "EUR", price_date: "2026-10-05" },
    ]);
  });
});

describe("hücre dönüştürme", () => {
  it("tutarlar", () => {
    expect(cellCents(16151.4)).toBe(1615140);
    expect(cellCents("1.278.079,50")).toBe(127807950);
    expect(cellCents("")).toBe(0);
    expect(cellCents("-")).toBe(0);
  });
  it("tarihler", () => {
    expect(cellDate("21.10.2026")).toBe("2026-10-21");
    expect(cellDate(46316)).toBe("2026-10-21");
    expect(cellDate(new Date(2026, 9, 21))).toBe("2026-10-21");
    expect(cellDate("")).toBeNull();
  });
});
