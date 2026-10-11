import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { accountLedger } from "@/lib/fin-data";
import { ACCOUNT_KIND, dateOk, fmt, type Account } from "@/lib/fin";
import { AccountForm } from "../../_parts/AccountForm";
import { DateFilter } from "../../_parts/DateFilter";
import { LedgerTable } from "../../_parts/LedgerTable";

export const dynamic = "force-dynamic";

/** Hesap ekstresi: kasa, banka, kart, kredi, ortak, avans */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("fin_accounts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Account;
  const from = dateOk(sp.bas);
  const to = dateOk(sp.bit);
  const led = await accountLedger(a, from, to);
  const liability = ACCOUNT_KIND[a.kind]?.liability;
  let employees: { id: string; name: string }[] = [];
  if (a.kind === "advance") {
    const { data: e } = await supabase.from("employees").select("id, first_name, last_name").eq("status", "active");
    employees = (e ?? []).map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}` }));
  }
  const back = ACCOUNT_KIND[a.kind]?.href ?? "/finans";
  const canPost = (s.modules.finance ?? 0) >= 2;
  return (
    <>
      <PageHeader title={a.name} subtitle={`${ACCOUNT_KIND[a.kind]?.label} · ${a.currency}${a.bank_name ? ` · ${a.bank_name}` : ""}`} actions={<Link href={back} className="text-sm font-semibold text-brand-700">← Liste</Link>} />
      <div className={page}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label={liability ? "Güncel borç" : "Bakiye"} value={fmt(liability ? -led.balance : led.balance, a.currency)} tone={!liability && led.balance < 0 ? "bad" : undefined} />
          <KPI label="Dönem girişi" value={fmt(led.debit, a.currency)} />
          <KPI label="Dönem çıkışı" value={fmt(led.credit, a.currency)} />
          {a.kind === "credit_card" && a.card_limit ? <KPI label="Kullanılabilir limit" value={fmt(Number(a.card_limit) + led.balance, a.currency)} /> : <KPI label="Açılış" value={fmt(a.opening_balance, a.currency)} sub={a.opening_date} />}
        </div>
        {canPost && (
          <div className="flex flex-wrap gap-2 text-sm">
            {[["collection", "Tahsilat"], ["payment", "Ödeme"], ["transfer", "Virman"], ["expense", "Masraf"], ["income", "Gelir"]].map(([k, l]) => (
              <Link key={k} href={`/finans/islem?tur=${k}&hesap=${a.id}&geri=/finans/hesap/${a.id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700 hover:border-brand-600">+ {l}</Link>
            ))}
          </div>
        )}
        <DateFilter from={from ?? undefined} to={to ?? undefined} />
        <LedgerTable rows={led.rows} currency={a.currency} canVoid={(s.modules.finance ?? 0) >= 2} debitLabel="Giriş" creditLabel="Çıkış" total={led} />
        {(s.modules.finance ?? 0) >= 3 && (
          <Card title="Hesap bilgileri">
            <AccountForm kind={a.kind} account={a} employees={employees} />
          </Card>
        )}
      </div>
    </>
  );
}
