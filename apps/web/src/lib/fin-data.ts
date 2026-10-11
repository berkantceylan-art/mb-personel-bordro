import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Account, Category, Party } from "@/lib/fin";

export type AccountRow = Account & { balance: number; balance_try: number };
export type PartyRow = Party & { balance: number };
export type LedgerLine = { key: string; date: string; label: string; sub?: string; debit: number; credit: number; balance: number; href?: string; txnId?: string; voidable?: boolean; kind?: string };

/** Hesaplar + bakiyeler (iptal edilenler hariç) */
export async function loadAccounts(kinds?: string[]): Promise<{ rows: AccountRow[]; error: string | null }> {
  const supabase = await createClient();
  let q = supabase.from("fin_accounts").select("*").order("sort").order("name");
  if (kinds?.length) q = q.in("kind", kinds);
  const [{ data, error }, { data: bal }] = await Promise.all([q, supabase.from("fin_account_balances").select("account_id, balance, balance_try")]);
  const bmap = new Map((bal ?? []).map((b) => [b.account_id as string, b]));
  return {
    rows: ((data ?? []) as Account[]).map((a) => ({ ...a, balance: Number(bmap.get(a.id)?.balance ?? a.opening_balance), balance_try: Number(bmap.get(a.id)?.balance_try ?? 0) })),
    error: error?.message ?? null,
  };
}

export async function loadParties(): Promise<{ rows: PartyRow[]; error: string | null }> {
  const supabase = await createClient();
  const [{ data, error }, { data: bal }] = await Promise.all([
    supabase.from("fin_parties").select("*").order("name"),
    supabase.from("fin_party_balances").select("party_id, balance"),
  ]);
  const bmap = new Map((bal ?? []).map((b) => [b.party_id as string, Number(b.balance)]));
  return { rows: ((data ?? []) as Party[]).map((p) => ({ ...p, balance: bmap.get(p.id) ?? p.opening_balance })), error: error?.message ?? null };
}

export async function loadCategories(kinds?: string[]): Promise<Category[]> {
  const supabase = await createClient();
  let q = supabase.from("fin_categories").select("id, code, name, kind, is_system, is_active, sort").order("kind").order("sort").order("name");
  if (kinds?.length) q = q.in("kind", kinds);
  const { data } = await q;
  return (data ?? []) as Category[];
}

/** Son kurlar: { EUR: 48.49, USD: 41.68 } */
export async function latestRates(): Promise<{ rates: Record<string, number>; date: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.from("fx_rates").select("rate_date, currency, selling").order("rate_date", { ascending: false }).limit(40);
  const rates: Record<string, number> = { TRY: 1 };
  let date: string | null = null;
  for (const r of data ?? []) {
    if (!(r.currency in rates)) rates[r.currency as string] = Number(r.selling);
    date ??= r.rate_date as string;
  }
  return { rates, date };
}

type MoveRow = { id: number; amount: number; move_date: string; description: string | null; fin_txns: { id: string; no: number; kind: string; description: string | null; doc_no: string | null; voided_at: string | null } | null };

function runLedger(opening: number, openingDate: string | null, lines: Omit<LedgerLine, "balance">[], from?: string | null, to?: string | null) {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  let bal = opening;
  let carried = opening;
  const out: LedgerLine[] = [];
  for (const l of sorted) {
    if (from && l.date < from) {
      carried += l.debit - l.credit;
      bal = carried;
      continue;
    }
    if (to && l.date > to) continue;
    if (!out.length) out.push({ key: "devir", date: from ?? openingDate ?? l.date, label: from ? "Devir" : "Açılış bakiyesi", debit: carried > 0 ? carried : 0, credit: carried < 0 ? -carried : 0, balance: carried });
    bal += l.debit - l.credit;
    out.push({ ...l, balance: bal });
  }
  if (!out.length) out.push({ key: "devir", date: from ?? openingDate ?? "", label: from ? "Devir" : "Açılış bakiyesi", debit: carried > 0 ? carried : 0, credit: carried < 0 ? -carried : 0, balance: carried });
  return { rows: out, balance: out[out.length - 1]!.balance, debit: out.slice(1).reduce((a, r) => a + r.debit, 0), credit: out.slice(1).reduce((a, r) => a + r.credit, 0) };
}

/** Hesap ekstresi: giriş borç (+), çıkış alacak (−) */
export async function accountLedger(account: Account, from?: string | null, to?: string | null) {
  const supabase = await createClient();
  const { data } = await supabase.from("fin_moves").select("id, amount, move_date, description, fin_txns(id, no, kind, description, doc_no, voided_at)").eq("account_id", account.id).order("move_date").order("id").limit(5000);
  const lines = ((data ?? []) as unknown as MoveRow[])
    .filter((m) => m.fin_txns && !m.fin_txns.voided_at)
    .map((m) => ({
      key: `m${String(m.id).padStart(12, "0")}`,
      date: m.move_date,
      label: m.fin_txns!.description || m.description || "",
      sub: `#${m.fin_txns!.no}${m.fin_txns!.doc_no ? ` · ${m.fin_txns!.doc_no}` : ""}`,
      kind: m.fin_txns!.kind,
      debit: m.amount > 0 ? Number(m.amount) : 0,
      credit: m.amount < 0 ? -Number(m.amount) : 0,
      txnId: m.fin_txns!.id,
      voidable: true,
    }));
  return runLedger(Number(account.opening_balance), account.opening_date, lines, from, to);
}

/** Cari ekstre: borç (+) bize borçlandı, alacak (−); hekim kartına bağlıysa işler ve eski tahsilatlar da */
export async function partyLedger(party: Party, from?: string | null, to?: string | null) {
  const supabase = await createClient();
  const [{ data: moves }, jobsRes, paysRes] = await Promise.all([
    supabase.from("fin_moves").select("id, amount, move_date, description, fin_txns(id, no, kind, description, doc_no, voided_at)").eq("party_id", party.id).order("move_date").limit(5000),
    party.lab_customer_id ? supabase.from("jobs").select("id, no, in_date, patient, total, status").eq("customer_id", party.lab_customer_id).neq("status", "cancelled").limit(5000) : Promise.resolve({ data: [] as { id: string; no: number; in_date: string; patient: string | null; total: number; status: string }[] }),
    party.lab_customer_id ? supabase.from("lab_payments").select("id, paid_on, amount, method, ref, note").eq("customer_id", party.lab_customer_id).is("fin_txn_id", null).limit(5000) : Promise.resolve({ data: [] as { id: string; paid_on: string; amount: number; method: string; ref: string | null; note: string | null }[] }),
  ]);
  const lines: Omit<LedgerLine, "balance">[] = [
    ...((moves ?? []) as unknown as MoveRow[])
      .filter((m) => m.fin_txns && !m.fin_txns.voided_at)
      .map((m) => ({
        key: `m${String(m.id).padStart(12, "0")}`, date: m.move_date, label: m.fin_txns!.description || m.description || "", sub: `#${m.fin_txns!.no}${m.fin_txns!.doc_no ? ` · ${m.fin_txns!.doc_no}` : ""}`,
        kind: m.fin_txns!.kind, debit: m.amount > 0 ? Number(m.amount) : 0, credit: m.amount < 0 ? -Number(m.amount) : 0, txnId: m.fin_txns!.id, voidable: true,
      })),
    ...(jobsRes.data ?? []).map((j) => ({ key: `j${j.in_date}${j.no}`, date: j.in_date, label: `İş #${j.no}${j.patient ? ` · ${j.patient}` : ""}`, kind: "job", debit: Number(j.total) || 0, credit: 0, href: `/isler/${j.id}` })),
    ...(paysRes.data ?? []).map((p) => ({ key: `p${p.paid_on}${p.id}`, date: p.paid_on, label: `Tahsilat (hekim kartından)${p.ref ? ` · ${p.ref}` : ""}${p.note ? ` · ${p.note}` : ""}`, kind: "collection", debit: 0, credit: Number(p.amount) || 0 })),
  ];
  return runLedger(Number(party.opening_balance), party.opening_date, lines, from, to);
}
