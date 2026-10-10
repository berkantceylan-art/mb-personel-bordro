/**
 * Tek giriş (SSO): site ile ERP ayrı alan adlarında; oturum çerezleri paylaşılamaz.
 * Geçişte karşı uygulamaya kısa ömürlü giriş bilgisi POST ile (adres çubuğuna yazılmadan) iletilir.
 */
export const ERP_URL = (process.env.NEXT_PUBLIC_ERP_URL || "").replace(/\/+$/, "");

export const safePath = (p: unknown, fallback: string) => {
  const v = typeof p === "string" ? p : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Tarayıcıyı verilen adrese gizli alanlarla POST eden küçük sayfa */
export function autoPost(action: string, fields: Record<string, string>, label = "Yönlendiriliyorsunuz…") {
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${esc(label)}</title><style>body{font-family:system-ui,sans-serif;background:#072A50;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}button{margin-top:12px;padding:10px 18px;border-radius:999px;border:0;font-weight:600}</style></head><body><form method="post" action="${esc(action)}">${inputs}<p>${esc(label)}</p><noscript><button type="submit">Devam</button></noscript></form><script>document.forms[0].submit()</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
