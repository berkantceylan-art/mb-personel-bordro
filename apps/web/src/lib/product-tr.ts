import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiModel } from "@/lib/ai-model";

/** Fransızca / İngilizce / Almanca protez ve laboratuvar ürün adlarını Türkçe karşılığına çevirir (diş laboratuvarı terminolojisi) */
export async function translateNames(names: string[]): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Yapay zekâ anahtarı tanımlı değil (Vercel: ANTHROPIC_API_KEY)");
  if (!names.length) return [];
  const res = await new Anthropic({ apiKey: key }).messages.create({
    model: aiModel(),
    max_tokens: 4000,
    system:
      "Sen bir diş protez laboratuvarı terminoloji uzmanısın. Sana verilen ürün / işlem adlarını (çoğu Fransızca, bazıları İngilizce, Almanca ya da zaten Türkçe) " +
      "Türk diş teknisyenlerinin kullandığı kısa Türkçe karşılığına çevir. Örnekler: 'COURONNE CERAMIQUE' → 'Metal destekli porselen kron', 'FULL ZIRCON' → 'Tam zirkonyum kron', " +
      "'STELLITE MONTAGE 1-13 DENTS' → 'İskelet protez dizim (1–13 diş)', 'PARTIEL FINITION DIRECTE' → 'Parsiyel protez direkt bitim', 'CIRE ESSAYAGE' → 'Mum prova', " +
      "'RETOUCHE' → 'Rötuş', 'REFAIT' → 'Yeniden yapım', 'INLAY ONLAY COMPOSITE' → 'Kompozit inley / onley', 'GOUTTIERE' → 'Plak (splint)', 'PROVISOIRE' → 'Geçici'. " +
      "Sayıları, diş aralıklarını, marka adlarını (E.max, Zircon, Bego…) koru. Ad zaten Türkçeyse aynen ya da düzeltilmiş halini yaz. " +
      "Yalnız JSON dizi döndür: girişle aynı sırada ve aynı uzunlukta Türkçe metinler. Açıklama yazma.",
    messages: [{ role: "user", content: JSON.stringify(names) }],
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("Çeviri yanıtı okunamadı");
  const arr = JSON.parse(m[0]) as unknown[];
  if (!Array.isArray(arr) || arr.length !== names.length) throw new Error("Çeviri sayısı tutmadı");
  return arr.map((x, i) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 160) : names[i]!));
}

/** Türkçe adı olmayan ürünleri çevirir; dönen: çevrilen sayısı ve kalan */
export async function translateMissing(sb: SupabaseClient, limit = 120): Promise<{ done: number; left: number }> {
  const { data, error } = await sb.from("lab_products").select("id, name").is("name_tr", null).eq("is_active", true).order("sort").limit(limit);
  if (error) throw new Error(/name_tr/.test(error.message) ? "Önce mbdental-dentalsis-duzenleme.sql dosyasını Supabase'de çalıştırın." : error.message);
  const rows = (data ?? []) as { id: string; name: string }[];
  let done = 0;
  for (let i = 0; i < rows.length; i += 60) {
    const part = rows.slice(i, i + 60);
    const tr = await translateNames(part.map((r) => r.name));
    const { data: n, error: e2 } = await sb.rpc("lab_products_set_tr", { p: part.map((r, k) => ({ id: r.id, name_tr: tr[k] })) });
    if (e2) throw new Error(e2.message);
    done += Number(n ?? 0);
  }
  const { count } = await sb.from("lab_products").select("id", { count: "exact", head: true }).is("name_tr", null).eq("is_active", true);
  return { done, left: count ?? 0 };
}
