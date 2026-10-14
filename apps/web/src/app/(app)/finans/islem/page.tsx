import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { latestRates, loadAccounts, loadCategories, loadParties } from "@/lib/fin-data";
import { today } from "@/lib/fin";
import { TxnForm } from "./TxnForm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** İşlem gir: tahsilat, ödeme, virman, masraf, gelir */
export default async function NewTxnPage({ searchParams }: { searchParams: Promise<{ tur?: string; cari?: string; hesap?: string; kategori?: string; geri?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2 && (s.modules.expenses ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const [{ rows: accounts, error }, { rows: parties }, categories, { rates }] = await Promise.all([loadAccounts(), loadParties(), loadCategories(["income", "expense"]), latestRates()]);
  const supabase = await createClient();
  const { data: ibs } = await supabase.from("lab_customers").select("id, pay_book").eq("internal_book", true);
  const pname = new Map(parties.map((p) => [p.id, p.name]));
  const twinOf = new Map<string, string>();
  for (const p of parties) if (p.slip_of) { twinOf.set(p.id, pname.get(p.slip_of) ?? ""); twinOf.set(p.slip_of, p.name); }
  const ib = new Map((ibs ?? []).map((x) => [x.id as string, x.pay_book as string]));
  return (
    <>
      <PageHeader title="İşlem gir" subtitle="Tahsilat, ödeme, virman, masraf ve gelir kayıtları" />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        {!error && accounts.length === 0 && <Notice>Önce bir kasa ya da banka hesabı açın (Finans &gt; Kasa / Banka).</Notice>}
        <section className="bg-white border border-line rounded-[14px] p-5 md:p-6">
          <TxnForm
            accounts={accounts.filter((a) => a.is_active).map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, balance: a.balance }))}
            parties={parties.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, currency: p.currency, kind: p.kind, balance: p.balance, internalBook: !!p.lab_customer_id && ib.has(p.lab_customer_id), payBook: p.lab_customer_id ? ib.get(p.lab_customer_id) : undefined, twin: twinOf.get(p.id) }))}
            categories={categories.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
            rates={rates}
            today={today()}
            back={sp.geri?.startsWith("/") ? sp.geri : undefined}
            initial={{ kind: sp.tur, party: sp.cari, account: sp.hesap, category: sp.kategori }}
          />
        </section>
      </div>
    </>
  );
}
