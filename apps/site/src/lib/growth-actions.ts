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

/** Aday durumu / sorumlu / not */
export async function saveLead(f: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const source = str(f, "source");
  const { error } = await supabase.from("cms_lead_status").upsert({
    source, ref_id: str(f, "id"), status: ["new", "contacted", "quoted", "won", "lost"].includes(str(f, "status")) ? str(f, "status") : "new",
    owner: str(f, "owner") || null, note: str(f, "note").slice(0, 1000) || null, updated_at: new Date().toISOString(),
  }, { onConflict: "source,ref_id" });
  if (error) go("/admin/adaylar", "hata", /cms_lead/.test(error.message) ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : error.message);
  revalidatePath("/admin/adaylar");
  go(`/admin/adaylar${str(f, "q") ? `?d=${encodeURIComponent(str(f, "q"))}` : ""}`, "ok", "Güncellendi.");
}

/** İçerik takvimi: kayıt ekle / güncelle / sil */
export async function savePlan(f: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const id = str(f, "id");
  const back = `/admin/icerik-takvimi${str(f, "ay") ? `?ay=${str(f, "ay")}` : ""}`;
  if (str(f, "delete") === "1") { await supabase.from("cms_content_plan").delete().eq("id", id); revalidatePath("/admin/icerik-takvimi"); go(back, "ok", "Silindi."); }
  const row = {
    plan_date: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "plan_date")) ? str(f, "plan_date") : new Date().toISOString().slice(0, 10),
    channel: ["blog", "instagram", "linkedin", "facebook", "newsletter", "youtube"].includes(str(f, "channel")) ? str(f, "channel") : "blog",
    title: str(f, "title").slice(0, 200), notes: str(f, "notes").slice(0, 4000) || null,
    status: ["idea", "draft", "scheduled", "published"].includes(str(f, "status")) ? str(f, "status") : "idea",
  };
  if (row.title.length < 2) go(back, "hata", "Başlık yazın.");
  const { error } = id ? await supabase.from("cms_content_plan").update(row).eq("id", id) : await supabase.from("cms_content_plan").insert(row);
  if (error) go(back, "hata", /cms_content/.test(error.message) ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : error.message);
  revalidatePath("/admin/icerik-takvimi");
  go(back, "ok", "Kaydedildi.");
}

/** Yapay zekâ ile 4 haftalık içerik planı önerisi (fikir olarak eklenir) */
export async function aiPlanMonth(f: FormData) {
  await requireSiteEditor();
  const { aiEnabled, claude } = await import("@/lib/ai");
  const back = `/admin/icerik-takvimi${str(f, "ay") ? `?ay=${str(f, "ay")}` : ""}`;
  if (!aiEnabled()) go(back, "hata", "Yapay zekâ anahtarı tanımlı değil.");
  const supabase = await createClient();
  const [{ data: pr }, { data: hits }] = await Promise.all([
    supabase.from("cms_products").select("name").is("deleted_at", null).limit(30),
    supabase.from("site_hits").select("path").eq("kind", "view").gte("at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(3000),
  ]);
  const products = ((pr ?? []) as Array<{ name: Record<string, string> }>).map((p) => p.name.tr).filter(Boolean).join(", ");
  const counts = new Map<string, number>();
  for (const h of (hits ?? []) as Array<{ path: string }>) counts.set(h.path, (counts.get(h.path) ?? 0) + 1);
  const topPages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p).join(", ");
  const start = /^\d{4}-\d{2}$/.test(str(f, "ay")) ? new Date(`${str(f, "ay")}-01T00:00:00Z`) : new Date();
  try {
    const out = await claude({
      system: "You plan marketing content for MB Dental, a digital dental laboratory in İzmir, Türkiye (customers: dentists and clinics in Türkiye and Europe, esp. France). Write in Turkish. Mix: blog articles that answer dentists' real questions (good for Google and AI answers), Instagram before/after and behind-the-scenes posts, LinkedIn professional posts. Reply ONLY with JSON: {\"items\":[{\"day\":1-28,\"channel\":\"blog|instagram|linkedin\",\"title\":\"...\",\"notes\":\"one-sentence brief\"}]} with 10-12 items spread over 4 weeks.",
      messages: [{ role: "user", content: `Ürünler: ${products || "zirkon, e.max, implant üstü, tam seramik"}. Sitede son 30 günde en çok bakılan sayfalar: ${topPages || "bilinmiyor"}. Ay: ${start.toISOString().slice(0, 7)}.` }],
      maxTokens: 2000, temperature: 0.6,
    });
    const m = out.match(/\{[\s\S]*\}/);
    const items = (m ? (JSON.parse(m[0]) as { items?: Array<{ day: number; channel: string; title: string; notes?: string }> }).items : []) ?? [];
    const ym = start.toISOString().slice(0, 7);
    const rows = items.slice(0, 14).map((it) => ({
      plan_date: `${ym}-${String(Math.min(28, Math.max(1, Number(it.day) || 1))).padStart(2, "0")}`,
      channel: ["blog", "instagram", "linkedin"].includes(it.channel) ? it.channel : "blog", title: String(it.title ?? "").slice(0, 200), notes: String(it.notes ?? "").slice(0, 4000) || null, status: "idea",
    })).filter((r) => r.title.length >= 2);
    if (rows.length) await supabase.from("cms_content_plan").insert(rows);
    revalidatePath("/admin/icerik-takvimi");
    go(back, "ok", `${rows.length} içerik fikri eklendi.`);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(back, "hata", "Yapay zekâ şu an cevap vermedi, tekrar deneyin.");
  }
}

/** Blog fikrinden yapay zekâ ile taslak yazı (yayında değil, Blog'da düzenlenir) */
export async function aiDraftFromPlan(f: FormData) {
  await requireSiteEditor();
  const { aiEnabled, claude } = await import("@/lib/ai");
  const back = `/admin/icerik-takvimi${str(f, "ay") ? `?ay=${str(f, "ay")}` : ""}`;
  if (!aiEnabled()) go(back, "hata", "Yapay zekâ anahtarı tanımlı değil.");
  const supabase = await createClient();
  const { data: p } = await supabase.from("cms_content_plan").select("*").eq("id", str(f, "id")).maybeSingle();
  if (!p) go(back, "hata", "Kayıt bulunamadı.");
  try {
    const out = await claude({
      system: "You write blog articles for MB Dental, a digital dental laboratory in İzmir. Audience: dentists. Write in Turkish, professional, practical, 600-900 words. Start with a 2-sentence direct answer, then sections with '## ' headings, short paragraphs and '- ' bullet lists, end with a short FAQ (3 questions as '## Sık sorulanlar' then '### question' lines and answers). Do not invent statistics or prices. Reply ONLY with JSON: {\"title\":\"...\",\"summary\":\"one sentence\",\"body\":\"...\"}",
      messages: [{ role: "user", content: `Konu: ${p!.title}\nNot: ${p!.notes ?? ""}` }],
      maxTokens: 3500, temperature: 0.5,
    });
    const m = out.match(/\{[\s\S]*\}/);
    const j = m ? (JSON.parse(m[0]) as { title?: string; summary?: string; body?: string }) : null;
    if (!j?.title || !j.body) go(back, "hata", "Taslak okunamadı, tekrar deneyin.");
    const slug = j!.title!.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) + "-" + Math.random().toString(36).slice(2, 6);
    const { data: post, error } = await supabase.from("cms_posts").insert({ slug, title: { tr: j!.title }, summary: { tr: j!.summary ?? "" }, body: { tr: j!.body }, is_active: false, publish_at: `${p!.plan_date}T07:00:00Z` }).select("id").single();
    if (error) go(back, "hata", error.message);
    await supabase.from("cms_content_plan").update({ status: "draft", post_id: post!.id }).eq("id", p!.id);
    revalidatePath("/admin/icerik-takvimi");
    redirect(`/admin/blog/${post!.id}?ok=${encodeURIComponent("Yapay zekâ taslağı hazır: kontrol edip yayına alın.")}`);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(back, "hata", "Yapay zekâ şu an cevap vermedi, tekrar deneyin.");
  }
}

/** A/B testi ayarla / başlat / durdur / kazananı seç */
export async function saveAb(f: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const key = str(f, "key");
  const act = str(f, "act");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (act === "save") { patch.variant_a = i18n(f, "a"); patch.variant_b = i18n(f, "b"); }
  if (act === "start") { patch.is_active = true; patch.started_at = new Date().toISOString(); patch.winner = null; }
  if (act === "stop") patch.is_active = false;
  if (act === "A" || act === "B") { patch.winner = act; patch.is_active = false; }
  const { error } = await supabase.from("cms_ab_tests").update(patch).eq("key", key);
  if (error) go("/admin/ab-test", "hata", /cms_ab/.test(error.message) ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : error.message);
  revalidatePath("/", "layout");
  go("/admin/ab-test", "ok", "Kaydedildi.");
}
