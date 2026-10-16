import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Money, Notice, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { deleteBom, saveBom } from "@/lib/stock-actions";
import { qty, stockImageUrl } from "@/lib/stock";

export const dynamic = "force-dynamic";

const PAGE = 20;
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** Ürün reçeteleri (malzeme ihtiyacı): her laboratuvar ürünü için birim başına tüketilen malzeme. Üretimde otomatik stok düşümü buradan yapılır. */
export default async function BomPage({ searchParams }: { searchParams: Promise<{ urun?: string; q?: string; f?: string; s?: string }> }) {
  const s = await getSession();
  const level = s.modules.stock ?? 0;
  if (level < 1 && (s.modules.production ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const filter = sp.f === "hepsi" || sp.f === "yok" ? sp.f : sp.q || sp.urun ? "hepsi" : "var";
  const pageNo = Math.max(1, Number(sp.s) || 1);
  const supabase = await createClient();
  const [{ data: products }, { data: boms, error }] = await Promise.all([
    supabase.from("lab_products").select("id, code, name, name_tr, material, per_unit, price_try, is_active").order("sort").order("name"),
    supabase.from("stk_boms").select("id, lab_product_id, item_id, qty, waste_pct, note"),
  ]);
  type P = { id: string; code: string | null; name: string; name_tr: string | null; material: string | null; per_unit: boolean; price_try: number | null; is_active: boolean };
  type B = { id: string; lab_product_id: string; item_id: string; qty: number; waste_pct: number; note: string | null };
  const ps = (products ?? []) as P[];
  const bs = (boms ?? []) as B[];
  const byProduct = new Map<string, B[]>();
  for (const b of bs) byProduct.set(b.lab_product_id, [...(byProduct.get(b.lab_product_id) ?? []), b]);

  // Arama + filtre (ad, Türkçe ad, kod, malzeme; Türkçe karakter duyarsız)
  const terms = norm(sp.q ?? "").split(/\s+/).filter(Boolean);
  const matched = ps.filter((p) => {
    if (sp.urun) return p.id === sp.urun;
    const has = (byProduct.get(p.id)?.length ?? 0) > 0;
    if (filter === "var" && !has) return false;
    if (filter === "yok" && has) return false;
    if (!terms.length) return true;
    const hay = norm(`${p.name} ${p.name_tr ?? ""} ${p.code ?? ""} ${p.material ?? ""}`);
    return terms.every((t) => hay.includes(t));
  });
  const pages = Math.max(1, Math.ceil(matched.length / PAGE));
  const cur = Math.min(pageNo, pages);
  const shown = matched.slice((cur - 1) * PAGE, cur * PAGE);
  const nWith = ps.filter((p) => (byProduct.get(p.id)?.length ?? 0) > 0).length;

  // Yalnız ekrandaki kartların ihtiyacı: malzeme listesi, reçetedeki kalemlerin maliyeti, ürün resimleri
  const needItems = [...new Set(shown.flatMap((p) => (byProduct.get(p.id) ?? []).map((b) => b.item_id)))];
  const [{ data: items }, { data: used }, { data: tot }, { data: pics }] = await Promise.all([
    level >= 2 && shown.length
      ? supabase.from("stk_items").select("id, code, name, unit").eq("is_active", true).in("kind", ["material", "raw", "consumable", "packaging"]).is("lab_product_id", null).order("name").limit(3000)
      : Promise.resolve({ data: [] as { id: string; code: string; name: string; unit: string }[] }),
    needItems.length ? supabase.from("stk_items").select("id, code, name, unit").in("id", needItems) : Promise.resolve({ data: [] as { id: string; code: string; name: string; unit: string }[] }),
    needItems.length ? supabase.from("stk_item_totals").select("item_id, avg_cost").in("item_id", needItems) : Promise.resolve({ data: [] as { item_id: string; avg_cost: number }[] }),
    shown.length ? supabase.from("stk_items").select("lab_product_id, image_path").in("lab_product_id", shown.map((p) => p.id)).not("image_path", "is", null) : Promise.resolve({ data: [] as { lab_product_id: string; image_path: string }[] }),
  ]);
  type I = { id: string; code: string; name: string; unit: string };
  const is = (items ?? []) as I[];
  const imap = new Map(((used ?? []) as I[]).map((i) => [i.id, i]));
  const cost = new Map(((tot ?? []) as { item_id: string; avg_cost: number }[]).map((t) => [t.item_id, Number(t.avg_cost ?? 0)]));
  const pic = new Map(((pics ?? []) as { lab_product_id: string; image_path: string }[]).map((r) => [r.lab_product_id, stockImageUrl(r.image_path)]));
  const lineCost = (b: B) => Math.round(Number(b.qty) * (1 + Number(b.waste_pct) / 100) * (cost.get(b.item_id) ?? 0));

  const link = (o: { f?: string; s?: number }) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    const f = o.f ?? filter;
    if (f !== "var" || sp.q) u.set("f", f);
    if (o.s && o.s > 1) u.set("s", String(o.s));
    const t = u.toString();
    return t ? `/stok/receteler?${t}` : "/stok/receteler";
  };
  const tab = (f: string, label: string, n?: number) => (
    <Link href={link({ f })} className={`px-3 py-2 ${filter === f ? "bg-brand-700 text-white" : "bg-white text-muted hover:text-brand-700"}`}>{label}{n != null && <span className="opacity-70"> ({n})</span>}</Link>
  );

  return (
    <>
      <PageHeader title="Ürün reçeteleri" subtitle="Hangi üründe birim (diş / adet) başına hangi malzemeden ne kadar harcanır? Üretim modülü stok düşümünü ve maliyeti buradan hesaplar."
        actions={<Link href="/uretim/maliyet" className="text-sm font-semibold text-brand-700">Ürün maliyetleri →</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        {ps.length === 0 && <Notice>Önce Laboratuvar &gt; Ürün / fiyat listesinden ürün tanımlayın.</Notice>}
        {level >= 2 && shown.length > 0 && is.length === 0 && <Notice tone="info">Reçeteye eklemek için önce <Link href="/stok/urunler#yeni" className="font-semibold underline">malzeme kartı</Link> açın (tür: malzeme, hammadde, sarf ya da ambalaj).</Notice>}

        {sp.urun ? (
          <Link href="/stok/receteler" className="text-sm font-semibold text-brand-700">← Tüm ürünler</Link>
        ) : (
          <form className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px] max-w-xl">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input name="q" type="search" defaultValue={sp.q} autoFocus={!!sp.q} placeholder="Ürün ara: ad, kod, malzeme (ör. zirkon, porselen, PFM)" className={`${inputCls} pl-10 w-full`} />
            </div>
            {sp.q && <input type="hidden" name="f" value={filter} />}
            <button className={btnSecondary}>Ara</button>
            {sp.q && <Link href="/stok/receteler" className="text-sm font-semibold text-muted hover:text-brand-700">Temizle</Link>}
            <span className="ml-auto inline-flex rounded-[10px] border border-line overflow-hidden text-sm font-semibold">
              {tab("var", "Reçetesi olan", nWith)}
              {tab("yok", "Reçetesiz", ps.length - nWith)}
              {tab("hepsi", "Hepsi", ps.length)}
            </span>
          </form>
        )}

        {!sp.urun && (
          <p className="text-sm text-muted">
            {matched.length} ürün{sp.q ? ` · “${sp.q}” araması` : ""}{pages > 1 ? ` · sayfa ${cur} / ${pages}` : ""}
            {filter === "var" && !sp.q && nWith === 0 && ps.length > 0 && <> · Henüz reçetesi olan ürün yok — <Link href={link({ f: "hepsi" })} className="font-semibold text-brand-700">tüm ürünleri göster</Link></>}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((p) => {
            const rows = byProduct.get(p.id) ?? [];
            const total = rows.reduce((t, b) => t + lineCost(b), 0);
            const price = Number(p.price_try ?? 0);
            const img = pic.get(p.id);
            return (
              <section key={p.id} className={`bg-white border border-line rounded-[14px] overflow-hidden ${p.is_active ? "" : "opacity-60"}`}>
                <header className="px-4 py-3 border-b border-line flex items-center gap-3">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" loading="lazy" className="w-11 h-11 rounded-[10px] object-cover border border-line bg-white shrink-0" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug">{p.name_tr?.trim() || p.name}</h2>
                    <span className="text-xs text-muted">{p.code ?? ""} {p.material ?? ""} · {p.per_unit ? "diş başına" : "iş başına"}</span>
                  </div>
                  <span className="text-sm text-right shrink-0">Malzeme maliyeti <b><Money v={total} /></b>{price > 0 && total > 0 && <span className="block text-xs text-muted">fiyatın %{Math.round((total / price) * 100)}&apos;i</span>}</span>
                </header>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted"><th className={th}>Malzeme</th><th className={`${th} text-right`}>Miktar</th><th className={`${th} text-right`}>Fire</th><th className={`${th} text-right`}>Maliyet</th><th className={th} /></tr></thead>
                  <tbody>
                    {rows.map((b) => {
                      const it = imap.get(b.item_id);
                      return (
                        <tr key={b.id}>
                          <td className={td}>{it?.name ?? "?"}<span className="block text-xs text-muted num">{it?.code}{b.note ? ` · ${b.note}` : ""}</span></td>
                          <td className={tdNum}>{qty(b.qty)} {it?.unit}</td>
                          <td className={tdNum}>%{qty(b.waste_pct)}</td>
                          <td className={tdNum}><Money v={lineCost(b)} /></td>
                          <td className={`${td} text-right`}>{level >= 2 && <form action={deleteBom}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit label="Sil" /></form>}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={5} className="py-4 px-3 text-muted">Reçete yok.</td></tr>}
                  </tbody>
                </table>
                {level >= 2 && is.length > 0 && (
                  <form action={saveBom} className="p-3 bg-[#F8FAFC] border-t border-line grid gap-2 grid-cols-[1fr_90px_70px_auto] items-center">
                    <input type="hidden" name="lab_product_id" value={p.id} />
                    <select name="item_id" required className={`${selectCls} h-10`} aria-label="Malzeme">
                      <option value="">Malzeme seçin</option>
                      {is.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                    </select>
                    <input name="qty" required inputMode="decimal" placeholder="Miktar" className={`${inputCls} h-10 text-right`} />
                    <input name="waste_pct" inputMode="decimal" placeholder="Fire %" className={`${inputCls} h-10 text-right`} />
                    <PendingSubmit className={`${btnPrimary} h-10`}>Ekle</PendingSubmit>
                    <input name="note" maxLength={200} placeholder="Not (isteğe bağlı)" className={`${inputCls} h-9 col-span-4`} />
                  </form>
                )}
              </section>
            );
          })}
        </div>
        {!shown.length && ps.length > 0 && <Notice tone="info">Aramaya uyan ürün yok.{filter !== "hepsi" && <> <Link href={link({ f: "hepsi" })} className="font-semibold underline">Tüm ürünlerde ara</Link></>}</Notice>}

        {pages > 1 && (
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {cur > 1 && <Link href={link({ s: cur - 1 })} className={btnSecondary}>← Önceki</Link>}
            {Array.from({ length: pages }, (_, n) => n + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 2).map((n, k, arr) => (
              <span key={n} className="flex items-center gap-2">
                {k > 0 && n - arr[k - 1] > 1 && <span className="text-muted">…</span>}
                <Link href={link({ s: n })} className={`min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-[10px] font-semibold ${n === cur ? "bg-brand-700 text-white" : "border border-line bg-white text-muted"}`}>{n}</Link>
              </span>
            ))}
            {cur < pages && <Link href={link({ s: cur + 1 })} className={btnSecondary}>Sonraki →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
