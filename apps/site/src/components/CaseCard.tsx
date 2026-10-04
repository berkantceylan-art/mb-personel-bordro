import Link from "next/link";
import { mediaUrl, type CaseItem } from "@/lib/cms";
import { CASE_UI, t, type Locale } from "@/lib/i18n";
import { BeforeAfter } from "./BeforeAfter";

export function CaseCard({ c, locale, productName }: { c: CaseItem; locale: Locale; productName?: string }) {
  const ui = CASE_UI[locale];
  const title = t(c.title, locale);
  const desc = t(c.description, locale);
  const before = mediaUrl(c.before_path);
  const after = mediaUrl(c.after_path);
  const single = after ?? before ?? mediaUrl(c.gallery[0] ?? null);
  return (
    <article className="grid content-start gap-3">
      {before && after ? (
        <BeforeAfter before={before} after={after} alt={title} labels={ui} />
      ) : (
        single && (
          <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gypsum">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={single} alt={title} className="h-full w-full object-cover" loading="lazy" />
          </div>
        )
      )}
      <div>
        <h3 className="display text-lg font-semibold text-navy">{title}</h3>
        {desc && <p className="mt-1 text-sm text-slate">{desc}</p>}
        <p className="mt-2 flex flex-wrap gap-2 text-xs">
          {c.teeth && (
            <span className="rounded-full border border-gypsum bg-white px-2.5 py-1 font-semibold text-navy">
              {ui.teeth}: {c.teeth}
            </span>
          )}
          {c.product_slug && productName && (
            <Link href={`/${locale}/urunler/${c.product_slug}`} className="rounded-full border border-gypsum px-2.5 py-1 font-semibold text-smile-ink hover:border-navy">
              {productName}
            </Link>
          )}
        </p>
      </div>
    </article>
  );
}
