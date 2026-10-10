import Link from "next/link";
import { ACCT_UI, fmtMoney, type LJob, type LPay } from "@/lib/portal-account-ui";
import { formatDate, portalContext, portalLocale } from "@/lib/portal";
import { PrintButton } from "@/components/portal/PrintButton";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Account" };

/** Hekim / klinik / aracı: işler, ekstre, bakiye */
export default async function PortalAccount({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const a = ACCT_UI[locale];
  const tab = (await searchParams).sekme === "ekstre" ? "ekstre" : "isler";
  const supabase = await createClient();
  const { data: cust } = await supabase.from("lab_customers").select("id, name, currency").eq("portal_account_id", acc.id).maybeSingle();
  if (!cust) {
    return (
      <>
        <h1 className="display text-3xl font-semibold text-navy">{a.title}</h1>
        <p className="mt-4 max-w-2xl rounded-2xl bg-white p-6 text-slate">{a.notLinked}</p>
      </>
    );
  }
  const cur = cust.currency as string;
  const [{ data: js }, { data: ps }] = await Promise.all([
    supabase.from("jobs").select("id, no, in_date, due_date, patient, doctor_name, total, currency, status, delivered_at").eq("customer_id", cust.id).order("no", { ascending: false }).limit(5000),
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref").eq("customer_id", cust.id).order("paid_on").limit(5000),
  ]);
  const jobs = (js ?? []) as LJob[];
  const pays = (ps ?? []) as LPay[];
  const billed = jobs.filter((j) => j.status !== "cancelled").reduce((x, j) => x + Number(j.total), 0);
  const paid = pays.reduce((x, p) => x + Number(p.amount), 0);
  // Ekstre satırları (eskiden yeniye, yürüyen bakiye)
  const lines = [
    ...jobs.filter((j) => j.status !== "cancelled").map((j) => ({ key: `j${j.id}`, date: j.in_date, desc: `${a.job} #${j.no}${j.patient ? ` · ${j.patient}` : ""}`, debit: Number(j.total), credit: 0 })),
    ...pays.map((p) => ({ key: `p${p.id}`, date: p.paid_on, desc: `${a.payment} · ${a.methods[p.method] ?? p.method}${p.ref ? ` · ${p.ref}` : ""}`, debit: 0, credit: Number(p.amount) })),
  ].sort((x, y) => x.date.localeCompare(y.date));
  let bal = 0;
  const rows = lines.map((l) => ({ ...l, bal: (bal += l.debit - l.credit) }));
  const months = [...new Set(jobs.map((j) => j.in_date.slice(0, 7)))].sort().reverse();
  const tabCls = (on: boolean) => `rounded-full px-4 py-2 text-sm font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy"}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="display text-3xl font-semibold text-navy">{a.title}</h1>
          <p className="mt-1 text-slate">{a.lead}</p>
        </div>
        {months.length > 0 && (
          <form action="/portal/hesap/proforma" className="flex items-center gap-2">
            <select name="ay" defaultValue={months[0]} className="field h-10 py-0" aria-label={a.month}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="rounded-full bg-smile px-4 py-2 text-sm font-semibold text-navy hover:bg-navy hover:text-white">{a.proforma}</button>
          </form>
        )}
      </div>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {[[a.balance, bal || billed - paid], [a.billed, billed], [a.paid, paid]].map(([l, v], i) => (
          <div key={i} className="rounded-2xl bg-white p-5">
            <p className="text-sm text-slate">{l as string}</p>
            <p className={`num mt-1 text-2xl font-semibold ${i === 0 && Number(v) > 0 ? "text-bad" : "text-navy"}`}>{fmtMoney(Number(v), cur, locale)}</p>
          </div>
        ))}
      </section>
      <nav className="mt-6 flex gap-2 print:hidden">
        <Link href="/portal/hesap" className={tabCls(tab === "isler")}>{a.jobs}</Link>
        <Link href="/portal/hesap?sekme=ekstre" className={tabCls(tab === "ekstre")}>{a.statement}</Link>
        {tab === "ekstre" && <span className="ml-auto"><PrintButton label={a.print} /></span>}
      </nav>
      <section className="mt-4 overflow-x-auto rounded-2xl bg-white p-2">
        {tab === "isler" ? (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-slate"><th className="p-3">{a.no}</th><th className="p-3">{a.patient}</th><th className="p-3">{a.doctor}</th><th className="p-3">{a.inDate}</th><th className="p-3">{a.due}</th><th className="p-3 text-right">{a.amount}</th><th className="p-3">{a.status}</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-gypsum">
                  <td className="num p-3 font-semibold text-navy">#{j.no}</td>
                  <td className="p-3">{j.patient ?? "—"}</td>
                  <td className="p-3">{j.doctor_name ?? "—"}</td>
                  <td className="p-3">{formatDate(j.in_date, locale)}</td>
                  <td className="p-3">{j.due_date ? formatDate(j.due_date, locale) : "—"}</td>
                  <td className="num p-3 text-right">{fmtMoney(j.total, j.currency, locale)}</td>
                  <td className="p-3"><span className="rounded-full bg-gypsum px-2.5 py-1 text-xs font-semibold">{a.jobStatus[j.status] ?? j.status}</span></td>
                </tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate">{a.empty}</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-slate"><th className="p-3">{a.date}</th><th className="p-3">{a.desc}</th><th className="p-3 text-right">{a.debit}</th><th className="p-3 text-right">{a.credit}</th><th className="p-3 text-right">{a.runBal}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-gypsum">
                  <td className="p-3">{formatDate(r.date, locale)}</td>
                  <td className="p-3">{r.desc}</td>
                  <td className="num p-3 text-right">{r.debit ? fmtMoney(r.debit, cur, locale) : ""}</td>
                  <td className="num p-3 text-right text-ok">{r.credit ? fmtMoney(r.credit, cur, locale) : ""}</td>
                  <td className="num p-3 text-right font-semibold">{fmtMoney(r.bal, cur, locale)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate">{a.empty}</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
