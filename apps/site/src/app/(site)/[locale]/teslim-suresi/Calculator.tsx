"use client";
import { useMemo, useState } from "react";
import { LEAD_UI, TR_HOLIDAYS, TRANSIT_DAYS } from "@/lib/growth-ui";
import type { Locale } from "@/lib/i18n";

type P = { slug: string; name: string; days: number };

/** İş günü ekle: kapalı günler (haftalık takvim) ve tatiller atlanır */
function addWorkdays(start: Date, n: number, closed: Set<number>): Date {
  const d = new Date(start);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (closed.has(d.getUTCDay()) || TR_HOLIDAYS.has(iso)) continue;
    left--;
  }
  return d;
}

export function LeadCalculator({ locale, products, closedDays, areas = [] }: { locale: Locale; products: P[]; closedDays: number[]; areas?: Array<{ slug: string; name: string; days: number }> }) {
  const u = LEAD_UI[locale];
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [slug, setSlug] = useState(products[0]?.slug ?? "");
  const [start, setStart] = useState(today);
  const [dest, setDest] = useState(locale === "tr" ? "local" : "eu");
  const [area, setArea] = useState("");
  const ar = areas.find((a) => a.slug === area);
  const transit = ar ? ar.days : TRANSIT_DAYS[dest] ?? 2;
  const closed = useMemo(() => new Set(closedDays), [closedDays]);
  const p = products.find((x) => x.slug === slug);
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  const result = useMemo(() => {
    if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
    const s = new Date(`${start}T12:00:00Z`);
    const ship = addWorkdays(s, p.days, closed);
    // Taşıma: hafta sonu dağıtım yok
    const arrive = addWorkdays(ship, transit, new Set([0, 6]));
    return { ship, arrive: transit === 0 ? ship : arrive };
  }, [p, start, transit, closed]);

  if (!products.length) return <p className="rounded-3xl bg-white p-8 text-slate">{u.none}</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="grid gap-4 rounded-3xl bg-white p-7">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {u.product}
          <select value={slug} onChange={(e) => setSlug(e.target.value)} className="field font-normal">
            {products.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {u.start}
          <input type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} className="field font-normal" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold text-navy">{u.dest}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(u.dests).map(([k, v]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-xl border border-gypsum px-3 py-2.5 text-sm has-[:checked]:border-navy has-[:checked]:bg-porcelain">
                <input type="radio" name="dest" checked={dest === k} onChange={() => setDest(k)} />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
        {areas.length > 0 && (
          <label className="grid gap-1.5 text-sm font-semibold text-navy">
            {locale === "tr" ? "ya da şehir / ülke seçin" : locale === "fr" ? "ou choisissez une ville / un pays" : "or choose a city / country"}
            <select value={area} onChange={(e) => setArea(e.target.value)} className="field font-normal">
              <option value="">—</option>
              {areas.map((a) => <option key={a.slug} value={a.slug}>{a.name} · {a.days === 0 ? (locale === "tr" ? "aynı gün" : locale === "fr" ? "jour même" : "same day") : `+${a.days}`}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="rounded-3xl bg-navy p-7 text-white" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-wider text-smile">{u.result}</p>
        {p && result && (
          <>
            <p className="mt-2 text-white/70">{p.name} · {p.days} {u.workdays}</p>
            <div className="mt-6 grid gap-5">
              <div>
                <p className="text-sm text-white/60">{u.ship}</p>
                <p className="display text-3xl font-semibold">{fmt.format(result.ship)}</p>
              </div>
              <div>
                <p className="text-sm text-white/60">{u.arrive}</p>
                <p className="display text-3xl font-semibold text-smile">{fmt.format(result.arrive)}</p>
              </div>
            </div>
          </>
        )}
        {p && <a href={`/${locale}/vaka-gonder?urun=${p.slug}`} className="mt-6 inline-block rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-white">{locale === "tr" ? "Bu ürün için vaka gönder" : locale === "fr" ? "Envoyer un cas pour ce produit" : "Send a case for this product"} →</a>}
        <p className="mt-8 text-xs text-white/60">{u.note}</p>
      </div>
    </div>
  );
}
