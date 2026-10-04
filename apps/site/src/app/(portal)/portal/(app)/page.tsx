import Link from "next/link";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { PORTAL_UI, STATUS_CLS, formatDate, portalContext, portalLocale, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal" };


export default async function PortalHome() {
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const ui = PORTAL_UI[locale];
  const supabase = await createClient();
  const [{ data }, products] = await Promise.all([supabase.from("portal_cases").select("*").order("created_at", { ascending: false }).limit(200), publicProducts()]);
  const cases = (data ?? []) as PortalCase[];
  const names = Object.fromEntries(products.map((p) => [p.slug, t(p.name, locale)]));
  const open = cases.filter((c) => !["delivered", "cancelled"].includes(c.status)).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold text-navy">{ui.nav.cases}</h1>
          <p className="mt-1 text-slate">
            {ui.list.total}: <span className="num font-semibold text-ink">{cases.length}</span> · {ui.list.open}: <span className="num font-semibold text-ink">{open}</span>
          </p>
        </div>
        <Link href="/portal/vaka/yeni" className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">
          + {ui.nav.newCase}
        </Link>
      </div>
      {cases.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-gypsum bg-white p-12 text-center">
          <p className="text-slate">{ui.list.empty}</p>
          <Link href="/portal/vaka/yeni" className="mt-4 inline-block rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-navy hover:text-white">
            {ui.nav.newCase}
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gypsum bg-white">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-gypsum text-xs uppercase tracking-wide text-slate">
              <tr>
                <th className="px-4 py-3 font-semibold">{ui.list.no}</th>
                <th className="px-4 py-3 font-semibold">{ui.list.patient}</th>
                <th className="px-4 py-3 font-semibold">{ui.list.product}</th>
                <th className="px-4 py-3 font-semibold">{ui.list.teeth}</th>
                <th className="px-4 py-3 font-semibold">{ui.list.status}</th>
                <th className="px-4 py-3 font-semibold">{ui.list.date}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gypsum">
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-porcelain">
                  <td className="px-4 py-3">
                    <Link href={`/portal/vaka/${c.id}`} className="num font-semibold text-navy hover:underline">
                      #{c.no}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-semibold">{c.patient_ref}</td>
                  <td className="px-4 py-3 text-slate">{c.product_slug ? names[c.product_slug] ?? c.product_slug : "—"}</td>
                  <td className="num px-4 py-3 text-slate">{c.teeth?.join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLS[c.status]}`}>{ui.statuses[c.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate">{formatDate(c.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
