/** Cari hesap ekstresi: işler borç, tahsilatlar alacak; yürüyen bakiye */

export type LedgerJob = { id: string; no: number; in_date: string; patient: string | null; total: number; status: string };
export type LedgerPayment = { id: string; paid_on: string; amount: number; method: string; ref: string | null; note: string | null };
export type LedgerRow = { key: string; date: string; kind: "job" | "payment" | "opening"; label: string; debit: number; credit: number; balance: number; href?: string; id?: string };

export const PAY_METHOD: Record<string, string> = { cash: "Nakit", bank: "Havale / EFT", card: "Kredi kartı", check: "Çek / senet", offset: "Mahsup", other: "Diğer" };

/** from..to aralığı için ekstre; aralık öncesi tutarlar "devir" satırı olur */
export function buildLedger(jobs: LedgerJob[], payments: LedgerPayment[], from?: string | null, to?: string | null): { rows: LedgerRow[]; debit: number; credit: number; balance: number } {
  const all: Omit<LedgerRow, "balance">[] = [
    ...jobs
      .filter((j) => j.status !== "cancelled")
      .map((j) => ({ key: `j${j.id}`, id: j.id, date: j.in_date, kind: "job" as const, label: `İş #${j.no}${j.patient ? ` · ${j.patient}` : ""}`, debit: Number(j.total) || 0, credit: 0, href: `/isler/${j.id}` })),
    ...payments.map((p) => ({ key: `p${p.id}`, id: p.id, date: p.paid_on, kind: "payment" as const, label: `Tahsilat · ${PAY_METHOD[p.method] ?? p.method}${p.ref ? ` · ${p.ref}` : ""}${p.note ? ` · ${p.note}` : ""}`, debit: 0, credit: Number(p.amount) || 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "job" ? -1 : 1));

  let bal = 0;
  let opening = 0;
  const rows: LedgerRow[] = [];
  for (const r of all) {
    if (from && r.date < from) {
      opening += r.debit - r.credit;
      continue;
    }
    if (to && r.date > to) continue;
    if (!rows.length && opening !== 0) {
      bal = opening;
      rows.push({ key: "open", date: from ?? r.date, kind: "opening", label: "Devir", debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: bal });
    }
    bal += r.debit - r.credit;
    rows.push({ ...r, balance: bal });
  }
  if (!rows.length && opening !== 0) rows.push({ key: "open", date: from ?? "", kind: "opening", label: "Devir", debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening });
  const debit = rows.reduce((a, r) => a + r.debit, 0);
  const credit = rows.reduce((a, r) => a + r.credit, 0);
  return { rows, debit, credit, balance: rows.length ? rows[rows.length - 1]!.balance : 0 };
}
