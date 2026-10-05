import { PrintButton } from "@/components/portal/PrintButton";
import { t } from "@/lib/i18n";
import { formatDate, portalContext, portalLocale } from "@/lib/portal";
import { requestPriceList } from "@/lib/portal-actions";
import { PRICE_UI, formatPrice, type PriceItem } from "@/lib/prices";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Fiyat listesi — MB Dental" };

export default async function PortalPriceList({ searchParams }: { searchParams: Promise<{ talep?: string; hata?: string }> }) {
  const { talep, hata } = await searchParams;
  const ctx = await portalContext();
  const acc = ctx?.account;
  const locale = await portalLocale(acc);
  const ui = PRICE_UI[locale];
  if (!acc) return null;

  if (!acc.price_access) {
    const requested = !!acc.price_requested_at;
    return (
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center sm:p-10">
        <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-porcelain text-2xl">
          {requested ? "⏳" : "🔒"}
        </span>
        <h1 className="display mt-4 text-3xl font-semibold text-navy">{requested ? ui.requested : ui.title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-slate">{requested ? ui.requestedText : ui.noAccess}</p>
        {hata && (
          <p role="alert" className="mt-4 text-sm text-bad">
            {ui.error}
          </p>
        )}
        {talep && !hata && (
          <p role="status" className="mt-4 text-sm font-semibold text-ok">
            {ui.sent}
          </p>
        )}
        {!requested && (
          <form action={requestPriceList} className="mt-6">
            <button type="submit" className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
              {ui.request}
            </button>
          </form>
        )}
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.from("cms_price_items").select("*").eq("is_active", true).order("sort");
  const items = (data ?? []) as PriceItem[];
  const hasTry = items.some((i) => i.price_try !== null);
  const hasEur = items.some((i) => i.price_eur !== null);
  const sections: { label: string; items: PriceItem[] }[] = [];
  for (const it of items) {
    const label = t(it.section, locale);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.items.push(it);
    else sections.push({ label, items: [it] });
  }
  const updated = items.reduce((m, i) => (i.updated_at && i.updated_at > m ? i.updated_at : m), "");

  return (
    <div className="price-list grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="display text-3xl font-semibold text-navy">{ui.title}</h1>
          <p className="mt-1 max-w-2xl text-slate">{ui.lead}</p>
          {updated && (
            <p className="mt-1 text-xs text-slate">
              {ui.updated}: {formatDate(updated, locale)}
            </p>
          )}
        </div>
        <PrintButton label={ui.print} />
      </div>
      {items.length === 0 ? (
        <p className="rounded-3xl bg-white p-10 text-center text-slate">{ui.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-gypsum bg-white">
          <table className="w-full min-w-[34rem] text-left">
            <thead className="bg-navy text-sm text-white">
              <tr>
                <th className="px-5 py-3 font-semibold">{ui.item}</th>
                <th className="px-5 py-3 font-semibold">{ui.unit}</th>
                {hasTry && <th className="px-5 py-3 text-right font-semibold">{ui.try}</th>}
                {hasEur && <th className="px-5 py-3 text-right font-semibold">{ui.eur}</th>}
              </tr>
            </thead>
            {sections.map((s, si) => (
              <tbody key={si}>
                {s.label && (
                  <tr className="bg-porcelain">
                    <th colSpan={2 + (hasTry ? 1 : 0) + (hasEur ? 1 : 0)} scope="rowgroup" className="px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-smile-ink">
                      {s.label}
                    </th>
                  </tr>
                )}
                {s.items.map((it) => (
                  <tr key={it.id} className="border-t border-gypsum">
                    <td className="px-5 py-3">
                      <span className="font-semibold text-ink">{t(it.name, locale)}</span>
                      {t(it.note, locale) && <span className="mt-0.5 block text-xs text-slate">{t(it.note, locale)}</span>}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate">{t(it.unit, locale)}</td>
                    {hasTry && <td className="px-5 py-3 text-right font-semibold tabular-nums text-navy">{formatPrice(it.price_try, "TRY", locale)}</td>}
                    {hasEur && <td className="px-5 py-3 text-right font-semibold tabular-nums text-navy">{formatPrice(it.price_eur, "EUR", locale)}</td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="text-xs text-slate">{ui.vat}</p>
    </div>
  );
}
