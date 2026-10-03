import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dailyTotals, pairPunches, parseDeviceFile } from "../src";

const text = readFileSync(
  fileURLToPath(new URL("./fixtures/hareketler-2026-10.txt", import.meta.url)),
  "utf8",
);

describe("cihaz dosyası", () => {
  const parsed = parseDeviceFile(text);

  it("tüm satırları okur, cihaz 002 giriş / 001 çıkış", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.punches).toHaveLength(271);
    expect(new Set(parsed.punches.map((p) => p.cardNo)).size).toBe(64);
    const first = parsed.punches[0]!;
    expect(first).toMatchObject({ device: "001", cardNo: "35167", direction: "OUT", at: "2026-10-02T12:06" });
    expect(parsed.punches[1]!.direction).toBe("IN");
  });

  it("hatalı satırları raporlar", () => {
    const r = parseDeviceFile("002,1,0,2026/10/02,12:00:00\nbozuk\n009,1,0,2026/10/02,12:00:00");
    expect(r.punches).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe("eşleştirme ve anomaliler", () => {
  const { punches } = parseDeviceFile(text);
  const known = new Set(punches.map((p) => p.cardNo).filter((c) => c !== "00001"));
  const r = pairPunches(punches, { knownCards: known });

  it("1 dakika arayla çift çıkış birleştirilir (35075)", () => {
    expect(
      r.anomalies.some((a) => a.kind === "DUPLICATE_MERGED" && a.cardNo === "35075"),
    ).toBe(true);
  });

  it("çıkışı olmayan giriş yakalanır (35168)", () => {
    expect(r.anomalies.some((a) => a.kind === "MISSING_OUT" && a.cardNo === "35168")).toBe(true);
  });

  it("tanımsız kart ayrı listelenir (00001)", () => {
    expect(r.anomalies.some((a) => a.kind === "UNKNOWN_CARD" && a.cardNo === "00001")).toBe(true);
  });

  it("gece boyunca sık çıkış uyarısı (35138)", () => {
    expect(r.anomalies.some((a) => a.kind === "FREQUENT_EXITS" && a.cardNo === "35138")).toBe(true);
  });

  it("gece vardiyası oturumu giriş gününe yazılır (35036: 23:59 → 04:53)", () => {
    const s = r.sessions.find((x) => x.cardNo === "35036");
    expect(s).toMatchObject({ inAt: "2026-10-02T23:59", outAt: "2026-10-03T04:53", workDate: "2026-10-02", minutes: 294 });
  });

  it("günlük toplam ve dışarıda geçen süre (35075, 3 Ekim)", () => {
    const d = dailyTotals(r.sessions).find((x) => x.cardNo === "35075" && x.workDate === "2026-10-03");
    expect(d).toMatchObject({ firstIn: "2026-10-03T07:54", lastOut: "2026-10-03T14:44", workedMinutes: 408, outsideMinutes: 2 });
  });
});
