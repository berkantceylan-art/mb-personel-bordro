/** Cari hesap ekstresi: işler borç, tahsilatlar alacak; yürüyen bakiye */

export type LedgerJob = { id: string; no: number; in_date: string; patient: string | null; total: number; status: string; delivered_at?: string | null };

/** İş tutarı hekim carisine çıkışta (teslim) işlenir; tarih teslim tarihidir */
export const jobBilled = (j: { status: string }) => j.status === "delivered";
export const jobBillDate = (j: { in_date: string; delivered_at?: string | null }) => (j.delivered_at ? new Date(new Date(j.delivered_at).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) : j.in_date);
export type LedgerPayment = { id: string; paid_on: string; amount: number; method: string; ref: string | null; note: string | null; book?: string };

/** İç hesap kullanan müşteride iç cariye yalnız "iç" ve "ikisi" tahsilatları girer */
export const internalPays = <T extends { book?: string }>(pays: T[], internalBook: boolean) => (internalBook ? pays.filter((p) => p.book !== "official") : pays);
export const BOOK_LABEL: Record<string, string> = { official: "Resmi", internal: "İç", both: "Resmi + iç" };
export type LedgerRow = { key: string; date: string; kind: "job" | "payment" | "opening"; label: string; debit: number; credit: number; balance: number; href?: string; id?: string };

export const PAY_METHOD: Record<string, string> = { cash: "Nakit", bank: "Havale / EFT", card: "Kredi kartı", check: "Çek / senet", offset: "Mahsup", other: "Diğer" };

/** from..to aralığı için ekstre; aralık öncesi tutarlar "devir" satırı olur */
export function buildLedger(jobs: LedgerJob[], payments: LedgerPayment[], from?: string | null, to?: string | null, start?: { amount: number; date: string | null } | null): { rows: LedgerRow[]; debit: number; credit: number; balance: number } {
  const all: Omit<LedgerRow, "balance">[] = [
    ...(start && start.amount ? [{ key: "ob", date: start.date ?? "2000-01-01", kind: "opening" as const, label: "Açılış bakiyesi", debit: start.amount > 0 ? start.amount : 0, credit: start.amount < 0 ? -start.amount : 0 }] : []),
    ...jobs
      .filter(jobBilled)
      .map((j) => ({ key: `j${j.id}`, id: j.id, date: jobBillDate(j), kind: "job" as const, label: `İş #${j.no}${j.patient ? ` · ${j.patient}` : ""}`, debit: Number(j.total) || 0, credit: 0, href: `/isler/${j.id}` })),
    ...payments.map((p) => ({ key: `p${p.id}`, id: p.id, date: p.paid_on, kind: "payment" as const, label: `Tahsilat · ${PAY_METHOD[p.method] ?? p.method}${p.book === "both" ? " · resmi + iç" : p.book === "internal" ? " · iç" : ""}${p.ref ? ` · ${p.ref}` : ""}${p.note ? ` · ${p.note}` : ""}`, debit: 0, credit: Number(p.amount) || 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "opening" ? -1 : b.kind === "opening" ? 1 : a.kind === "job" ? -1 : 1));

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
