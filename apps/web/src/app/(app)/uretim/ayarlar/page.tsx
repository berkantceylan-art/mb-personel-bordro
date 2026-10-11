import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, page, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveRoute, saveStation } from "@/lib/production-actions";
import { STATION_KIND } from "@/lib/production";

export const dynamic = "force-dynamic";

/** İstasyonlar ve ürün rotaları (hangi ürün hangi istasyonlardan, ne sürede geçer; malzeme hangi adımda düşer) */
export default async function ProductionSettings() {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.logistics ? 2 : 0);
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: st, error }, { data: products }, { data: steps }, { data: boms }] = await Promise.all([
    supabase.from("prd_stations").select("*").order("sort"),
    supabase.from("lab_products").select("id, name, code, material").eq("is_active", true).order("sort").order("name"),
    supabase.from("prd_route_steps").select("lab_product_id, station_id, sort, std_minutes, consume"),
    supabase.from("stk_boms").select("lab_product_id"),
  ]);
  type S = { id: string; name: string; code: string | null; kind: string; color: string | null; sort: number; daily_capacity: number | null; is_active: boolean };
  const stations = (st ?? []) as S[];
  const active = stations.filter((x) => x.is_active);
  const rs = (steps ?? []) as { lab_product_id: string; station_id: string; sort: number; std_minutes: number | null; consume: boolean }[];
  const hasBom = new Set((boms ?? []).map((b) => b.lab_product_id as string));
  const ps = (products ?? []) as { id: string; name: string; code: string | null; material: string | null }[];
  return (
    <>
      <PageHeader title="İstasyon ve rotalar" subtitle="Ürün rotası: işin hangi istasyonlardan geçeceği. Okutma ve pano bu rotaya göre çalışır." actions={<Link href="/uretim" className="text-sm font-semibold text-brand-700">← Pano</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Üretim tabloları yok: Supabase&apos;de 20261207000000_production.sql çalıştırın.</Notice>}
        <Card title="İstasyonlar">
          <div className="flex flex-col gap-2">
            {stations.map((x) => (
              <form key={x.id} action={saveStation} className="grid gap-2 grid-cols-2 md:grid-cols-[60px_1fr_160px_70px_90px_90px_auto] items-center">
                <input type="hidden" name="id" value={x.id} />
                <input name="color" type="color" defaultValue={x.color ?? "#64748B"} className="h-10 w-14 rounded border border-line" aria-label="Renk" />
                <input name="name" defaultValue={x.name} maxLength={80} className={inputCls} aria-label="Ad" />
                <select name="kind" defaultValue={x.kind} className={selectCls} aria-label="Tür">{Object.entries(STATION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="sort" type="number" defaultValue={x.sort} className={inputCls} aria-label="Sıra" />
                <input name="daily_capacity" type="number" defaultValue={x.daily_capacity ?? ""} placeholder="kapasite" className={inputCls} aria-label="Günlük kapasite" />
                <select name="is_active" defaultValue={x.is_active ? "on" : "off"} className={selectCls} aria-label="Durum"><option value="on">Aktif</option><option value="off">Pasif</option></select>
                {lvl >= 3 && <PendingSubmit className={`${btnSecondary} h-10`}>Kaydet</PendingSubmit>}
              </form>
            ))}
            {lvl >= 3 && (
              <form action={saveStation} className="grid gap-2 grid-cols-2 md:grid-cols-[60px_1fr_160px_70px_90px_auto] items-center border-t border-line pt-3 mt-1">
                <input name="color" type="color" defaultValue="#2563EB" className="h-10 w-14 rounded border border-line" aria-label="Renk" />
                <input name="name" required placeholder="Yeni istasyon adı" maxLength={80} className={inputCls} />
                <select name="kind" className={selectCls}>{Object.entries(STATION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="sort" type="number" defaultValue={(stations.at(-1)?.sort ?? 0) + 10} className={inputCls} />
                <input name="daily_capacity" type="number" placeholder="kapasite" className={inputCls} />
                <PendingSubmit className={`${btnPrimary} h-10`}>Ekle</PendingSubmit>
              </form>
            )}
          </div>
        </Card>

        <Card title={`Ürün rotaları (${ps.filter((p) => rs.some((r) => r.lab_product_id === p.id)).length} / ${ps.length} ürün tanımlı)`}>
          <div className="flex flex-col gap-2">
            {ps.map((p) => {
              const mine = rs.filter((r) => r.lab_product_id === p.id);
              const cons = mine.find((r) => r.consume)?.station_id ?? "";
              return (
                <details key={p.id} className="border border-line rounded-[12px]">
                  <summary className="px-3 py-2.5 cursor-pointer flex flex-wrap items-center gap-2">
                    <b>{p.name}</b><span className="text-xs text-muted">{p.code ?? ""} {p.material ?? ""}</span>
                    <span className="ml-auto text-xs text-muted">{mine.length ? mine.sort((a, b) => a.sort - b.sort).map((r) => stations.find((x) => x.id === r.station_id)?.name).join(" → ") : "rota yok"}</span>
                    {!hasBom.has(p.id) && <span className="text-[11px] text-warn">reçete yok</span>}
                  </summary>
                  <form action={saveRoute} className="px-3 pb-3 flex flex-col gap-2">
                    <input type="hidden" name="product_id" value={p.id} />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {active.map((x) => {
                        const r = mine.find((m) => m.station_id === x.id);
                        return (
                          <div key={x.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm">
                            <input type="checkbox" name="station" value={x.id} defaultChecked={!!r} aria-label={x.name} />
                            <span className="flex-1 truncate" style={{ borderLeft: `3px solid ${x.color ?? "#64748B"}`, paddingLeft: 6 }}>{x.name}</span>
                            <input name={`min_${x.id}`} defaultValue={r?.std_minutes ?? ""} placeholder="dk" inputMode="numeric" className="h-8 w-14 rounded border border-line px-1 text-right" aria-label="Birim süre (dk)" />
                            <label className="flex items-center gap-1 text-[11px] text-muted" title="Malzeme bu adım bitince düşer"><input type="radio" name="consume" value={x.id} defaultChecked={cons === x.id} />malz.</label>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Bu rotayı şu ürünlere de uygula" className="flex-1 min-w-60">
                        <select name="copy_to" multiple size={3} className={`${selectCls} h-auto py-1`}>{ps.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                      </Field>
                      {lvl >= 2 && <PendingSubmit className={btnPrimary}>Rotayı kaydet</PendingSubmit>}
                    </div>
                    <p className="text-xs text-muted">Süre birim (diş) başınadır. “malz.” işaretli istasyon bitince ürün reçetesindeki malzemeler üretim deposundan (yetmezse ana depodan) lot sırasıyla düşer. Reçete: <Link href="/stok/receteler" className="underline">Stok &gt; Ürün reçeteleri</Link>.</p>
                  </form>
                </details>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
