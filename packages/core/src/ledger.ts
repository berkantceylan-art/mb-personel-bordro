import type { Kurus } from "./money";

/**
 * Personel cari hesabı. Her kuruş tarihli bir hareket olarak tutulur;
 * kalan her an bu hareketlerden hesaplanır. Hareketler silinmez, iptal
 * edilir (voided).
 */
export type LedgerEntryType =
  | "ACCRUAL" // hakediş (alacak)
  | "BONUS" // prim / ikramiye (alacak)
  | "OVERTIME" // fazla mesai (alacak)
  | "ADVANCE" // avans (ödeme)
  | "SALARY" // maaş ödemesi
  | "BES" // BES kesintisi
  | "GARNISHMENT" // icra / nafaka kesintisi
  | "DEDUCTION" // borç / iş kesintisi
  | "ADJUSTMENT"; // düzeltme (+/-)

export type Channel = "BANK" | "CASH" | "NONE";

export interface LedgerEntry {
  id: string;
  period: string; // "2026-10"
  date: string; // ISO tarih, zorunlu
  type: LedgerEntryType;
  channel: Channel;
  /** Pozitif tutar; yönü türden gelir. ADJUSTMENT işaretli olabilir. */
  amount: Kurus;
  voided?: boolean;
}

const CREDIT: LedgerEntryType[] = ["ACCRUAL", "BONUS", "OVERTIME"];
const DEDUCTIONS: LedgerEntryType[] = ["BES", "GARNISHMENT", "DEDUCTION"];

export interface LedgerSummary {
  accrued: Kurus;
  paidBank: Kurus;
  paidCash: Kurus;
  deductions: Kurus;
  adjustments: Kurus;
  balance: Kurus;
}

export function signedAmount(e: LedgerEntry): Kurus {
  if (e.type === "ADJUSTMENT") return e.amount;
  return CREDIT.includes(e.type) ? e.amount : -e.amount;
}

export function summarize(entries: LedgerEntry[], period?: string): LedgerSummary {
  const s: LedgerSummary = {
    accrued: 0,
    paidBank: 0,
    paidCash: 0,
    deductions: 0,
    adjustments: 0,
    balance: 0,
  };
  for (const e of entries) {
    if (e.voided) continue;
    if (period && e.period !== period) continue;
    if (CREDIT.includes(e.type)) s.accrued += e.amount;
    else if (DEDUCTIONS.includes(e.type)) s.deductions += e.amount;
    else if (e.type === "ADJUSTMENT") s.adjustments += e.amount;
    else if (e.channel === "BANK") s.paidBank += e.amount;
    else if (e.channel === "CASH") s.paidCash += e.amount;
    s.balance += signedAmount(e);
  }
  return s;
}

/** Tarih sırasına göre hareketler ve her satırdan sonraki kalan. */
export function withRunningBalance(
  entries: LedgerEntry[],
): Array<LedgerEntry & { balanceAfter: Kurus }> {
  let bal = 0;
  return [...entries]
    .filter((e) => !e.voided)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((e) => {
      bal += signedAmount(e);
      return { ...e, balanceAfter: bal };
    });
}
