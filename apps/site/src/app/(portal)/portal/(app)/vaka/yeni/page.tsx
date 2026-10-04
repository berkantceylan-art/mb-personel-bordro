import { publicProducts } from "@/lib/cms";
import { PRODUCT_UI, t } from "@/lib/i18n";
import { PORTAL_UI, portalContext, portalLocale } from "@/lib/portal";
import { NewCaseForm } from "./NewCaseForm";

export const metadata = { title: "Portal" };

export default async function NewCasePage() {
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const products = (await publicProducts()).map((p) => ({ slug: p.slug, name: t(p.name, locale), group: PRODUCT_UI[locale].categories[p.category] }));
  return (
    <>
      <h1 className="display mb-6 text-3xl font-semibold text-navy">{PORTAL_UI[locale].form.title}</h1>
      <div className="max-w-3xl">
        <NewCaseForm locale={locale} products={products} />
      </div>
    </>
  );
}
