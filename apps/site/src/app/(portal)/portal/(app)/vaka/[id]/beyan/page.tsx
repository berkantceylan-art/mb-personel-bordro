import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/portal/PrintButton";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { formatDate, portalContext, portalLocale, type PortalCase } from "@/lib/portal";
import { PX } from "@/lib/portal-extra-ui";
import { TEAM_UI } from "@/lib/portal-team-ui";
import { PORTAL_BUCKET } from "@/lib/portal";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { PLUS_UI } from "@/lib/portal-plus-ui";

export const metadata = { title: "Declaration" };

/** Ismarlama cihaz uygunluk beyanı (MDR Ek XIII) — kargoya verilen / teslim edilen vakalar için */
export default async function DeclarationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const d = PX[locale].decl;
  const supabase = await createClient();
  const { data } = await supabase.from("portal_cases").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as PortalCase;
  if (c.status !== "shipped" && c.status !== "delivered") notFound();
  const [st, products] = await Promise.all([getSettings(), publicProducts()]);
  const product = products.find((p) => p.slug === c.product_slug);
  const acc = ctx?.account;
  const client = c.client_id ? (await supabase.from("portal_clients").select("name, city, country").eq("id", c.client_id).maybeSingle()).data : null;
  const logo = acc?.logo_path ? (await supabase.storage.from(PORTAL_BUCKET).createSignedUrl(acc.logo_path, 3600)).data?.signedUrl : null;
  const row = "grid grid-cols-[11rem_1fr] gap-3 border-b border-gypsum py-2.5";
  const { data: lotData } = await supabase.rpc("portal_case_lots", { p_case: c.id });
  const lots = ((lotData ?? []) as Array<{ item: string; lot: string | null; expiry: string | null; brand: string | null }>);
  const pu = PLUS_UI[locale];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/portal/vaka/${c.id}`} className="text-sm font-semibold text-slate hover:text-navy">← #{c.no}</Link>
        <PrintButton label={d.print} />
      </div>
      <article className="mx-auto max-w-[180mm] rounded-3xl bg-white p-8 print:rounded-none print:p-0 text-ink">
        <style>{`@page { size: A4; margin: 16mm; }`}</style>
        <header className="flex items-start justify-between gap-4 border-b-2 border-navy pb-4">
          <div>
            <h1 className="display text-2xl font-semibold text-navy">{d.title}</h1>
            <p className="text-sm text-slate">{d.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo && <img src={logo} alt="" className="max-h-14 max-w-[140px] object-contain" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={56} height={56} className="h-14 w-14" />
          </div>
        </header>
        <section className="mt-4 text-sm">
          <div className={row}><span className="font-semibold">{d.manufacturer}</span><span>MB Dental · {[st.address1, st.address2].filter(Boolean).join(", ")} · {st.phone} · {st.email}</span></div>
          <div className={row}><span className="font-semibold">{d.device}</span><span>{d.deviceText}</span></div>
          <div className={row}><span className="font-semibold">{d.caseNo}</span><span className="num">#{c.no}</span></div>
          <div className={row}><span className="font-semibold">{d.patient}</span><span>{c.patient_ref}</span></div>
          {acc?.type === "agency" && <div className={row}><span className="font-semibold">{TEAM_UI[locale].distributor}</span><span>{acc.company || acc.name}</span></div>}
          <div className={row}><span className="font-semibold">{d.prescriber}</span><span>{client ? `${client.name}${client.city ? ` · ${client.city}` : ""}${client.country ? `, ${client.country}` : ""}` : `${acc?.name ?? ""}${acc?.company ? ` · ${acc.company}` : ""}${acc?.city ? ` · ${acc.city}` : ""}${acc?.country ? `, ${acc.country}` : ""}`}</span></div>
          {product && <div className={row}><span className="font-semibold">{d.product}</span><span>{t(product.name, locale)}</span></div>}
          {c.teeth?.length ? <div className={row}><span className="font-semibold">{d.teeth}</span><span className="num">{c.teeth.join(", ")}</span></div> : null}
          {c.shade && <div className={row}><span className="font-semibold">{d.materials}</span><span>{c.shade}</span></div>}
        </section>
        {lots.length > 0 && (
          <section className="mt-5 text-sm">
            <h2 className="mb-2 font-semibold text-navy">{pu.lots}</h2>
            <table className="w-full border-collapse text-left">
              <thead><tr className="border-b-2 border-gypsum text-xs text-slate"><th className="py-1.5">{pu.lotItem}</th><th className="py-1.5">{pu.lot}</th><th className="py-1.5">{pu.expiry}</th></tr></thead>
              <tbody>{lots.map((l, i) => <tr key={i} className="border-b border-gypsum"><td className="py-1.5">{l.item}{l.brand ? ` · ${l.brand}` : ""}</td><td className="py-1.5 font-mono">{l.lot ?? "—"}</td><td className="py-1.5">{l.expiry ? formatDate(l.expiry, locale) : "—"}</td></tr>)}</tbody>
            </table>
          </section>
        )}
        <p className="mt-6 text-sm leading-relaxed">{d.statement}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate">{d.statement2}</p>
        <footer className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div><span className="font-semibold">{d.date}:</span> {formatDate(c.updated_at ?? c.created_at, locale)}</div>
          <div className="border-t border-ink pt-2 text-center text-slate">{d.sign} · MB Dental</div>
        </footer>
      </article>
    </>
  );
}
