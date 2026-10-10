import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { CUSTOMER_KIND, money } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Cari hesaplar: hekim / hastane bazında iş tutarı, tahsilat ve bakiye */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; borclu?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: cs, error }, { data: jobs }, { data: pays, error: pe }] = await Promise.all([
    supabase.from("lab_customers").select("id, name, kind, currency, city, is_active").order("name"),
    supabase.from("jobs").select("customer_id, total, status").neq("status", "cancelled").limit(20000),
    supabase.from("lab_payments").select("customer_id, amount").limit(20000),
  ]);
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const j of jobs ?? []) debit.set(j.customer_id as string, (debit.get(j.customer_id as string) ?? 0) + Number(j.total));
  for (const p of pays ?? []) credit.set(p.customer_id as string, (credit.get(p.customer_id as string) ?? 0) + Number(p.amount));
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const rows = (cs ?? [])
    .map((c) => ({ ...c, debit: debit.get(c.id) ?? 0, credit: credit.get(c.id) ?? 0, balance: (debit.get(c.id) ?? 0) - (credit.get(c.id) ?? 0) }))
    .filter((c) => (!q || c.name.toLocaleLowerCase("tr").includes(q)) && (!sp.borclu || c.balance > 0))
    .sort((a, b) => b.balance - a.balance);
  const totals = (cur: string) => rows.filter((r) => r.currency === cur).reduce((a, r) => a + r.balance, 0);
  const th = "py-2.5 px-3 font-semibold border-b border-line text-left";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="Cari hesaplar" subtitle="İşler borç, tahsilatlar alacak olarak işlenir" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1200px]">
        {(error || pe) && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">Tablolar eksik: Supabase&apos;de 20261125000000_lab_jobs.sql ve 20261127000000_lab_accounts.sql çalıştırın.</p>}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-3">
          <Stat label="Toplam alacak (TL)" value={money(totals("TRY"), "TRY")} />
          <Stat label="Toplam alacak (€)" value={money(totals("EUR"), "EUR")} />
          <Stat label="Borçlu hesap" value={String(rows.filter((r) => r.balance > 0).length)} />
        </section>
        <form className="flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={sp.q} placeholder="Hekim / hastane ara" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm flex-1 min-w-48" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="borclu" value="1" defaultChecked={!!sp.borclu} className="w-5 h-5" />Yalnız borçlular</label>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ara</button>
        </form>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Hekim / hastane</th><th className={th}>Tür</th><th className={`${th} text-right`}>İş tutarı</th><th className={`${th} text-right`}>Tahsilat</th><th className={`${th} text-right`}>Bakiye</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                  <td className={td}><Link href={`/isler/hekimler/${r.id}`} className="font-semibold text-brand-700">{r.name}</Link>{r.city && <span className="text-xs text-muted"> · {r.city}</span>}</td>
                  <td className={td}>{CUSTOMER_KIND[r.kind] ?? r.kind}</td>
                  <td className={`${td} num text-right`}>{money(r.debit, r.currency)}</td>
                  <td className={`${td} num text-right text-ok`}>{money(r.credit, r.currency)}</td>
                  <td className={`${td} num text-right font-semibold ${r.balance > 0 ? "text-bad" : ""}`}>{money(r.balance, r.currency)}</td>
                  <td className={`${td} text-right`}><Link href={`/yazdir/ekstre/${r.id}`} className="text-xs font-semibold text-brand-700">Ekstre</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Kayıt yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
