/** Sunucu açılışında: Vercel'e yapıştırılırken anahtara karışan boşluk / tırnak / "ANTHROPIC_API_KEY=" önekini temizle */
export function register() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return;
  const clean = k.replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/i, "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
  if (clean !== k) process.env.ANTHROPIC_API_KEY = clean;
}
