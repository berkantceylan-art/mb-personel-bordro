import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./lib/i18n";
import { legacyRedirect } from "./lib/redirects";

function preferredLocale(req: NextRequest): Locale {
  const header = req.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    return NextResponse.redirect(url);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|icon-|apple-touch-icon|robots.txt|sitemap.xml|llms.txt|manifest.webmanifest).*)"],
};
