import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { MATERIALS, money, type Product } from "@/lib/jobs";
import { bulkOutsourceProducts, deleteProduct, importProductsFromPriceList, saveProduct } from "../actions";
import { TranslateAll } from "./TranslateAll";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-[15px] w-full";
const lbl = "flex flex-col gap-1 text-sm text-muted";

/** Protez / ürün kartları ve fiyatları */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ duzenle?: string; q?: string; dis?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_products").select("*").order("sort").order("name");
  const list = (data ?? []) as Product[];
  const { data: osLabs } = await supabase.from("fin_parties").select("id, name").eq("outsource_lab", true).order("name");
  const labs = (osLabs ?? []) as { id: string; name: string }[];
  const labName = new Map(labs.map((l) => [l.id, l.name]));
  const osOf = (x: Product | undefined) => (x as { outsource_party_id?: string | null } | undefined)?.outsource_party_id ?? "";
  const p = sp.duzenle ? list.find((x) => x.id === sp.duzenle) : undefined;
  // arama: ad, Türkçe ad, kod (Türkçe harf duyarsız)
  const fold = (t: string) => t.toLocaleLowerCase("tr").replace(/[ıi̇]/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = (sp.q ?? "").trim();
  const shown = list.filter((x) => {
    if (sp.dis === "1" && !osOf(x)) return false;
    if (!q) return true;
    const hay = fold(`${x.name} ${(x as { name_tr?: string | null }).name_tr ?? ""} ${x.code ?? ""}`);
    return fold(q).split(/\s+/).every((w) => hay.includes(w));
  });
  const tl = (v: number | null) => (v != null ? (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "");

  return (
    <>
      <PageHeader title="Protez / ürün" subtitle={`${list.length} ürün · iş kayıtta fiyat buradan gelir`} actions={<form action={importProductsFromPriceList}><button className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Sitedeki fiyat listesinden aktar</button></form>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">Tablolar yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        <TranslateAll missing={list.filter((x) => !(x as { name_tr?: string | null }).name_tr).length} />
        <Card title={p ? `Düzenle: ${p.name}` : "Yeni ürün"} action={p ? <Link href="/isler/urunler" className="text-sm font-semibold text-brand-700">Vazgeç</Link> : undefined}>
          <form key={p?.id ?? "new"} action={saveProduct} className="grid gap-4 md:grid-cols-6">
            {p && <input type="hidden" name="id" value={p.id} />}
            <label className={lbl}>Kod<input name="code" defaultValue={p?.code ?? ""} className={inp} /></label>
            <label className={`${lbl} md:col-span-2`}>Ürün adı *<input name="name" required defaultValue={p?.name ?? ""} className={inp} /></label>
            <label className={`${lbl} md:col-span-2`}>Türkçe adı<input name="name_tr" defaultValue={(p as { name_tr?: string | null } | undefined)?.name_tr ?? ""} placeholder="Boş bırakılırsa otomatik çevrilir" className={inp} /></label>
            <label className={lbl}>
              Şema malzemesi
              <select name="material" defaultValue={p?.material ?? ""} className={inp}>
                <option value="">—</option>
                {Object.entries(MATERIALS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>Fiyat TL<input name="price_try" inputMode="decimal" defaultValue={tl(p?.price_try ?? null)} className={inp} /></label>
            <label className={lbl}>Fiyat €<input name="price_eur" inputMode="decimal" defaultValue={tl(p?.price_eur ?? null)} className={inp} /></label>
            <label className={lbl}>
              Fiyatlandırma
              <select name="per_unit" defaultValue={p?.per_unit === false ? "off" : "on"} className={inp}>
                <option value="on">Üye (diş) başına</option><option value="off">İş başına</option>
              </select>
            </label>
            <label className={lbl}>Sıra<input name="sort" inputMode="numeric" defaultValue={p?.sort ?? 0} className={inp} /></label>
            <label className={lbl}>
              Durum
              <select name="is_active" defaultValue={p?.is_active === false ? "off" : "on"} className={inp}>
                <option value="on">Aktif</option><option value="off">Pasif</option>
              </select>
            </label>
            {labs.length > 0 && (
              <label className={`${lbl} md:col-span-2`}>
                Nerede yapılır
                <select name="outsource_party_id" defaultValue={osOf(p)} className={inp}>
                  <option value="">Bizde (laboratuvarda)</option>
                  {labs.map((l) => <option key={l.id} value={l.id}>Dışarıda: {l.name}</option>)}
                </select>
              </label>
            )}
            <div className="md:col-span-3 flex items-end"><button className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">{p ? "Kaydet" : "Ürün ekle"}</button></div>
          </form>
          <p className="text-xs text-muted">{labs.length === 0 && <>Ortodonti gibi dışarıda yaptırılan ürünler için önce <Link href="/isler/ortodonti" className="text-brand-700 font-semibold">Ortodonti / dış lab</Link> ekranından laboratuvarı seçin. </>}Şema malzemesi seçilirse iş kayıtta &quot;Şemadan ürün satırı oluştur&quot; bu ürünü ve diş sayısını otomatik yazar. Hekim kartındaki iskonto fiyata uygulanır.</p>
        </Card>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input name="q" defaultValue={q} placeholder="Ürün ara (ad, Türkçe ad, kod)…" autoFocus className="h-11 flex-1 min-w-[240px] rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-[15px]" />
          {labs.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dis" value="1" defaultChecked={sp.dis === "1"} /> Yalnız dışarıda yapılanlar</label>}
          <button className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Ara</button>
          {(q || sp.dis) && <Link href="/isler/urunler" className="text-sm font-semibold text-brand-700">Temizle</Link>}
          <span className="text-sm text-muted ml-auto">{shown.length} / {list.length} ürün</span>
        </form>
        {labs.length > 0 && (
          <form id="toplu" action={bulkOutsourceProducts} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#C4B5FD] bg-[#F5F3FF] px-3 py-2 text-sm">
            <input type="hidden" name="back" value={`/isler/urunler?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.dis ? { dis: sp.dis } : {}) })}`} />
            <span className="font-semibold text-[#5B21B6]">Seçilen ürünler:</span>
            <select name="party" className="h-9 rounded-[8px] border border-[#D5DEE8] px-2 bg-white">
              {labs.map((l) => <option key={l.id} value={l.id}>Dışarıda: {l.name}</option>)}
              <option value="">Bizde (laboratuvarda)</option>
            </select>
            <input type="hidden" name="shown" value={shown.map((x) => x.id).join(",")} />
            <button className="h-9 px-4 rounded-[8px] bg-[#5B21B6] text-white font-semibold">Uygula</button>
            <span className="text-xs text-muted">Aşağıdan kutucukları işaretleyin (ör. &quot;plak&quot; arayıp hepsini seçin).</span>
          </form>
        )}
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead><tr className="text-xs text-muted text-left">{labs.length > 0 && <th className="py-2.5 pl-3 w-8"><input type="checkbox" form="toplu" name="all" value="1" title="Görünenlerin hepsi" /></th>}<th className="py-2.5 px-3">Kod</th><th className="py-2.5 px-3">Ürün</th><th className="py-2.5 px-3">Malzeme</th><th className="py-2.5 px-3 text-right">TL</th><th className="py-2.5 px-3 text-right">€</th><th className="py-2.5 px-3" /></tr></thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className={`border-t border-line ${x.is_active ? "" : "opacity-60"}`}>
                  {labs.length > 0 && <td className="py-2.5 pl-3"><input type="checkbox" form="toplu" name="ids" value={x.id} /></td>}
                  <td className="py-2.5 px-3 num text-muted">{x.code ?? ""}</td>
                  <td className="py-2.5 px-3"><Link href={`/isler/urunler?duzenle=${x.id}`} className="font-semibold text-brand-700">{x.name}</Link>{(x as { name_tr?: string | null }).name_tr && (x as { name_tr?: string | null }).name_tr !== x.name && <span className="block text-xs text-muted">🇹🇷 {(x as { name_tr?: string | null }).name_tr}</span>}{!x.per_unit && <span className="ml-2 text-[11px] text-muted">iş başına</span>}{osOf(x) && <span className="ml-2 text-[11px] font-semibold rounded bg-[#EDE9FE] text-[#5B21B6] px-1.5 py-0.5">dışarıda: {labName.get(osOf(x)) ?? "dış lab"}</span>}</td>
                  <td className="py-2.5 px-3">{x.material ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: MATERIALS[x.material]?.[1] }}>{MATERIALS[x.material]?.[0]}</span> : "—"}</td>
                  <td className="py-2.5 px-3 num text-right">{x.price_try != null ? money(x.price_try, "TRY") : "—"}</td>
                  <td className="py-2.5 px-3 num text-right">{x.price_eur != null ? money(x.price_eur, "EUR") : "—"}</td>
                  <td className="py-2.5 px-3 text-right"><form action={deleteProduct}><input type="hidden" name="id" value={x.id} /><ConfirmSubmit label="Sil" question="Ürün silinsin mi?" className="text-xs text-bad font-semibold" /></form></td>
                </tr>
              ))}
              {shown.length === 0 && list.length > 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">Aramaya uyan ürün yok.</td></tr>}
              {list.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Ürün yok. Üstteki formdan ekleyin ya da sitedeki fiyat listesinden aktarın.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
