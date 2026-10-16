"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { aiModel } from "@/lib/ai-model";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function errText(m: string) {
  if (/prd_recipe|prd_tpl|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-recete-sablonlari.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için üretim ya da stok düzenleme yetkisi gerekir.";
  if (/bad_template/.test(m)) return "Geçersiz şablon.";
  return m;
}
function refresh() {
  revalidatePath("/uretim/recete-sihirbazi");
  revalidatePath("/uretim/maliyet");
  revalidatePath("/stok/receteler");
}
type Res = { applied: number; service: number; kept_manual: number; unmatched: number; guessed?: number };
const summary = (d: Res, ai = 0) =>
  `${ai ? `Yapay zekâ ${ai} ürünü tek tek eşleştirdi. ` : ""}${d.applied} ürüne reçete yazıldı${d.service ? `, ${d.service} kalem hizmet (malzemesiz)` : ""}${d.guessed ? `, ${d.guessed} ürün tahminle eşlendi (listede “Tahmin” filtresiyle kontrol edin)` : ""}${d.kept_manual ? `, ${d.kept_manual} elle girilmiş reçete korundu` : ""}${d.unmatched ? `, ${d.unmatched} ürün eşleşmedi` : ""}.`;

type W = { id: string; name: string; name_tr: string | null; material: string | null; per_unit: boolean; source: string | null; tpl: string | null; has_manual: boolean };

/** Ürünleri yapay zekâya şablon seçtirir (50'lik partiler, 4 paralel); dönen: eşlenen sayısı */
async function aiClassify(sb: Awaited<ReturnType<typeof createClient>>, list: W[]): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !list.length) return 0;
  const { data: tpls } = await sb.from("prd_tpl").select("key, name, description").order("sort");
  const ts = (tpls ?? []) as { key: string; name: string; description: string }[];
  const catalog = ts.map((t) => `${t.key}: ${t.name} — ${t.description}`).join("\n");
  const keys = new Set(ts.map((t) => t.key));
  const ai = new Anthropic({ apiKey: key });
  const parts: W[][] = [];
  for (let i = 0; i < list.length; i += 50) parts.push(list.slice(i, i + 50));
  const out: { id: string; tpl: string }[] = [];
  const run = async (part: W[]) => {
    try {
      const res = await ai.messages.create({
        model: aiModel(),
        max_tokens: 4000,
        system:
          "Sen bir diş protez laboratuvarı üretim uzmanısın. Her ürünün adını (çoğu Fransızca; bazıları Türkçe, İngilizce, Almanca ya da kısaltma), varsa Türkçe çevirisini, " +
          "malzeme bilgisini ve diş başına mı iş başına mı fiyatlandığını okuyup üretiminde kullanılacak reçete şablonunu seç. Yalnız aşağıdaki anahtarlardan birini yaz; " +
          "boş bırakma, emin değilsen en yakın şablonu seç. Malzeme tüketmeyen kalemler (rötuş, kargo, indirim, renk alma, tasarım / tarama ücreti, fark, avans vb.) için 'hizmet'.\n\nŞablonlar:\n" + catalog +
          "\n\nYalnız JSON dizi döndür: [{\"i\": sıra_no, \"t\": \"anahtar\"}] — girişteki her ürün için bir öğe. Açıklama yazma.",
        messages: [{ role: "user", content: JSON.stringify(part.map((r, k) => ({ i: k, ad: r.name, tr: r.name_tr, malzeme: r.material, birim: r.per_unit ? "diş başına" : "iş başına" }))) }],
      });
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) return;
      for (const e of JSON.parse(m[0]) as { i: number; t: string | null }[]) {
        const r = part[e.i];
        if (r && e.t && keys.has(e.t)) out.push({ id: r.id, tpl: e.t });
      }
    } catch { /* bu parti atlanır; kalanlar tahminle eşlenir */ }
  };
  for (let i = 0; i < parts.length; i += 4) await Promise.all(parts.slice(i, i + 4).map(run));
  if (!out.length) return 0;
  const { data: n, error } = await sb.rpc("prd_recipe_set_bulk", { p: out });
  if (error) await fail(errText(error.message));
  return Number(n ?? 0);
}

async function wizardRows(sb: Awaited<ReturnType<typeof createClient>>): Promise<W[]> {
  const { data, error } = await sb.rpc("prd_recipe_wizard");
  if (error) await fail(errText(error.message));
  return (data ?? []) as W[];
}

/** Eksik reçeteleri oluştur: eşleşmeyenleri önce yapay zekâya sor, kalanlara tahmin; sonra yaz (force: şablondan oluşanları yeniden yaz) */
export async function applyAllRecipes(f: FormData) {
  const sb = await createClient();
  await sb.rpc("prd_recipe_refresh");
  const rows = await wizardRows(sb);
  const n = await aiClassify(sb, rows.filter((r) => !r.has_manual && r.source !== "elle" && (!r.tpl || r.source === "tahmin")));
  const { data, error } = await sb.rpc("prd_recipe_apply_all", { p_force: str(f, "force") === "1", p_fallback: true });
  if (error) await fail(errText(error.message));
  refresh();
  await done(summary(data as Res, n));
}

/** Tek ürüne şablon seç ve reçeteyi yeniden yaz */
export async function setRecipeTemplate(f: FormData) {
  const tpl = str(f, "tpl") || null;
  const { error } = await (await createClient()).rpc("prd_recipe_set", { p_product: str(f, "product_id"), p_tpl: tpl, p_apply: true });
  if (error) await fail(errText(error.message));
  refresh();
  await done(tpl ? "Şablon uygulandı; reçete yeniden yazıldı." : "Şablon kaldırıldı.");
}

/** Yapay zekâ ile tüm ürünleri (pasifler dahil) ürün ürün kontrol et, sonra reçeteleri yaz */
export async function aiMatchRecipes() {
  if (!process.env.ANTHROPIC_API_KEY) await fail("Yapay zekâ anahtarı tanımlı değil (Vercel: ANTHROPIC_API_KEY). “Eksik reçeteleri oluştur” kural ve tahminle yine çalışır.");
  const sb = await createClient();
  await sb.rpc("prd_recipe_refresh");
  const rows = await wizardRows(sb);
  const list = rows.filter((r) => r.source !== "elle" && !r.has_manual);
  if (!list.length) await done("Kontrol edilecek ürün yok (elle seçilenler ve elle girilmiş reçeteler atlanır).");
  const n = await aiClassify(sb, list);
  const { data, error } = await sb.rpc("prd_recipe_apply_all", { p_force: false, p_fallback: true });
  if (error) await fail(errText(error.message));
  refresh();
  await done(summary(data as Res, n));
}
