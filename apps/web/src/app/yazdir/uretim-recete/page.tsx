import { redirect } from "next/navigation";
import { PrintShell } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ModeTabs, RecipeSheet, modeOf, type RecipeCost } from "./RecipeSheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Üretim reçeteleri" };

type Row = { id: string; name: string; code: string | null; material: string | null; lines: number; steps: number };

/** Reçetesi olan tüm ürünlerin üretim reçeteleri; her ürün yeni sayfada. ?q= arama, ?tur=atolye fiyatsız */
export default async function PrintAllRecipes({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const { q, tur } = await searchParams;
  const mode = modeOf(tur);
  const sb = await createClient();
  const { data, error } = await sb.rpc("prd_cost_list");
  if (error) return <p className="m-6 text-sm text-red-700">{error.message}</p>;

  const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
  const terms = norm(q ?? "").split(/\s+/).filter(Boolean);
  const rows = ((data ?? []) as Row[])
    .filter((r) => r.lines > 0 || r.steps > 0)
    .filter((r) => !terms.length || terms.every((t) => norm(`${r.name} ${r.code ?? ""} ${r.material ?? ""}`).includes(t)));

  // Ürün kartlarını 8'erli gruplar halinde çek (veritabanını boğmadan)
  const cards: RecipeCost[] = [];
  for (let i = 0; i < rows.length; i += 8) {
    const part = await Promise.all(rows.slice(i, i + 8).map((r) => sb.rpc("prd_product_cost", { p_product: r.id })));
    for (const p of part) if (p.data) cards.push(p.data as RecipeCost);
  }

  return (
    <PrintShell title="ÜRETİM REÇETELERİ" sub={`${cards.length} ürün · ${mode === "atolye" ? "Atölye nüshası (fiyatsız)" : "Maliyetli"}${q ? ` · arama: ${q}` : ""}`} back={`/uretim/maliyet${q ? `?q=${encodeURIComponent(q)}` : ""}`}
      tools={<ModeTabs base="/yazdir/uretim-recete" mode={mode} q={q} />}>
      {mode === "maliyetli" && cards.length > 1 && (
        <section>
          <div className="font-bold mb-1">Özet</div>
          <table className="w-full border-collapse">
            <thead><tr className="bg-[#EEF2F6]">{["Ürün", "Malzeme", "Adım", "Süre (dk)", "Malzeme (TL)", "İşçilik (TL)", "Üretim (TL)", "Tam maliyet (TL)", "Marj"].map((h, i) => <th key={h} className={`border border-[#9AA7B4] px-1.5 py-0.5 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.product.id}>
                  <td className="border border-[#9AA7B4] px-1.5 py-0.5">{c.product.name}</td>
                  {[c.materials.length, c.labor.length, c.minutes].map((v, i) => <td key={i} className="border border-[#9AA7B4] px-1.5 py-0.5 text-right">{v}</td>)}
                  {[c.material, c.labor_total, c.production, c.total].map((v, i) => <td key={i} className={`border border-[#9AA7B4] px-1.5 py-0.5 text-right tabular-nums ${i === 3 ? "font-bold" : ""}`}>{(Number(v) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>)}
                  <td className="border border-[#9AA7B4] px-1.5 py-0.5 text-right">{c.margin_try != null ? `%${Number(c.margin_try)}` : c.margin_eur != null ? `%${Number(c.margin_eur)} (€)` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {cards.map((c, i) => <RecipeSheet key={c.product.id} c={c} mode={mode} pageBreak={i > 0 || (mode === "maliyetli" && cards.length > 1)} />)}
      {!cards.length && <p className="text-center text-[#555] py-8">Yazdırılacak reçete bulunamadı.</p>}
    </PrintShell>
  );
}
