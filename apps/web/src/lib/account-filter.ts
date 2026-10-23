/** Cari listesi süzgeci: aktif / pasif ve bakiye durumu (borçlu, alacaklı, kapalı). Varsayılan: aktif açık hesaplar */
export const FILTER_KEYS = ["aktif", "pasif", "borclu", "alacakli", "kapali"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export const DEFAULT_FILTER: FilterKey[] = ["aktif", "borclu", "alacakli"];

/** URL'deki g parametresini çöz (sunucu tarafında da kullanılır) */
export function parseFilter(g: string | undefined, legacy?: { bakiye?: string; pasif?: string }): Set<FilterKey> {
  if (g) return new Set(g.split(",").filter((x): x is FilterKey => (FILTER_KEYS as readonly string[]).includes(x)));
  const s = new Set<FilterKey>(DEFAULT_FILTER);
  if (legacy?.pasif === "1") s.add("pasif");
  if (legacy?.bakiye === "alacak") { s.delete("alacakli"); s.delete("kapali"); }
  if (legacy?.bakiye === "borc") { s.delete("borclu"); s.delete("kapali"); }
  return s;
}
/** balance > 0: bize borçlu · balance < 0: biz borçluyuz (alacaklı hesap) */
export function passes(f: Set<FilterKey>, active: boolean, balances: number[]): boolean {
  if (active ? !f.has("aktif") : !f.has("pasif")) return false;
  const pos = balances.some((b) => b > 0), neg = balances.some((b) => b < 0);
  if (!pos && !neg) return f.has("kapali");
  return (pos && f.has("borclu")) || (neg && f.has("alacakli"));
}

