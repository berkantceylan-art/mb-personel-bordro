import { publicProducts } from "@/lib/cms";
import { PRODUCT_UI, t } from "@/lib/i18n";
import { PORTAL_UI, portalContext, portalLocale, type PortalCase } from "@/lib/portal";
import { PX } from "@/lib/portal-extra-ui";
import { TEAM_UI } from "@/lib/portal-team-ui";
import { createClient } from "@/lib/supabase/server";
import { NewCaseForm, type CaseInitial } from "./NewCaseForm";
import Link from "next/link";
import { PLUS_UI } from "@/lib/portal-plus-ui";
import { deleteTemplate } from "@/lib/portal-plus-actions";

export const metadata = { title: "Portal" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ tekrar?: string; sablon?: string }> }) {
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const products = (await publicProducts()).map((p) => ({ slug: p.slug, name: t(p.name, locale), group: PRODUCT_UI[locale].categories[p.category] }));
  const { tekrar, sablon } = await searchParams;
  let initial: CaseInitial | undefined;
  const sb = await createClient();
  const { data: cl } = ctx?.account ? await sb.from("portal_clients").select("id, name").eq("account_id", ctx.account.id).eq("is_active", true).order("name") : { data: [] };
  if (tekrar && /^[0-9a-f-]{36}$/.test(tekrar)) {
    const supabase = await createClient();
    const { data } = await supabase.from("portal_cases").select("*").eq("id", tekrar).maybeSingle();
    const c = data as PortalCase | null;
    if (c) initial = { patient_ref: c.patient_ref, product_slug: c.product_slug ?? "", teeth: c.teeth ?? [], shade: c.shade ?? "", notes: c.notes ?? "", client_id: c.client_id ?? undefined };
  }
  const { data: tp } = ctx?.account ? await sb.from("portal_case_templates").select("id, name, product_slug, shade, notes").eq("account_id", ctx.account.id).order("name") : { data: [] };
  const templates = (tp ?? []) as Array<{ id: string; name: string; product_slug: string | null; shade: string | null; notes: string | null }>;
  const tpl = sablon ? templates.find((x) => x.id === sablon) : undefined;
  if (tpl && !initial) initial = { patient_ref: "", product_slug: tpl.product_slug ?? "", teeth: [], shade: tpl.shade ?? "", notes: tpl.notes ?? "" };
  const pu = PLUS_UI[locale];
  return (
    <>
      {templates.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate">📋 {pu.tplUse}:</span>
          {templates.map((x) => (
            <span key={x.id} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${tpl?.id === x.id ? "border-navy bg-navy text-white" : "border-gypsum bg-white"}`}>
              <Link href={`/portal/vaka/yeni?sablon=${x.id}`} className="font-semibold">{x.name}</Link>
              <form action={deleteTemplate}><input type="hidden" name="id" value={x.id} /><button aria-label="Sil" className="opacity-60 hover:opacity-100">×</button></form>
            </span>
          ))}
        </div>
      )}
      <h1 className="display mb-6 text-3xl font-semibold text-navy">{initial ? PX[locale].repeatTitle : PORTAL_UI[locale].form.title}</h1>
      <div className="max-w-3xl">
        <NewCaseForm locale={locale} products={products} initial={initial} dropLabel={PX[locale].drop} clients={(cl ?? []) as { id: string; name: string }[]} clientLabels={{ label: TEAM_UI[locale].client, none: TEAM_UI[locale].clientNone }} />
      </div>
    </>
  );
}
