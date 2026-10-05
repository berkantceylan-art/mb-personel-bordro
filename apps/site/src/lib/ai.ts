import { publicFaqs, publicPages, publicProducts } from "./cms";
import { groupedSchedule, hasSchedule } from "./hours";
import { t, type Locale } from "./i18n";
import { getSettings } from "./settings";

/**
 * Yapay zekâ (Anthropic Claude API). ANTHROPIC_API_KEY yoksa tüm özellikler kapalıdır
 * ve arayüzde görünmez. Model AI_MODEL ile değiştirilebilir.
 */
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.AI_MODEL || "claude-haiku-4-5-20251001";

export type AiMessage = { role: "user" | "assistant"; content: string };

export async function claude(opts: { system: string; messages: AiMessage[]; maxTokens?: number; temperature?: number }): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ai_disabled");
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.3,
      system: opts.system,
      messages: opts.messages,
    }),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ai_http_${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}

/** Sitenin güncel bilgileri: ürünler, SSS, sayfalar, iletişim ve saatler */
export async function siteKnowledge(): Promise<string> {
  const [products, faqs, pages, st] = await Promise.all([publicProducts(), publicFaqs(), publicPages(), getSettings()]);
  const L: Locale = "tr";
  const lines: string[] = [];
  lines.push("## İletişim");
  lines.push(`Telefon: ${st.phone} · E-posta: ${st.email}${st.whatsapp ? ` · WhatsApp: +${st.whatsapp}` : ""}`);
  lines.push(`Adres: ${[st.address1, st.address2].filter(Boolean).join(", ")}`);
  if (hasSchedule(st.schedule)) lines.push(`Çalışma saatleri (Türkiye saati): ${groupedSchedule(st.schedule, L).map((g) => `${g.days} ${g.hours}`).join("; ")}`);
  if (t(st.hours, L)) lines.push(`Saat notu: ${t(st.hours, L)}`);
  lines.push("", "## Ürünler");
  for (const p of products) {
    const hl = t(p.highlights, L).split("\n").map((x) => x.trim()).filter(Boolean).join("; ");
    lines.push(`- ${t(p.name, L)} (/urunler/${p.slug}): ${t(p.summary, L)}${hl ? ` — Öne çıkanlar: ${hl}` : ""}`);
  }
  if (faqs.length) {
    lines.push("", "## Sıkça sorulan sorular");
    for (const f of faqs) lines.push(`S: ${t(f.question, L)}\nC: ${t(f.answer, L).replace(/^(## |> |- )/gm, "")}`);
  }
  if (pages.length) {
    lines.push("", "## Kurumsal sayfalar");
    for (const p of pages) lines.push(`- ${t(p.title, L)} (/${p.slug}): ${t(p.summary, L)}`);
  }
  lines.push(
    "",
    "## Site bağlantıları",
    "Vaka gönder: /<dil>/vaka-gonder · Hekim portalı (üyelik, çevrim içi vaka, vaka takibi, fiyat listesi talebi): /portal · SSS: /<dil>/sss · İletişim: /<dil>/iletisim · Ekip: /<dil>/ekibimiz",
  );
  return lines.join("\n").slice(0, 24_000);
}

const LANG_NAME: Record<string, string> = { tr: "Türkçe", en: "English", fr: "Français" };

export async function assistantSystem(locale: string): Promise<string> {
  return `Sen MB Dental'in (İzmir'de dijital diş protez laboratuvarı; hekimlere, kliniklere ve aracı kuruluşlara hizmet verir) sitedeki canlı destek asistanısın.
Kurallar:
- Ziyaretçinin dilinde cevap ver (varsayılan: ${LANG_NAME[locale] ?? "Türkçe"}). Kısa ve samimi ol: en fazla 4-5 cümle.
- Yalnız aşağıdaki laboratuvar bilgilerine dayan. Bilmediğin bir şeyi (fiyat, teslim süresi, stok, vaka durumu, kişisel bilgi) ASLA uydurma; "ekibimiz size en kısa sürede dönecek" de.
- Fiyat sorulursa: genel fiyat listesinin portalda onaylı hesaplara açık olduğunu, /portal'dan talep edilebileceğini söyle.
- Vaka durumu sorulursa: portaldan takip edilebildiğini, ekibin de kontrol edeceğini söyle.
- Hastalara tıbbi teşhis ya da tedavi tavsiyesi verme; diş hekimlerine yönlendir.
- Bağlantı verirken site içi yolları kullan (ör. /tr/vaka-gonder, /portal).
- Sen bir yapay zekâ asistanısın; sorulursa bunu açıkça söyle. Ekipten biri konuşmayı görüp devralabilir.

# Laboratuvar bilgileri
${await siteKnowledge()}`;
}
