/** Kredi ödeme planı (eşit taksit / eşit anapara). Tutarlar kuruş. */
export type Inst = { no: number; due_date: string; principal: number; interest: number; tax: number };

export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function schedule(o: { principal: number; annualRate: number; taxPct: number; term: number; firstDue: string; method: "annuity" | "equal_principal" }): Inst[] {
  const n = Math.max(1, Math.min(240, Math.round(o.term)));
  const r = Math.max(0, o.annualRate) / 100 / 12;
  let rest = Math.round(o.principal);
  const out: Inst[] = [];
  const pay = r > 0 ? (o.principal * r) / (1 - Math.pow(1 + r, -n)) : o.principal / n;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(rest * r);
    let principal = o.method === "annuity" ? Math.round(pay - rest * r) : Math.round(o.principal / n);
    if (i === n) principal = rest;
    principal = Math.min(principal, rest);
    rest -= principal;
    out.push({ no: i, due_date: addMonths(o.firstDue, i - 1), principal, interest, tax: Math.round((interest * Math.max(0, o.taxPct)) / 100) });
  }
  return out;
}
