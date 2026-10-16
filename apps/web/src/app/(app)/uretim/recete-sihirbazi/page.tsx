import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, btnSecondary, inputCls, page, selectCls, td, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { aiMatchRecipes, applyAllRecipes, setRecipeTemplate } from "@/lib/recipe-wizard-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Reçete sihirbazı" };

type Row = { id: string; code: string | null; name: string; name_tr: string | null; material: string | null; per_unit: boolean; is_active: boolean; tpl: string | null; source: string | null; applied_tpl: string | null; lines: number; steps: number; has_manual: boolean };
type Tpl = { key: string; name: string; description: string; per: string; sort: number };
type Line = { tpl: string; code: string; qty: number; waste: number; note: string | null };
type Item = { code: string; name: string; unit: string; price: number };
type Step = { tpl: string; station: string; minutes: number };
type Station = { code: string; name: string; sort: number };

const PAGE = 50;
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const SRC: Record<string, [string, "gray" | "blue" | "green" | "amber"]> = { kural: ["Kural", "gray"], ai: ["Yapay zekâ", "blue"], elle: ["Elle", "green"], tahmin: ["Tahmin — kontrol edin", "amber"] };

/** Üretim reçetesi sihirbazı: her protez ürününü Fransızca + Türkçe adına göre bir reçete şablonuna eşler ve reçeteyi yazar */
export default async function RecipeWizardPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; s?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const canEdit = (s.modules.production ?? 0) >= 2 || (s.modules.stock ?? 0) >= 2;
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data, error }, { data: tpls }, { data: lines }, { data: items }, { data: steps }, { data: stations }] = await Promise.all([
    sb.rpc("prd_recipe_wizard"),
    sb.from("prd_tpl").select("key, name, description, per, sort").order("sort"),
    sb.from("prd_tpl_lines").select("tpl, code, qty, waste, note"),
    sb.from("prd_tpl_items").select("code, name, unit, price"),
    sb.from("prd_tpl_steps").select("tpl, station, minutes"),
    sb.from("prd_tpl_stations").select("code, name, sort"),
  ]);
  const rows = (data ?? []) as Row[];
  const ts = (tpls ?? []) as Tpl[];
  const tname = new Map(ts.map((t) => [t.key, t.name]));
  const imap = new Map(((items ?? []) as Item[]).map((i) => [i.code, i]));
  const stMap = new Map(((stations ?? []) as Station[]).map((x) => [x.code, x]));

  const count = (k: string | null) => rows.filter((r) => r.tpl === k).length;
  const nNone = rows.filter((r) => !r.tpl && !r.has_manual).length;
  const nManual = rows.filter((r) => r.has_manual).length;
  const nDone = rows.filter((r) => r.lines > 0 || (r.tpl === "hizmet" && r.applied_tpl === "hizmet")).length;
  const nService = rows.filter((r) => r.tpl === "hizmet").length;
  const nGuess = rows.filter((r) => r.source === "tahmin").length;
  const nMissing = rows.filter((r) => !(r.lines > 0 || r.steps > 0) && r.tpl !== "hizmet").length;
  const f = sp.f ?? "";
  const terms = norm(sp.q ?? "").split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) =>
    (f === "" || (f === "yok" ? !r.tpl && !r.has_manual : f === "eksik" ? !(r.lines > 0 || r.steps > 0) && r.tpl !== "hizmet" : f === "tahmin" ? r.source === "tahmin" : f === "pasif" ? !r.is_active : f === "elle" ? r.has_manual : r.tpl === f)) &&
    (!terms.length || terms.every((t) => norm(`${r.name} ${r.name_tr ?? ""} ${r.code ?? ""} ${r.material ?? ""}`).includes(t))));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(Math.max(1, Number(sp.s) || 1), pages);
  const pageRows = shown.slice((cur - 1) * PAGE, cur * PAGE);
  const link = (o: { f?: string; s?: number }) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    const ff = o.f ?? f;
    if (ff) u.set("f", ff);
    if (o.s && o.s > 1) u.set("s", String(o.s));
    const t = u.toString();
    return t ? `/uretim/recete-sihirbazi?${t}` : "/uretim/recete-sihirbazi";
  };
  const tplCost = (k: string) => ((lines ?? []) as Line[]).filter((l) => l.tpl === k).reduce((t, l) => t + Math.round(Number(l.qty) * (1 + Number(l.waste) / 100) * (imap.get(l.code)?.price ?? 0)), 0);

  return (
    <>
      <PageHeader title="Üretim reçetesi sihirbazı" subtitle="Her protez ürünü Fransızca ve Türkçe adına göre bir reçete şablonuna eşlenir; malzemeler ve üretim adımları otomatik yazılır. Elle girdiğiniz reçeteler korunur."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/uretim/maliyet" className="text-brand-700">Ürün maliyetleri</Link><Link href="/stok/receteler" className="text-brand-700">Malzeme reçeteleri</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">{/prd_recipe|schema cache|does not exist/.test(error.message) ? "Supabase'de mbdental-recete-sablonlari.sql çalıştırılmalı." : error.message}</Notice>}

        <section className="rounded-[20px] p-5 text-white bg-gradient-to-br from-[#06213f] via-[#0a3d73] to-[#13649f] flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={`Ürün (${rows.filter((r) => !r.is_active).length} pasif dahil)`} value={rows.length} />
            <Stat label={`Reçetesi hazır (${nService} hizmet)`} value={nDone} />
            <Stat label="Tahminle eşlenen (kontrol edin)" value={nGuess} warn={nGuess > 0} />
            <Stat label="Reçetesi eksik" value={nMissing} warn={nMissing > 0} />
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <form action={aiMatchRecipes}><PendingSubmit className="h-11 px-5 rounded-xl bg-white text-brand-800 font-semibold">Yapay zekâ ile ürün ürün kontrol et</PendingSubmit></form>
              <form action={applyAllRecipes}><PendingSubmit className="h-11 px-5 rounded-xl border border-white/40 text-white font-semibold">Eksik reçeteleri oluştur</PendingSubmit></form>
              <form action={applyAllRecipes} className="flex items-center"><input type="hidden" name="force" value="1" /><ConfirmSubmit label="Şablondan oluşanları yeniden yaz" question="Şablondan oluşan reçetelerdeki elle değişiklikler silinir. Devam?" className="h-11 px-4 rounded-xl text-white/80 text-sm font-semibold underline" /></form>
            </div>
          )}
          <p className="text-xs text-white/70">“Eksik reçeteleri oluştur” eşleşmeyen ürünleri önce yapay zekâya sorar, yine kalanlara malzeme / birim bilgisinden tahmini şablon verir. “Yapay zekâ ile ürün ürün kontrol et” tüm ürünleri (pasifler dahil) baştan kontrol eder; birkaç dakika sürebilir. Elle seçtiğiniz şablonlar ve elle girilmiş reçeteler değişmez. Miktarlar sektörde tipik değerler, fiyatlar tahmini: alış yaptıkça ortalama alış fiyatı kullanılır.</p>
        </section>

        <form className="flex flex-wrap items-center gap-2">
          <input name="q" type="search" defaultValue={sp.q} placeholder="Ürün ara: Fransızca / Türkçe ad, kod" className={`${inputCls} flex-1 min-w-[240px] max-w-xl`} />
          <select name="f" defaultValue={f} className={`${selectCls} w-64`}>
            <option value="">Tüm şablonlar</option>
            <option value="eksik">Reçetesi eksik ({nMissing})</option>
            <option value="tahmin">Tahminle eşlenenler ({nGuess})</option>
            <option value="yok">Şablonu seçilmemiş ({nNone})</option>
            <option value="pasif">Pasif ürünler ({rows.filter((r) => !r.is_active).length})</option>
            <option value="elle">Elle girilmiş reçeteler ({nManual})</option>
            {ts.map((t) => <option key={t.key} value={t.key}>{t.name} ({count(t.key)})</option>)}
          </select>
          <button className={btnSecondary}>Filtrele</button>
          {(sp.q || f) && <Link href="/uretim/recete-sihirbazi" className="text-sm font-semibold text-muted">Temizle</Link>}
          <span className="ml-auto text-sm text-muted">{shown.length} ürün{pages > 1 ? ` · sayfa ${cur} / ${pages}` : ""}</span>
        </form>

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-xs text-muted bg-[#F7F9FB]"><th className={th}>Ürün (Fransızca)</th><th className={th}>Türkçe</th><th className={th}>Şablon</th><th className={th}>Reçete</th></tr></thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className={td}><span className="font-semibold">{r.name}</span>{!r.is_active && <span className="ml-1.5"><Chip>pasif</Chip></span>}<span className="block text-xs text-muted">{r.code ?? ""}{r.material ? ` · ${r.material}` : ""} · {r.per_unit ? "üye başına" : "iş başına"}</span></td>
                  <td className={td}>{r.name_tr ?? <span className="text-muted">—</span>}</td>
                  <td className={td}>
                    {canEdit ? (
                      <form action={setRecipeTemplate} className="flex items-center gap-2">
                        <input type="hidden" name="product_id" value={r.id} />
                        <select name="tpl" defaultValue={r.tpl ?? ""} className={`${selectCls} h-9 min-w-[230px]`} aria-label="Şablon">
                          <option value="">— seçilmedi —</option>
                          {ts.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                        <PendingSubmit className="h-9 px-3 rounded-[10px] border border-line text-xs font-semibold hover:border-brand-600">Uygula</PendingSubmit>
                      </form>
                    ) : (r.tpl ? tname.get(r.tpl) : "—")}
                    <span className="flex gap-1.5 mt-1">{r.source && <Chip tone={SRC[r.source]?.[1]}>{SRC[r.source]?.[0]}</Chip>}{r.has_manual && <Chip tone="amber">elle girilmiş reçete korunuyor</Chip>}{r.tpl && r.applied_tpl && r.applied_tpl !== r.tpl && <Chip tone="amber">uygulanmayı bekliyor</Chip>}</span>
                  </td>
                  <td className={td}>
                    {r.tpl === "hizmet" && r.lines === 0 ? <span className="text-muted">Malzeme yok (hizmet)</span>
                      : r.lines || r.steps ? <Link href={`/uretim/maliyet/${r.id}`} className="font-semibold text-brand-700">{r.lines} malzeme · {r.steps} adım →</Link>
                      : <span className="text-muted">Reçete yok</span>}
                  </td>
                </tr>
              ))}
              {!pageRows.length && <tr><td colSpan={4} className="p-8 text-center text-muted">{rows.length ? "Filtreye uyan ürün yok." : "Ürün yok."}</td></tr>}
            </tbody>
          </table>
        </section>
        {pages > 1 && (
          <nav className="flex flex-wrap gap-2 text-sm">
            {Array.from({ length: pages }, (_, n) => n + 1).map((n) => (
              <Link key={n} href={link({ s: n })} className={`min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-[10px] font-semibold ${n === cur ? "bg-brand-700 text-white" : "border border-line bg-white text-muted"}`}>{n}</Link>
            ))}
          </nav>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-display font-bold text-brand-800 text-lg">Reçete şablonları</h2>
          <p className="text-sm text-muted">Her şablonun malzemeleri, birim başına miktarı, fire payı ve üretim adımları. Ürüne uygulandıktan sonra ürünün maliyet kartından miktar ve fiyatları değiştirebilirsiniz.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {ts.map((t) => {
              const ls = ((lines ?? []) as Line[]).filter((l) => l.tpl === t.key);
              const ss = ((steps ?? []) as Step[]).filter((x) => x.tpl === t.key).sort((a, b) => (stMap.get(a.station)?.sort ?? 0) - (stMap.get(b.station)?.sort ?? 0));
              return (
                <details key={t.key} className="rounded-[14px] border border-line bg-white p-4 text-sm">
                  <summary className="cursor-pointer flex flex-wrap items-baseline gap-2">
                    <b className="text-brand-800">{t.name}</b>
                    <span className="text-xs text-muted">{t.per === "üye" ? "üye başına" : "iş başına"} · {count(t.key)} ürün{ls.length ? ` · malzeme ≈ ${money(tplCost(t.key), "TRY")}` : ""}{ss.length ? ` · ${ss.reduce((a, x) => a + x.minutes, 0)} dk` : ""}</span>
                  </summary>
                  <p className="text-xs text-muted mt-2">{t.description}</p>
                  {ls.length > 0 && (
                    <table className="w-full mt-2">
                      <tbody>
                        {ls.map((l) => {
                          const it = imap.get(l.code);
                          return <tr key={l.code} className="border-t border-[#EEF2F6]"><td className="py-1.5">{it?.name}{l.note && <span className="block text-[11px] text-muted">{l.note}</span>}</td><td className="py-1.5 text-right whitespace-nowrap num">{Number(l.qty).toLocaleString("tr-TR")} {it?.unit}{Number(l.waste) ? ` +%${Number(l.waste)}` : ""}</td></tr>;
                        })}
                      </tbody>
                    </table>
                  )}
                  {ss.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{ss.map((x) => <span key={x.station} className="rounded-full bg-[#F1F4F8] px-2.5 py-1 text-xs">{stMap.get(x.station)?.name} · {x.minutes} dk</span>)}</div>}
                </details>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3">
      <div className="text-xs text-white/70">{label}</div>
      <div className={`font-display text-2xl font-bold ${warn ? "text-amber-300" : ""}`}>{value}</div>
    </div>
  );
}
