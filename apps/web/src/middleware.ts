import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/giris", "/sifre", "/auth", "/davet", "/api/davet", "/api/push", "/api/ilanlar", "/api/cron", "/kariyer", "/basvuru", "/kvkk-aydinlatma", "/kvkk-basvuru", "/api/sgk-robot", "/z/", "/api/whatsapp/webhook", "/tedarikci/siparis", "/tedarikci/davet", "/tedarikci/teklif", "/api/dentalsis-dump", "/api/pdks/push"];

export async function middleware(request: NextRequest) {
  // Sunucu bileşenleri (layout) mevcut yolu bilsin
  request.headers.set("x-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Supabase yavaş / erişilemezse istek 25 sn asılı kalmasın: 8 sn sonra oturum doğrulamasını sayfaya / eyleme bırak
  const auth = await Promise.race([
    supabase.auth.getUser().then((r) => ({ user: r.data.user, timedOut: false })),
    new Promise<{ user: null; timedOut: true }>((res) => setTimeout(() => res({ user: null, timedOut: true }), 8000)),
  ]);
  if (auth.timedOut) {
    console.error("[middleware] getUser 8 sn içinde yanıt vermedi:", request.method, request.nextUrl.pathname);
    return response;
  }
  const user = auth.user;

  // Kullanıcı olarak görüntüleme oturumu: hiçbir değişiklik isteği (form, sunucu eylemi) kabul edilmez
  const m = request.method;
  if (user && m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !request.nextUrl.pathname.startsWith("/auth/goruntule")) {
    const { data: ro } = await supabase.rpc("imp_readonly");
    if (ro === true) return new NextResponse("Görüntüleme modundasınız: değişiklik yapılamaz.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/giris";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|logo.svg|icon-|apple-touch-icon|sw.js|manifest.webmanifest).*)"],
};
