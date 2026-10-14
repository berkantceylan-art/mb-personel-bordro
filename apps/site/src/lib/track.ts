// Site istatistiği: tarayıcı / cihaz tanıma, IP→konum başlıkları, çerezsiz anonim ziyaretçi özeti, bot tanıma
import { createHash } from "node:crypto";

export function uaInfo(ua: string): { device: "mobile" | "tablet" | "desktop"; browser: string; os: string } {
  const device = /ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua) ? "tablet" : /mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua) ? "mobile" : "desktop";
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\/|opera/i.test(ua) ? "Opera" : /samsungbrowser/i.test(ua) ? "Samsung" : /yabrowser/i.test(ua) ? "Yandex" : /firefox|fxios/i.test(ua) ? "Firefox" : /crios|chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Diğer";
  const os = /windows/i.test(ua) ? "Windows" : /iphone|ipad|ipod|ios/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os|macintosh/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Diğer";
  return { device, browser, os };
}

export function geoFrom(h: Headers): { country: string | null; region: string | null; city: string | null } {
  const dec = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  return { country: h.get("x-vercel-ip-country"), region: h.get("x-vercel-ip-country-region"), city: dec(h.get("x-vercel-ip-city")) };
}

/** Günlük değişen anonim ziyaretçi özeti: IP saklanmaz, ertesi gün eşleştirilemez */
export function visitorHash(h: Headers): string {
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "0";
  const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${h.get("user-agent") ?? ""}|${day}|${process.env.VERCEL_PROJECT_ID ?? "mbdental"}`).digest("hex").slice(0, 20);
}

/** Arama ve yapay zekâ botları (yalnız bilinenler; diğerleri sayılmaz) */
const BOTS: Array<[RegExp, string]> = [
  [/ChatGPT-User/i, "ChatGPT-User"], [/OAI-SearchBot/i, "OAI-SearchBot"], [/GPTBot/i, "GPTBot"],
  [/Perplexity-User/i, "Perplexity-User"], [/PerplexityBot/i, "PerplexityBot"],
  [/Claude-User/i, "Claude-User"], [/Claude-SearchBot/i, "Claude-SearchBot"], [/ClaudeBot|anthropic-ai/i, "ClaudeBot"],
  [/Google-Extended|GoogleOther/i, "GoogleOther"], [/Gemini/i, "Gemini"], [/Googlebot/i, "Googlebot"],
  [/bingbot/i, "Bingbot"], [/MicrosoftPreview|copilot/i, "Copilot"], [/Applebot/i, "Applebot"], [/YandexBot/i, "YandexBot"],
  [/DuckAssistBot|DuckDuckBot/i, "DuckDuckGo"], [/meta-externalagent|FacebookBot|facebookexternalhit/i, "Meta"], [/Bytespider/i, "Bytespider"],
  [/CCBot/i, "CCBot"], [/Amazonbot/i, "Amazonbot"], [/MistralAI-User/i, "Mistral"], [/YouBot/i, "You.com"],
];
export function botName(ua: string): string | null {
  for (const [re, n] of BOTS) if (re.test(ua)) return n;
  return null;
}
export const isBotUa = (ua: string) => /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse|monitor/i.test(ua);
