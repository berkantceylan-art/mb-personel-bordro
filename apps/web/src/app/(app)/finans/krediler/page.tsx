import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, KPI, Money, Notice, Table, page, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { LoanForm } from "./LoanForm";

export const dynamic = "force-dynamic";

/** Krediler: kalan anapara, sıradaki taksit, ödeme planı */
export default async function LoansPage() {
  const s = await getSession();
  const lvl = s.modules.finance ?? 0;
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, { data: inst }, { data: banks }] = await Promise.all([
    supabase.from("fin_loans").select("id, bank_name, loan_no, principal, currency, annual_rate, term, status, start_date, fin_accounts!fin_loans_account_id_fkey(name)").order("start_date", { ascending: false }),
    supabase.from("fin_loan_installments").select("loan_id, no, due_date, principal, interest, tax, paid_txn_id").order("due_date").limit(5000),
    supabase.from("fin_accounts").select("id, name, currency").in("kind", ["bank", "cash"]).eq("is_active", true).order("name"),
  ]);
  type L = { id: string; bank_name: string | null; loan_no: string | null; principal: number; currency: string; annual_rate: number; term: number; status: string; start_date: string; fin_accounts: { name: string } | null };
  type I = { loan_id: string; no: number; due_date: string; principal: number; interest: number; tax: number; paid_txn_id: string | null };
  const loans = (data ?? []) as unknown as L[];
  const is = (inst ?? []) as I[];
  const t = today();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const unpaid = is.filter((i) => !i.paid_txn_id);
  const total = (i: I) => Number(i.principal) + Number(i.interest) + Number(i.tax);
  const byCur = new Map<string, number>();
  for (const l of loans) byCur.set(l.currency, (byCur.get(l.currency) ?? 0) + unpaid.filter((i) => i.loan_id === l.id).reduce((x, i) => x + Number(i.principal), 0));
  const cur = (id: string) => loans.find((l) => l.id === id)?.currency ?? "TRY";
  return (
    <>
      <PageHeader title="Krediler" subtitle="Banka kredileri, ödeme planı, taksit ödemesinde anapara / faiz ayrımı" />
      <div className={page}>
        {error && <Notice tone="bad">Kredi tabloları yok: Supabase&apos;de 20261205000000_finance_more.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[...byCur.entries()].map(([c, v]) => <KPI key={c} label={`Kalan anapara (${c})`} value={fmt(v, c)} tone="bad" />)}
          <KPI label="30 gün içinde taksit" value={unpaid.filter((i) => i.due_date <= in30).length} sub={unpaid.filter((i) => i.due_date < t).length ? `${unpaid.filter((i) => i.due_date < t).length} gecikmiş` : undefined} tone={unpaid.some((i) => i.due_date < t) ? "bad" : undefined} />
        </div>
        <Table head={["Kredi", "Anapara", "Faiz", "Kalan anapara", "Sıradaki taksit", "Durum"]} min={820}>
          {loans.map((l) => {
            const u = unpaid.filter((i) => i.loan_id === l.id);
            const next = u[0];
            return (
              <tr key={l.id}>
                <td className={td}><Link href={`/finans/krediler/${l.id}`} className="font-semibold text-brand-700">{l.fin_accounts?.name ?? l.bank_name}</Link><span className="block text-xs text-muted">{l.bank_name} {l.loan_no ?? ""} · {formatDate(l.start_date)}</span></td>
                <td className={tdNum}><Money v={l.principal} cur={l.currency} /></td>
                <td className={tdNum}>%{Number(l.annual_rate).toLocaleString("tr-TR")}</td>
                <td className={tdNum}><Money v={u.reduce((x, i) => x + Number(i.principal), 0)} cur={l.currency} strong /></td>
                <td className={`${td} ${next && next.due_date < t ? "text-bad font-semibold" : ""}`}>{next ? <>{formatDate(next.due_date)} · {fmt(total(next), cur(l.id))} <span className="text-xs text-muted">({next.no}/{l.term})</span></> : "—"}</td>
                <td className={td}><Chip tone={l.status === "closed" ? "green" : "amber"}>{l.status === "closed" ? "Kapandı" : `${u.length} taksit kaldı`}</Chip></td>
              </tr>
            );
          })}
          {loans.length === 0 && <EmptyRow cols={6} text="Kredi yok." />}
        </Table>
        {lvl >= 3 && <Card title="Yeni kredi"><LoanForm banks={(banks ?? []) as { id: string; name: string; currency: string }[]} today={t} /></Card>}
      </div>
    </>
  );
}
