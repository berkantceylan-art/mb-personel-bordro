import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./lib/i18n";
import { legacyGone, legacyRedirect } from "./lib/redirects";

function preferredLocale(req: NextRequest): Locale {
  const header = req.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

/** Arama / yapay zekâ botu ziyaretini istatistiğe yaz (isteği bekletmez) */
const BOT_RE: Array<[RegExp, string]> = [
  [/ChatGPT-User/i, "ChatGPT-User"], [/OAI-SearchBot/i, "OAI-SearchBot"], [/GPTBot/i, "GPTBot"], [/Perplexity-User/i, "Perplexity-User"], [/PerplexityBot/i, "PerplexityBot"],
  [/Claude-User/i, "Claude-User"], [/Claude-SearchBot/i, "Claude-SearchBot"], [/ClaudeBot|anthropic-ai/i, "ClaudeBot"], [/Google-Extended|GoogleOther/i, "GoogleOther"],
  [/Googlebot/i, "Googlebot"], [/bingbot/i, "Bingbot"], [/MicrosoftPreview|copilot/i, "Copilot"], [/Applebot/i, "Applebot"], [/YandexBot/i, "YandexBot"],
  [/DuckAssistBot|DuckDuckBot/i, "DuckDuckGo"], [/meta-externalagent|FacebookBot|facebookexternalhit/i, "Meta"], [/Bytespider/i, "Bytespider"], [/CCBot/i, "CCBot"],
  [/Amazonbot/i, "Amazonbot"], [/MistralAI-User/i, "Mistral"], [/YouBot/i, "You.com"],
];
function logBot(request: NextRequest, event: NextFetchEvent) {
  const ua = request.headers.get("user-agent") ?? "";
  const hit = BOT_RE.find(([re]) => re.test(ua));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hit || !url || !anon) return;
  event.waitUntil(fetch(`${url}/rest/v1/rpc/site_track`, {
    method: "POST", headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ p: { kind: "bot", name: hit[1], path: request.nextUrl.pathname.slice(0, 300), country: request.headers.get("x-vercel-ip-country") } }),
  }).catch(() => undefined));
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/t") return NextResponse.next();
  if (request.method === "GET") logBot(request, event);
  if (/^\/(robots\.txt|sitemap[^/]*\.xml|llms(-full)?\.txt|google[0-9a-f]+\.html)$/.test(pathname)) return NextResponse.next();

  if (legacyGone(pathname)) return new NextResponse("Bu adres artık yok.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });

  // Eski WordPress adresleri → yeni adresler (kalıcı 301, arama sıralaması korunur)
  const legacy = legacyRedirect(pathname);
  if (legacy) {
    const url = request.nextUrl.clone();
    url.pathname = legacy.pathname;
    url.hash = legacy.hash ?? "";
    url.search = "";
    return NextResponse.redirect(url, 301);
  }

  const first = pathname.split("/")[1];
  const isAppArea = first === "admin" || first === "giris" || first === "auth" || first === "api" || first === "portal";

  // Dil öneki olmayan herkese açık sayfalar → tarayıcı dili
  if (!isAppArea && !isLocale(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request)}${pathname === "/" ? "" : pathname}`;
    // Tarayıcı dili yoksa (Googlebot) kalıcı yönlendirme: Google /tr'yi asıl sayfa kabul eder
    return NextResponse.redirect(url, request.headers.get("accept-language") ? 307 : 301);
  }

  // Sunucu bileşenleri (admin menüsü) mevcut yolu bilsin
  request.headers.set("x-pathname", pathname);
  let response = NextResponse.next({ request });
  if (!isAppArea) return response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) return response;

  // Oturumu tazele (admin ve giriş sayfaları için)
  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ERP'den yalnız görüntüleme modunda açılan oturum: hiçbir değişiklik isteği kabul edilmez
  const m = request.method;
  if (user && m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !pathname.startsWith("/auth/goruntule")) {
    const { data: ro } = await supabase.rpc("imp_readonly");
    if (ro === true) return new NextResponse("Görüntüleme modundasınız: değişiklik yapılamaz.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const portalPublic = pathname === "/portal/kayit";
  if ((first === "admin" || (first === "portal" && !portalPublic)) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/giris";
    url.search = `?sonra=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|icon-|apple-touch-icon|manifest.webmanifest).*)"],
};
