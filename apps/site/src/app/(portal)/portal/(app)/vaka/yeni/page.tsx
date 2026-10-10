import { publicProducts } from "@/lib/cms";
import { PRODUCT_UI, t } from "@/lib/i18n";
import { PORTAL_UI, portalContext, portalLocale, type PortalCase } from "@/lib/portal";
import { PX } from "@/lib/portal-extra-ui";
import { createClient } from "@/lib/supabase/server";
import { NewCaseForm, type CaseInitial } from "./NewCaseForm";

export const metadata = { title: "Portal" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ tekrar?: string }> }) {
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const products = (await publicProducts()).map((p) => ({ slug: p.slug, name: t(p.name, locale), group: PRODUCT_UI[locale].categories[p.category] }));
  const { tekrar } = await searchParams;
  let initial: CaseInitial | undefined;
  if (tekrar && /^[0-9a-f-]{36}$/.test(tekrar)) {
    const supabase = await createClient();
    const { data } = await supabase.from("portal_cases").select("*").eq("id", tekrar).maybeSingle();
    const c = data as PortalCase | null;
    if (c) initial = { patient_ref: c.patient_ref, product_slug: c.product_slug ?? "", teeth: c.teeth ?? [], shade: c.shade ?? "", notes: c.notes ?? "" };
  }
  return (
    <>
      <h1 className="display mb-6 text-3xl font-semibold text-navy">{initial ? PX[locale].repeatTitle : PORTAL_UI[locale].form.title}</h1>
      <div className="max-w-3xl">
        <NewCaseForm locale={locale} products={products} initial={initial} dropLabel={PX[locale].drop} />
      </div>
    </>
  );
}
