import { notFound, redirect } from "next/navigation";
import { PrintShell } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ModeTabs, RecipeSheet, modeOf, type RecipeCost } from "../RecipeSheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Üretim reçetesi" };

/** Tek ürünün üretim reçetesi çıktısı (A4). ?tur=atolye → fiyatsız atölye nüshası */
export default async function PrintRecipe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tur?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const mode = modeOf((await searchParams).tur);
  const { data, error } = await (await createClient()).rpc("prd_product_cost", { p_product: id });
  if (error) return <p className="m-6 text-sm text-red-700">{error.message}</p>;
  const c = data as RecipeCost | null;
  if (!c) notFound();

  return (
    <PrintShell title="ÜRETİM REÇETESİ" sub={mode === "atolye" ? "Atölye nüshası (fiyatsız)" : "Maliyetli"} back={`/uretim/maliyet/${id}`}
      tools={<ModeTabs base={`/yazdir/uretim-recete/${id}`} mode={mode} />}>
      <RecipeSheet c={c} mode={mode} />
    </PrintShell>
  );
}
