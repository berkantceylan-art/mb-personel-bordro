import Link from "next/link";
import { ACCT_UI, fmtMoney } from "@/lib/portal-account-ui";
import { formatDate, portalContext, portalLocale } from "@/lib/portal";
import { PrintButton } from "@/components/portal/PrintButton";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pro forma" };

/** Aylık proforma: o ay laboratuvara giren işler ve satırları */
export default async function Proforma({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const a = ACCT_UI[locale];
  const ay = /^\d{4}-\d{2}$/.test((await searchParams).ay ?? "") ? (await searchParams).ay! : new Date().toISOString().slice(0, 7);
  const supabase = await createClient();
  const { data: cust } = await supabase.from("lab_customers").select("id, name, currency, address, city, country, tax_office, tax_no").eq("portal_account_id", acc.id).maybeSingle();
  if (!cust) return <p className="rounded-2xl bg-white p-6 text-slate">{a.notLinked}</p>;
  const end = new Date(`${ay}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const [{ data: js }, { data: banks }, st] = await Promise.all([
    supabase.from("jobs").select("id, no, in_date, patient, total, currency, status").eq("customer_id", cust.id).eq("status", "delivered").gte("delivered_at", `${ay}-01T00:00:00+03:00`).lt("delivered_at", `${end.toISOString().slice(0, 10)}T00:00:00+03:00`).order("no"),
    supabase.from("lab_options").select("value").eq("kind", "bank").order("sort"),
    getSettings(),
  ]);
  const jobs = (js ?? []) as { id: string; no: number; in_date: string; patient: string | null; total: number; currency: string }[];
  const { data: items } = jobs.length ? await supabase.from("job_items").select("job_id, name, qty, unit_price, amount, kind").in("job_id", jobs.map((j) => j.id)).order("sort") : { data: [] };
  const byJob = new Map<string, { name: string; qty: number; unit_price: number; amount: number; kind: string }[]>();
  for (const i of items ?? []) byJob.set(i.job_id as string, [...(byJob.get(i.job_id as string) ?? []), i as { name: string; qty: number; unit_price: number; amount: number; kind: string }]);
  const cur = cust.currency as string;
  const total = jobs.reduce((x, j) => x + Number(j.total), 0);
  const cell = "border border-gypsum px-2 py-1.5";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/portal/hesap" className="text-sm font-semibold text-slate hover:text-navy">← {a.title}</Link>
        <PrintButton label={a.print} />
      </div>
      <article className="mx-auto max-w-[190mm] rounded-3xl bg-white p-8 text-sm text-ink print:rounded-none print:p-0">
        <style>{`@page { size: A4; margin: 14mm; }`}</style>
        <header className="flex flex-wrap justify-between gap-4 border-b-2 border-navy pb-4">
          <div>
            <h1 className="display text-2xl font-semibold text-navy">{a.proformaTitle}</h1>
            <p className="num text-slate">{ay}</p>
            <p className="mt-2 text-xs text-slate">MB Dental · {[st.address1, st.address2].filter(Boolean).join(", ")} · {st.phone} · {st.email}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate">{a.billTo}</p>
            <p className="font-semibold">{cust.name}</p>
            <p className="text-xs">{[cust.address, cust.city, cust.country].filter(Boolean).join(", ")}</p>
            {cust.tax_no && <p className="text-xs">{cust.tax_office} · {cust.tax_no}</p>}
          </div>
        </header>
        <table className="mt-5 w-full border-collapse">
          <thead><tr className="bg-porcelain text-left"><th className={cell}>{a.job}</th><th className={cell}>{a.item}</th><th className={`${cell} text-right`}>{a.qty}</th><th className={`${cell} text-right`}>{a.unit}</th><th className={`${cell} text-right`}>{a.amount}</th></tr></thead>
          <tbody>
            {jobs.map((j) => {
              const lines = byJob.get(j.id) ?? [];
              return lines.length ? (
                lines.map((l, i) => (
                  <tr key={`${j.id}-${i}`}>
                    <td className={cell}>{i === 0 ? `#${j.no} · ${formatDate(j.in_date, locale)}${j.patient ? ` · ${j.patient}` : ""}` : ""}</td>
                    <td className={cell}>{l.name}</td>
                    <td className={`${cell} num text-right`}>{l.qty}</td>
                    <td className={`${cell} num text-right`}>{fmtMoney(l.unit_price, cur, locale)}</td>
                    <td className={`${cell} num text-right`}>{fmtMoney(l.amount, cur, locale)}</td>
                  </tr>
                ))
              ) : (
                <tr key={j.id}>
                  <td className={cell}>#{j.no} · {formatDate(j.in_date, locale)}</td>
                  <td className={cell}>—</td>
                  <td className={cell} />
                  <td className={cell} />
                  <td className={`${cell} num text-right`}>{fmtMoney(j.total, cur, locale)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold"><td colSpan={4} className={`${cell} text-right`}>{a.total}</td><td className={`${cell} num text-right`}>{fmtMoney(total, cur, locale)}</td></tr>
          </tbody>
        </table>
        {jobs.length === 0 && <p className="mt-4 text-slate">{a.empty}</p>}
        {(banks ?? []).length > 0 && (
          <div className="mt-5 text-xs"><p className="font-semibold">{a.bank}</p>{(banks ?? []).map((b, i) => <p key={i}>{b.value as string}</p>)}</div>
        )}
        <p className="mt-6 text-xs text-slate">{a.proformaNote}</p>
      </article>
    </>
  );
}
