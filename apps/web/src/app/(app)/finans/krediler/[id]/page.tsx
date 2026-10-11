import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, KPI, Money, Table, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { editLoanInst, payLoan, unpayLoan } from "@/lib/fin2-actions";

export const dynamic = "force-dynamic";

/** Kredi kartı: ödeme planı, taksit öde / geri al / düzelt */
export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.modules.finance ?? 0;
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("fin_loans").select("*, fin_accounts!fin_loans_account_id_fkey(id, name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const l = data as { id: string; bank_name: string | null; loan_no: string | null; principal: number; currency: string; annual_rate: number; tax_pct: number; term: number; method: string; start_date: string; status: string; note: string | null; fin_accounts: { id: string; name: string } | null };
  const [{ data: inst }, { data: banks }] = await Promise.all([
    supabase.from("fin_loan_installments").select("*").eq("loan_id", id).order("no"),
    supabase.from("fin_accounts").select("id, name, currency").in("kind", ["bank", "cash"]).eq("is_active", true).order("name"),
  ]);
  type I = { id: string; no: number; due_date: string; principal: number; interest: number; tax: number; paid_txn_id: string | null; paid_at: string | null; paid_total: number | null };
  const is = (inst ?? []) as I[];
  const t = today();
  const unpaid = is.filter((i) => !i.paid_txn_id);
  const sum = (a: I[], f: (i: I) => number) => a.reduce((x, i) => x + f(i), 0);
  const total = (i: I) => Number(i.principal) + Number(i.interest) + Number(i.tax);
  const next = unpaid[0];
  return (
    <>
      <PageHeader title={l.fin_accounts?.name ?? "Kredi"} subtitle={`${l.bank_name ?? ""} ${l.loan_no ?? ""} · %${Number(l.annual_rate).toLocaleString("tr-TR")} yıllık · ${l.term} ay`} actions={<Link href="/finans/krediler" className="text-sm font-semibold text-brand-700">← Krediler</Link>} />
      <div className={page}>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Kalan anapara" value={fmt(sum(unpaid, (i) => Number(i.principal)), l.currency)} tone="bad" />
          <KPI label="Kalan faiz + vergi" value={fmt(sum(unpaid, (i) => Number(i.interest) + Number(i.tax)), l.currency)} />
          <KPI label="Ödenen" value={fmt(sum(is.filter((i) => i.paid_txn_id), (i) => Number(i.paid_total ?? total(i))), l.currency)} sub={`${is.length - unpaid.length} / ${is.length} taksit`} tone="ok" />
          <KPI label="Sıradaki taksit" value={next ? fmt(total(next), l.currency) : "—"} sub={next ? formatDate(next.due_date) : "Kredi kapandı"} tone={next && next.due_date < t ? "bad" : undefined} />
        </div>
        {next && lvl >= 2 && (
          <form action={payLoan} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={next.id} />
            <b className="w-full">{next.no}. taksiti öde</b>
            <label className="flex flex-col gap-1 text-sm">Hesap<select name="account_id" required className={`${selectCls} w-64`}>{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">Tarih<input type="date" name="date" defaultValue={t} className={inputCls} /></label>
            <label className="flex flex-col gap-1 text-sm">Ödenen toplam<input name="total" defaultValue={(total(next) / 100).toFixed(2).replace(".", ",")} inputMode="decimal" className={`${inputCls} w-40 text-right`} /></label>
            <PendingSubmit className={btnPrimary}>Ödendi</PendingSubmit>
            <span className="text-xs text-muted w-full">Gecikme faizi vb. fazlası faiz giderine yazılır.</span>
          </form>
        )}
        <Table head={["#", "Vade", "Anapara", "Faiz", "BSMV/KKDF", "Taksit", "Durum", ""]} min={860}>
          {is.map((i) => (
            <tr key={i.id} className={i.paid_txn_id ? "bg-[#F7FBF8]" : ""}>
              <td className={`${td} text-muted`}>{i.no}</td>
              <td className={`${td} ${!i.paid_txn_id && i.due_date < t ? "text-bad font-semibold" : ""}`}>{formatDate(i.due_date)}</td>
              <td className={tdNum}><Money v={i.principal} cur={l.currency} /></td>
              <td className={tdNum}><Money v={i.interest} cur={l.currency} /></td>
              <td className={tdNum}><Money v={i.tax} cur={l.currency} /></td>
              <td className={tdNum}><Money v={total(i)} cur={l.currency} strong /></td>
              <td className={td}>{i.paid_txn_id ? <Chip tone="green">Ödendi {i.paid_at ? formatDate(i.paid_at) : ""}</Chip> : <Chip tone={i.due_date < t ? "red" : "gray"}>{i.due_date < t ? "Gecikmiş" : "Bekliyor"}</Chip>}</td>
              <td className={`${td} text-right`}>
                {i.paid_txn_id && lvl >= 3 && <form action={unpayLoan}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit label="Geri al" question="Ödeme geri alınsın mı?" /></form>}
                {!i.paid_txn_id && lvl >= 3 && (
                  <details className="text-left">
                    <summary className="text-xs font-semibold text-brand-700 cursor-pointer">Düzelt</summary>
                    <form action={editLoanInst} className="flex flex-col gap-1 mt-1 w-44">
                      <input type="hidden" name="id" value={i.id} />
                      <input type="date" name="due_date" defaultValue={i.due_date} className={`${inputCls} h-8`} />
                      <input name="principal" defaultValue={(i.principal / 100).toFixed(2).replace(".", ",")} aria-label="Anapara" className={`${inputCls} h-8`} />
                      <input name="interest" defaultValue={(i.interest / 100).toFixed(2).replace(".", ",")} aria-label="Faiz" className={`${inputCls} h-8`} />
                      <input name="tax" defaultValue={(i.tax / 100).toFixed(2).replace(".", ",")} aria-label="Vergi" className={`${inputCls} h-8`} />
                      <PendingSubmit className="text-xs font-semibold text-brand-700 text-left">Kaydet</PendingSubmit>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {l.fin_accounts && <Link href={`/finans/hesap/${l.fin_accounts.id}`} className="text-sm font-semibold text-brand-700">Kredi hesabı hareketleri →</Link>}
      </div>
    </>
  );
}
