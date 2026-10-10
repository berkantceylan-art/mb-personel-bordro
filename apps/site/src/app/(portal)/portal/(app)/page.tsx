import Link from "next/link";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { PORTAL_UI, STATUS_CLS, formatDate, portalContext, portalLocale, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { TEAM_UI } from "@/lib/portal-team-ui";

export const metadata = { title: "Portal" };


export default async function PortalHome({ searchParams }: { searchParams: Promise<{ musteri?: string; benim?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const ui = PORTAL_UI[locale];
  const supabase = await createClient();
  const [{ data }, products] = await Promise.all([supabase.from("portal_cases").select("*").order("created_at", { ascending: false }).limit(200), publicProducts()]);
  const allCases = (data ?? []) as (PortalCase & { created_by?: string | null })[];
  const tu = TEAM_UI[locale];
  const [{ data: mem }, { data: cl }] = await Promise.all([
    supabase.from("portal_members").select("user_id, display_name, email").eq("account_id", ctx?.account?.id ?? ""),
    supabase.from("portal_clients").select("id, name").eq("account_id", ctx?.account?.id ?? ""),
  ]);
  const who = new Map((mem ?? []).map((m) => [m.user_id as string, (m.display_name as string | null) ?? (m.email as string | null) ?? ""]));
  const clientName = new Map((cl ?? []).map((c) => [c.id as string, c.name as string]));
  const team = (mem ?? []).length > 1;
  const cases = allCases.filter((c) => (!sp.musteri || c.client_id === sp.musteri) && (!sp.benim || c.created_by === ctx?.user.id));
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
      {(team || clientName.size > 0) && allCases.length > 0 && (
        <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {team && (
            <>
              <Link href="/portal" className={`rounded-full px-4 py-2 font-semibold ${!sp.benim ? "bg-navy text-white" : "bg-white text-navy"}`}>{tu.all}</Link>
              <Link href="/portal?benim=1" className={`rounded-full px-4 py-2 font-semibold ${sp.benim ? "bg-navy text-white" : "bg-white text-navy"}`}>{tu.mine}</Link>
            </>
          )}
          {clientName.size > 0 && (
            <select name="musteri" defaultValue={sp.musteri ?? ""} className="field h-10 w-auto py-0" aria-label={tu.client}>
              <option value="">{tu.client}: {tu.all}</option>
              {[...clientName.entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          )}
          {clientName.size > 0 && <button className="rounded-full bg-white px-4 py-2 font-semibold text-navy">↵</button>}
        </form>
      )}
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
                {clientName.size > 0 && <th className="px-4 py-3 font-semibold">{tu.client}</th>}
                {team && <th className="px-4 py-3 font-semibold">{tu.sender}</th>}
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
                  {clientName.size > 0 && <td className="px-4 py-3 text-slate">{c.client_id ? clientName.get(c.client_id) ?? "—" : "—"}</td>}
                  {team && <td className="px-4 py-3 text-slate">{c.created_by ? who.get(c.created_by) ?? "—" : "—"}</td>}
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
