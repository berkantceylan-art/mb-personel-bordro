import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ordersFromForecast } from "@/lib/forecast-actions";

export const dynamic = "force-dynamic";

type P = { product_id: string; product: string; hist: number[]; forecast: number; trend_pct: number | null };
type Mt = { item_id: string; code: string | null; item: string; unit: string; supplier_party_id: string | null; hist: number[]; monthly: number; daily: number; stock: number; on_order: number; cover_days: number | null; suggest: number; min_qty: number };
const MON = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function Spark({ v }: { v: number[] }) {
  const max = Math.max(1, ...v);
  return <span className="inline-flex items-end gap-[2px] h-6">{v.map((x, i) => <span key={i} className="w-1.5 rounded-t bg-brand-600" style={{ height: `${Math.max(1, (x / max) * 24)}px`, opacity: i === v.length - 1 ? 1 : 0.45 }} />)}</span>;
}

/** Talep tahmini: gelecek ayın ürün hacmi ve malzeme ihtiyacı, stok yeterliliği, satın alma önerisi */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ tedarik?: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && (s.modules.stock ?? 0) < 1 && (s.modules.purchases ?? 0) < 1 && !s.logistics) redirect("/");
  const lead = Math.min(90, Math.max(1, Number((await searchParams).tedarik) || 14));
  const supabase = await createClient();
  const [{ data: pd, error }, { data: md }, { data: sp }] = await Promise.all([
    supabase.rpc("dmd_product_forecast", { p_ahead: 1 }),
    supabase.rpc("dmd_material_forecast", { p_lead_days: lead }),
    supabase.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).limit(2000),
  ]);
  const prods = (pd ?? []) as P[];
  const mats = (md ?? []) as Mt[];
  const sup = new Map((sp ?? []).map((x) => [x.id, x.name]));
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const next = MON[(now.getUTCMonth() + 1) % 12];
  const canPo = (s.modules.purchases ?? 0) >= 2;
  const totalNext = prods.reduce((a, p) => a + Number(p.forecast), 0);
  const lastMonth = prods.reduce((a, p) => a + Number(p.hist[p.hist.length - 1] ?? 0), 0);

  return (
    <>
      <PageHeader title="Talep tahmini" subtitle="Geçmiş aylara (ağırlıklı ortalama + geçen yılın aynı ayı) göre gelecek ayın hacmi ve malzeme ihtiyacı; stok yetmeyecekse satın alma önerisi" actions={<Link href="/alis/siparisler" className="text-sm font-semibold text-brand-700">Satın alma siparişleri</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261228000000_ai_forecast.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[[`${next} tahmini (ünit)`, Math.round(totalNext)], ["Geçen ay (ünit)", Math.round(lastMonth)], ["Stoku 30 günden az yetecek", mats.filter((m) => m.cover_days !== null && m.cover_days < 30).length], ["Alım önerilen malzeme", mats.filter((m) => m.suggest > 0).length]].map(([l, v]) => <div key={l as string} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>)}
        </div>

        <Card title={`Malzeme ihtiyacı ve satın alma önerisi (tedarik süresi ${lead} gün)`} action={<form className="flex gap-1 items-center text-sm"><span className="text-muted">Tedarik süresi</span><input name="tedarik" type="number" min={1} max={90} defaultValue={lead} className="h-8 w-16 rounded-[8px] border border-line px-2" /><button className="h-8 px-2 rounded-[8px] border border-line font-semibold">Hesapla</button></form>}>
          <form action={ordersFromForecast} className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead><tr className="text-left text-xs text-muted">{canPo && <th className="py-2 w-8"></th>}<th>Malzeme</th><th>Son 6 ay</th><th className="text-right">Aylık tahmin</th><th className="text-right">Eldeki</th><th className="text-right">Yolda</th><th className="text-right">Kaç gün yeter</th><th>Tedarikçi</th><th className="text-right">Önerilen alım</th></tr></thead>
                <tbody>
                  {mats.map((m) => (
                    <tr key={m.item_id} className="border-t border-[#EEF2F6]">
                      {canPo && <td className="py-2"><input type="checkbox" name="pick" value={m.item_id} defaultChecked={m.suggest > 0 && !!m.supplier_party_id} disabled={!m.supplier_party_id} /></td>}
                      <td className="py-2"><Link href={`/stok/urunler/${m.item_id}`} className="text-brand-700">{m.item}</Link>{m.code && <span className="ml-1 text-xs text-muted">{m.code}</span>}</td>
                      <td><Spark v={m.hist.map(Number)} /></td>
                      <td className="text-right num">{Number(m.monthly).toLocaleString("tr-TR")} {m.unit}</td>
                      <td className="text-right num">{Number(m.stock).toLocaleString("tr-TR")}</td>
                      <td className="text-right num">{Number(m.on_order) ? Number(m.on_order).toLocaleString("tr-TR") : ""}</td>
                      <td className={`text-right font-semibold ${m.cover_days === null ? "" : m.cover_days < lead ? "text-bad" : m.cover_days < 30 ? "text-warn" : "text-ok"}`}>{m.cover_days ?? "—"}</td>
                      <td className="text-xs">{m.supplier_party_id ? sup.get(m.supplier_party_id) : <span className="text-muted">tanımsız</span>}</td>
                      <td className="text-right">{canPo ? <input name={`q_${m.item_id}`} defaultValue={m.suggest > 0 ? m.suggest : ""} inputMode="decimal" className="h-8 w-20 rounded-[8px] border border-line px-2 text-right" /> : m.suggest}</td>
                    </tr>
                  ))}
                  {mats.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">Son 6 ayda tüketim hareketi yok; malzeme tüketimi işlere işlendikçe tahmin oluşur.</td></tr>}
                </tbody>
              </table>
            </div>
            {canPo && mats.some((m) => m.supplier_party_id) && <div><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Seçilenlerden taslak satın alma siparişi oluştur</PendingSubmit></div>}
            <p className="text-xs text-muted">Önerilen alım = aylık tahmin × (tedarik süresi + 30 gün) / 30 + asgari stok − eldeki − yolda. Tedarikçisi tanımlı olmayan malzemeye ürün kartından tedarikçi ekleyin.</p>
          </form>
        </Card>

        <Card title={`Ürün bazında ${next} tahmini`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2">Ürün</th><th>Son 12 ay</th><th className="text-right">Geçen ay</th><th className="text-right">Tahmin</th><th className="text-right">3 aylık eğilim</th></tr></thead>
              <tbody>
                {prods.map((p) => (
                  <tr key={p.product_id} className="border-t border-[#EEF2F6]">
                    <td className="py-2 font-semibold">{p.product}</td>
                    <td><Spark v={p.hist.map(Number)} /></td>
                    <td className="text-right num">{Number(p.hist[p.hist.length - 1] ?? 0)}</td>
                    <td className="text-right num font-bold">{Number(p.forecast).toLocaleString("tr-TR")}</td>
                    <td className={`text-right font-semibold ${p.trend_pct === null ? "" : p.trend_pct > 0 ? "text-ok" : p.trend_pct < 0 ? "text-bad" : ""}`}>{p.trend_pct === null ? "—" : `${p.trend_pct > 0 ? "▲" : p.trend_pct < 0 ? "▼" : ""} %${Math.abs(p.trend_pct)}`}</td>
                  </tr>
                ))}
                {prods.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Teslim edilmiş iş geçmişi yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
