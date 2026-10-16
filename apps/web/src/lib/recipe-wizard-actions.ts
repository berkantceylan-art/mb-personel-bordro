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
type Res = { applied: number; service: number; kept_manual: number; unmatched: number };
const summary = (d: Res) =>
  `${d.applied} ürüne reçete yazıldı${d.service ? `, ${d.service} kalem hizmet (malzemesiz)` : ""}${d.kept_manual ? `, ${d.kept_manual} elle girilmiş reçete korundu` : ""}${d.unmatched ? `, ${d.unmatched} ürün eşleşmedi (listeden şablon seçin)` : ""}.`;

/** Kural ile eşleştir + reçetesi olmayanlara yaz (force: şablondan oluşanları yeniden yaz) */
export async function applyAllRecipes(f: FormData) {
  const { data, error } = await (await createClient()).rpc("prd_recipe_apply_all", { p_force: str(f, "force") === "1" });
  if (error) await fail(errText(error.message));
  refresh();
  await done(summary(data as Res));
}

/** Tek ürüne şablon seç ve reçeteyi yeniden yaz */
export async function setRecipeTemplate(f: FormData) {
  const tpl = str(f, "tpl") || null;
  const { error } = await (await createClient()).rpc("prd_recipe_set", { p_product: str(f, "product_id"), p_tpl: tpl, p_apply: true });
  if (error) await fail(errText(error.message));
  refresh();
  await done(tpl ? "Şablon uygulandı; reçete yeniden yazıldı." : "Şablon kaldırıldı.");
}

/** Yapay zekâ ile ürün ürün eşleştirme (Fransızca + Türkçe ad → şablon), sonra reçeteleri yaz */
export async function aiMatchRecipes() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) await fail("Yapay zekâ anahtarı tanımlı değil (Vercel: ANTHROPIC_API_KEY). Kural ile eşleştirme yine çalışır.");
  const sb = await createClient();
  const [{ data: rows, error }, { data: tpls }] = await Promise.all([
    sb.rpc("prd_recipe_wizard"),
    sb.from("prd_tpl").select("key, name, description").order("sort"),
  ]);
  if (error) await fail(errText(error.message));
  type R = { id: string; name: string; name_tr: string | null; material: string | null; is_active: boolean; source: string | null; has_manual: boolean };
  const list = ((rows ?? []) as R[]).filter((r) => r.is_active && r.source !== "elle" && !r.has_manual);
  if (!list.length) await done("Kontrol edilecek ürün yok (elle seçilenler ve elle girilmiş reçeteler atlanır).");
  const catalog = ((tpls ?? []) as { key: string; name: string; description: string }[]).map((t) => `${t.key}: ${t.name} — ${t.description}`).join("\n");
  const ai = new Anthropic({ apiKey: key! });
  const keys = new Set(((tpls ?? []) as { key: string }[]).map((t) => t.key));
  const out: { id: string; tpl: string | null }[] = [];
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    const res = await ai.messages.create({
      model: aiModel(),
      max_tokens: 4000,
      system:
        "Sen bir diş protez laboratuvarı üretim uzmanısın. Her ürünün Fransızca adını (ve varsa Türkçe çevirisini, malzeme bilgisini) okuyup " +
        "üretiminde hangi reçete şablonunun kullanılacağını seç. Yalnız aşağıdaki şablon anahtarlarından birini kullan. Malzeme tüketmeyen kalemler (rötuş, kargo, " +
        "indirim, renk alma, tasarım ücreti vb.) için 'hizmet' yaz. Gerçekten karar veremiyorsan null yaz.\n\nŞablonlar:\n" + catalog +
        "\n\nYalnız JSON dizi döndür: [{\"i\": sıra_no, \"t\": \"anahtar\"}] — girişteki her ürün için bir öğe. Açıklama yazma.",
      messages: [{ role: "user", content: JSON.stringify(part.map((r, k) => ({ i: k, fr: r.name, tr: r.name_tr, malzeme: r.material }))) }],
    });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) continue;
    try {
      for (const e of JSON.parse(m[0]) as { i: number; t: string | null }[]) {
        const r = part[e.i];
        if (r && (e.t === null || keys.has(e.t))) out.push({ id: r.id, tpl: e.t });
      }
    } catch { /* bu parti atlanır */ }
  }
  const { data: n, error: e2 } = await sb.rpc("prd_recipe_set_bulk", { p: out });
  if (e2) await fail(errText(e2.message));
  const { data: applied, error: e3 } = await sb.rpc("prd_recipe_apply_all", { p_force: false });
  if (e3) await fail(errText(e3.message));
  refresh();
  const d = applied as Res;
  await done(`Yapay zekâ ${Number(n ?? 0)} ürünü tek tek eşleştirdi. Şablonu değişen ${d.applied} ürünün reçetesi yeniden yazıldı${d.service ? `, ${d.service} kalem hizmet` : ""}${d.unmatched ? `, ${d.unmatched} ürün hâlâ eşleşmedi` : ""}.`);
}
