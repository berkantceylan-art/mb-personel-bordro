import { headers } from "next/headers";

/**
 * İsteğin geldiği adres (ör. https://mb-dental-site.vercel.app).
 * E-posta onayı ve davet bağlantıları, alan adı (mbdentaire.com) henüz bu siteye bağlanmamışken de çalışsın diye
 * ortam değişkeni yerine gerçek adres kullanılır.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto.split(",")[0]}://${host.split(",")[0]}`;
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com").replace(/\/+$/, "");
}
