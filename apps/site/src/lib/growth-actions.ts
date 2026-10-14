"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "@/lib/auth";
import { LOCALES, type I18nText } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function i18n(f: FormData, base: string): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) { const v = str(f, `${base}.${l}`); if (v) out[l] = v; }
  return out;
}
const go = (path: string, kind: "ok" | "hata", msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);

/** Şehir / ülke sayfası kaydet */
export async function saveArea(f: FormData) {
  await requireSiteEditor();
  const id = str(f, "id");
  const slug = str(f, "slug").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const name = i18n(f, "name");
  if (!name.tr || slug.length < 2) go(id ? `/admin/bolgeler/${id}` : "/admin/bolgeler", "hata", "Türkçe ad ve adres (slug) zorunlu.");
  const row = {
    slug, kind: str(f, "kind") === "country" ? "country" : "city", name, title: i18n(f, "title"), intro: i18n(f, "intro"), body: i18n(f, "body"), delivery: i18n(f, "delivery"),
    shipping_days: str(f, "shipping_days") === "" ? null : Math.min(60, Math.max(0, Number(str(f, "shipping_days")) || 0)),
    is_active: f.get("is_active") === "on", sort: Number(str(f, "sort")) || 0,
  };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("cms_areas").update(row).eq("id", id) : await supabase.from("cms_areas").insert(row);
  if (error) go(id ? `/admin/bolgeler/${id}` : "/admin/bolgeler", "hata", /duplicate|unique/.test(error.message) ? "Bu adres (slug) zaten kullanılıyor." : /cms_areas/.test(error.message) ? "Supabase'de 20270201000000_site_growth_seo.sql çalıştırılmalı." : error.message);
  revalidatePath("/", "layout");
  go("/admin/bolgeler", "ok", "Bölge sayfası kaydedildi.");
}

export async function deleteArea(f: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  await supabase.from("cms_areas").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", str(f, "id"));
  revalidatePath("/", "layout");
  go("/admin/bolgeler", "ok", "Bölge sayfası kaldırıldı.");
}

/** Yapay zekâ görünürlük testi: soru ekle / kaldır */
export async function saveAiPrompt(f: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  if (str(f, "delete") === "1") {
    await supabase.from("cms_ai_prompts").delete().eq("id", str(f, "id"));
  } else {
    const prompt = str(f, "prompt").slice(0, 300);
    if (prompt.length < 5) go("/admin/yapay-zeka", "hata", "Soruyu yazın.");
    const { error } = await supabase.from("cms_ai_prompts").insert({ prompt, locale: ["tr", "en", "fr"].includes(str(f, "locale")) ? str(f, "locale") : "tr", sort: 500 });
    if (error) go("/admin/yapay-zeka", "hata", /cms_ai/.test(error.message) ? "Supabase'de 20270201000000_site_growth_seo.sql çalıştırılmalı." : error.message);
  }
  revalidatePath("/admin/yapay-zeka");
  go("/admin/yapay-zeka", "ok", "Kaydedildi.");
}

/** Test sonucu kaydet */
export async function saveAiCheck(f: FormData) {
  await requireSiteEditor();
  const pos = Number(str(f, "position"));
  const supabase = await createClient();
  const { error } = await supabase.from("cms_ai_checks").insert({
    prompt_id: str(f, "prompt_id"), engine: str(f, "engine"), checked_on: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "checked_on")) ? str(f, "checked_on") : undefined,
    mentioned: str(f, "result") !== "no", cited: str(f, "result") === "cited", position: pos >= 1 && pos <= 50 ? pos : null,
    cited_url: str(f, "cited_url").slice(0, 300) || null, competitors: str(f, "competitors").slice(0, 300) || null, note: str(f, "note").slice(0, 500) || null,
  });
  if (error) go("/admin/yapay-zeka", "hata", error.message);
  revalidatePath("/admin/yapay-zeka");
  go("/admin/yapay-zeka", "ok", "Sonuç kaydedildi.");
}
