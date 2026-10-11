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
  const sekme = (await searchParams).sekme;
  const tab = sekme === "ekstre" ? "ekstre" : sekme === "belgeler" ? "belgeler" : "isler";
  const DL = { tr: { docs: "Faturalar ve irsaliyeler", inv: "Aylık faturalar", wb: "İrsaliyeler", period: "Dönem", jobs: "iş", open: "Görüntüle / yazdır", delivered: "teslim alındı", none: "Belge yok." }, en: { docs: "Invoices & delivery notes", inv: "Monthly invoices", wb: "Delivery notes", period: "Period", jobs: "cases", open: "View / print", delivered: "received", none: "No documents." }, fr: { docs: "Factures et bons de livraison", inv: "Factures mensuelles", wb: "Bons de livraison", period: "Période", jobs: "cas", open: "Voir / imprimer", delivered: "reçu", none: "Aucun document." } }[locale as "tr" | "en" | "fr"] ?? { docs: "Faturalar ve irsaliyeler", inv: "Aylık faturalar", wb: "İrsaliyeler", period: "Dönem", jobs: "iş", open: "Görüntüle / yazdır", delivered: "teslim alındı", none: "Belge yok." };
  const supabase = await createClient();
  const { data: cust } = await supabase.from("lab_customers").select("id, name, currency, internal_book, internal_opening").eq("portal_account_id", acc.id).maybeSingle();
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
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref, book").eq("customer_id", cust.id).order("paid_on").limit(5000),
  ]);
  const jobs = (js ?? []) as LJob[];
  const [{ data: stRows }, { data: wbRows }] = tab === "belgeler" ? await Promise.all([
    supabase.from("lab_statements").select("id, year, no, period_from, period_to, total, currency, job_count").eq("customer_id", cust.id).neq("status", "cancelled").order("period_to", { ascending: false }).limit(36),
    supabase.from("lab_waybills").select("id, year, no, ship_date, total, currency, job_count, delivered_at").eq("customer_id", cust.id).neq("status", "cancelled").order("ship_date", { ascending: false }).limit(60),
  ]) : [{ data: [] }, { data: [] }];
  const sts = (stRows ?? []) as { id: string; year: number; no: number; period_from: string; period_to: string; total: number; currency: string; job_count: number }[];
  const wbs = (wbRows ?? []) as { id: string; year: number; no: number; ship_date: string; total: number; currency: string; job_count: number; delivered_at: string | null }[];
  // İç hesap kullanan müşteride hesap özeti iç caridir: yalnız iç / ikisi tahsilatları, iç açılış bakiyesi
  const ib = (cust as { internal_book?: boolean }).internal_book === true;
  const pays = ((ps ?? []) as (LPay & { book?: string })[]).filter((p) => !ib || p.book !== "official");
  const billed = jobs.filter((j) => j.status === "delivered").reduce((x, j) => x + Number(j.total), 0) + (ib ? Number((cust as { internal_opening?: number }).internal_opening ?? 0) : 0);
  const paid = pays.reduce((x, p) => x + Number(p.amount), 0);
  // Ekstre satırları (eskiden yeniye, yürüyen bakiye)
  const ob = ib ? Number((cust as { internal_opening?: number }).internal_opening ?? 0) : 0;
  const lines = [
    ...(ob ? [{ key: "ob", date: "0000-00-00", desc: "Devir / Opening", debit: ob > 0 ? ob : 0, credit: ob < 0 ? -ob : 0 }] : []),
    ...jobs.filter((j) => j.status === "delivered").map((j) => ({ key: `j${j.id}`, date: (j.delivered_at ?? j.in_date).slice(0, 10), desc: `${a.job} #${j.no}${j.patient ? ` · ${j.patient}` : ""}`, debit: Number(j.total), credit: 0 })),
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
        <Link href="/portal/hesap?sekme=belgeler" className={tabCls(tab === "belgeler")}>{DL.docs}</Link>
        {tab === "ekstre" && <span className="ml-auto"><PrintButton label={a.print} /></span>}
      </nav>
      {tab === "belgeler" && (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-4">
            <h2 className="mb-2 font-semibold text-navy">{DL.inv}</h2>
            <ul className="divide-y divide-gypsum text-sm">
              {sts.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><span><b>MB-{x.year}-{String(x.no).padStart(4, "0")}</b><span className="block text-xs text-slate">{DL.period}: {formatDate(x.period_from, locale)} – {formatDate(x.period_to, locale)} · {x.job_count} {DL.jobs}</span></span><span className="text-right"><span className="num block font-semibold">{fmtMoney(Number(x.total), x.currency, locale)}</span><Link href={`/portal/hesap/fatura/${x.id}`} className="text-xs font-semibold text-navy underline">{DL.open}</Link></span></li>)}
              {sts.length === 0 && <li className="py-4 text-slate">{DL.none}</li>}
            </ul>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <h2 className="mb-2 font-semibold text-navy">{DL.wb}</h2>
            <ul className="divide-y divide-gypsum text-sm">
              {wbs.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><span><b>İRS-{x.year}-{String(x.no).padStart(5, "0")}</b><span className="block text-xs text-slate">{formatDate(x.ship_date, locale)} · {x.job_count} {DL.jobs}{x.delivered_at ? ` · ✓ ${DL.delivered}` : ""}</span></span><span className="num font-semibold">{fmtMoney(Number(x.total), x.currency, locale)}</span></li>)}
              {wbs.length === 0 && <li className="py-4 text-slate">{DL.none}</li>}
            </ul>
          </div>
        </section>
      )}
      <section className={`mt-4 overflow-x-auto rounded-2xl bg-white p-2 ${tab === "belgeler" ? "hidden" : ""}`}>
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
                  <td className="p-3">{r.date.startsWith("0000") ? "" : formatDate(r.date, locale)}</td>
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
