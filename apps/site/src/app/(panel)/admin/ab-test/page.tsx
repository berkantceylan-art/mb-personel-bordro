import { Flash, I18nField, PageHead } from "@/components/admin/ui";
import type { AbTest } from "@/lib/cms";
import { saveAb } from "@/lib/growth-actions";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "A/B testi" };

/** A/B testi: iki metinden hangisi daha çok tıklanıyor */
export default async function AbPage({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: res }] = await Promise.all([supabase.from("cms_ab_tests").select("*").order("key"), supabase.rpc("site_ab_results")]);
  const tests = (data ?? []) as AbTest[];
  const r = (res ?? {}) as Record<string, { views: number; clicks: number; visitors: number }>;
  return (
    <>
      <PageHead title="A/B testi" lead="Ziyaretçilerin yarısı A, yarısı B metnini görür. Hangisi daha çok tıklanırsa onu kalıcı yapın." />
      <Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : undefined)} />
      {tests.map((x) => {
        const A = r[`${x.key}:A`] ?? { views: 0, clicks: 0, visitors: 0 }, B = r[`${x.key}:B`] ?? { views: 0, clicks: 0, visitors: 0 };
        const ctr = (v: { views: number; clicks: number }) => (v.views ? (v.clicks / v.views) * 100 : 0);
        const lead = ctr(A) === ctr(B) ? null : ctr(A) > ctr(B) ? "A" : "B";
        const enough = A.views >= 100 && B.views >= 100;
        return (
          <section key={x.key} className="mb-6 rounded-2xl border border-gypsum bg-white p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="display flex-1 text-lg font-semibold text-navy">{x.label}</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${x.winner ? "bg-emerald-50 text-emerald-700" : x.is_active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{x.winner ? `Kazanan: ${x.winner}` : x.is_active ? "Test sürüyor" : "Durduruldu"}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {([["A", A, x.variant_a], ["B", B, x.variant_b]] as const).map(([k, v, txt]) => (
                <div key={k} className={`rounded-xl border p-4 ${lead === k && enough ? "border-emerald-300 bg-emerald-50/50" : "border-gypsum"}`}>
                  <span className="text-xs font-bold text-slate">{k}</span>
                  <b className="mt-1 block text-lg text-ink">“{t(txt, "tr")}”</b>
                  <p className="mt-2 text-sm text-slate"><b className="num text-navy">{v.views}</b> gösterim · <b className="num text-navy">{v.clicks}</b> tıklama · <b className="num text-navy">%{ctr(v).toFixed(1)}</b> oran</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate">{enough ? (lead ? `${lead} önde. Fark anlamlıysa kazananı seçin.` : "İki metin eşit.") : "Güvenilir sonuç için her metnin en az 100 gösterim alması bekleniyor."}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {(x.is_active ? [["stop", "⏸ Durdur"]] : [["start", "▶ Testi başlat"]]).concat([["A", "A kazandı"], ["B", "B kazandı"]]).map(([act, l]) => (
                <form key={act} action={saveAb}><input type="hidden" name="key" value={x.key} /><input type="hidden" name="act" value={act} /><button className="rounded-full border border-gypsum px-3.5 py-1.5 font-semibold hover:border-navy">{l}</button></form>
              ))}
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-navy">Metinleri düzenle</summary>
              <form action={saveAb} className="mt-3 grid gap-3">
                <input type="hidden" name="key" value={x.key} /><input type="hidden" name="act" value="save" />
                <I18nField name="a" label="A metni" value={x.variant_a} required /><I18nField name="b" label="B metni" value={x.variant_b} required />
                <button className="justify-self-start rounded-full bg-navy px-5 py-2 font-semibold text-white">Kaydet</button>
              </form>
            </details>
          </section>
        );
      })}
    </>
  );
}
