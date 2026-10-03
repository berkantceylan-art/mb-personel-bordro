import { describe, expect, it } from "vitest";
import { summarize, tl, withRunningBalance, type LedgerEntry } from "../src";

// Tasarımdaki örnek: Eylül 2026, toplam 100.000, asgari ücretli
const entries: LedgerEntry[] = [
  { id: "1", period: "2026-09", date: "2026-09-01", type: "ACCRUAL", channel: "NONE", amount: tl(100000) },
  { id: "2", period: "2026-09", date: "2026-09-05", type: "ADVANCE", channel: "CASH", amount: tl(10000) },
  { id: "3", period: "2026-09", date: "2026-09-15", type: "ADVANCE", channel: "BANK", amount: tl(15000) },
  { id: "4", period: "2026-09", date: "2026-09-20", type: "ADVANCE", channel: "CASH", amount: tl(5000) },
  { id: "5", period: "2026-09", date: "2026-09-30", type: "BES", channel: "NONE", amount: tl(990.9) },
  { id: "6", period: "2026-09", date: "2026-09-30", type: "GARNISHMENT", channel: "NONE", amount: tl(7018.88) },
  { id: "7", period: "2026-09", date: "2026-10-01", type: "SALARY", channel: "BANK", amount: tl(5065.72) },
  { id: "8", period: "2026-09", date: "2026-10-02", type: "SALARY", channel: "CASH", amount: tl(50000) },
  { id: "9", period: "2026-09", date: "2026-10-02", type: "ADVANCE", channel: "CASH", amount: tl(999), voided: true },
];

describe("cari hesap", () => {
  it("dönem özeti kanal bazında doğru", () => {
    const s = summarize(entries, "2026-09");
    expect(s.accrued).toBe(tl(100000));
    expect(s.paidBank).toBe(tl(20065.72));
    expect(s.paidCash).toBe(tl(65000));
    expect(s.deductions).toBe(tl(8009.78));
    expect(s.balance).toBe(tl(6924.5));
  });

  it("iptal edilen hareket hesaba girmez, kalan her satırda izlenir", () => {
    const rows = withRunningBalance(entries);
    expect(rows).toHaveLength(8);
    expect(rows[rows.length - 1]!.balanceAfter).toBe(tl(6924.5));
    expect(rows[1]!.balanceAfter).toBe(tl(90000));
  });
});
