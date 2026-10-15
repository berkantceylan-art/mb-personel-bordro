import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Field, Notice, btnPrimary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glCashCount } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Cnt = { id: string; account_id: string; count_date: string; counted: number; book: number; diff: number; counted_by: string | null; note: string | null; fin_accounts: { name: string; currency: string } | null };

/** Kasa sayım tutanağı: sayılan tutar ile defter bakiyesi; fark kasaya noksan / fazla olarak işlenir */
export default async function CashCount({ searchParams }: { searchParams: Promise<{ tarih?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const date = sp.tarih && /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih) ? sp.tarih : todayIso();
  const supabase = await createClient();
  const [{ data: acc }, { data: cnt, error }] = await Promise.all([
    supabase.from("fin_accounts").select("id, name, currency").eq("kind", "cash").eq("is_active", true).order("name"),
    supabase.from("gl_cash_counts").select("id, account_id, count_date, counted, book, diff, counted_by, note, fin_accounts(name, currency)").order("count_date", { ascending: false }).limit(60),
  ]);
  const accounts = (acc ?? []) as Array<{ id: string; name: string; currency: string }>;
  const balances = await Promise.all(accounts.map(async (a) => Number((await supabase.rpc("fin_account_balance_at", { p_account: a.id, p_date: date })).data ?? 0)));
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.ledger ?? 0) >= 2;
  return (
    <>
      <PageHeader title="Kasa sayım tutanağı" subtitle="Sayılan nakit ile kayıtlı bakiye karşılaştırılır; fark kasaya işlenir" actions={<Link href="/muhasebe/donem-sonu" className="text-sm font-semibold text-brand-700">Dönem sonu işlemleri</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270216000000_provisions.sql çalıştırılmalı.</Notice>}
        <Card title={`Kasalar · ${formatDate(date)} itibarıyla`}>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Kasa</th><th className={`${th} text-right`}>Kayıtlı bakiye</th></tr></thead>
            <tbody>{accounts.map((a, i) => <tr key={a.id}><td className={td}>{a.name}</td><td className={tdNum}>{fmt(balances[i], a.currency)}</td></tr>)}</tbody>
          </table></div>
          <form className="flex gap-2"><input type="date" name="tarih" defaultValue={date} className={`${inputCls} w-44`} /><button className="text-sm font-semibold text-brand-700">Tarihi değiştir</button></form>
        </Card>
        {canEdit && accounts.length > 0 && (
          <Card title="Sayım gir">
            <form action={glCashCount} className="grid gap-3 md:grid-cols-3">
              <Field label="Kasa"><select name="account_id" className={selectCls}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
              <Field label="Sayım tarihi"><input type="date" name="date" defaultValue={date} className={inputCls} /></Field>
              <Field label="Sayılan tutar"><input name="counted" required inputMode="decimal" placeholder="0,00" className={inputCls} /></Field>
              <Field label="Sayan"><input name="counted_by" maxLength={120} className={inputCls} /></Field>
              <Field label="Not" className="md:col-span-2"><input name="note" maxLength={300} className={inputCls} /></Field>
              <div className="md:col-span-3"><PendingSubmit className={btnPrimary}>Sayımı kaydet</PendingSubmit></div>
            </form>
            <p className="text-xs text-muted">Fark varsa kasaya düzeltme kaydı atılır: noksan 197 Sayım ve Tesellüm Noksanları, fazla 397 Sayım ve Tesellüm Fazlaları. Nedeni bulununca mali müşavirle kapatın.</p>
          </Card>
        )}
        <Card title="Geçmiş sayımlar">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Kasa</th><th className={`${th} text-right`}>Sayılan</th><th className={`${th} text-right`}>Kayıtlı</th><th className={`${th} text-right`}>Fark</th><th className={th}>Sayan / not</th></tr></thead>
            <tbody>
              {((cnt ?? []) as unknown as Cnt[]).map((c) => <tr key={c.id}><td className={td}>{formatDate(c.count_date)}</td><td className={td}>{c.fin_accounts?.name}</td><td className={tdNum}>{fmt(c.counted, c.fin_accounts?.currency)}</td><td className={tdNum}>{fmt(c.book, c.fin_accounts?.currency)}</td><td className={`${tdNum} ${c.diff ? "text-bad font-semibold" : ""}`}>{fmt(c.diff, c.fin_accounts?.currency)}</td><td className={`${td} text-xs`}>{[c.counted_by, c.note].filter(Boolean).join(" · ")}</td></tr>)}
              {!(cnt ?? []).length && <tr><td colSpan={6} className="py-6 text-center text-muted">Sayım yok.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
