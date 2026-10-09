/**
 * Mevzuat içeriği (src/content/mevzuat.json): güncel yasal değerler, bülten, takvim.
 * Dosya, haftalık zamanlanmış mevzuat kontrolü tarafından güncellenir.
 */
import data from "@/content/mevzuat.json";
import { PARAMS_BY_YEAR, tl } from "@mb/core";

export type MevzuatParam = { key: string; label: string; value: number; unit: string; valid_from: string; valid_to: string | null; source: string; system: boolean };
export type Bulletin = { id: string; date: string; title: string; summary: string; impact: string; category: string; status: "uygulandi" | "bilgi" | "onay-bekliyor"; source: string; pr?: string };
export const MEVZUAT = data as { last_checked: string; params: MevzuatParam[]; bulletin: Bulletin[]; calendar: Array<{ when: string; what: string }> };

/** Bir tarihte geçerli değer (aynı anahtar ya da önceki dönem anahtarı) */
export function paramAt(keys: string[], date: string): MevzuatParam | null {
  const xs = MEVZUAT.params.filter((p) => keys.includes(p.key)).sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return xs.find((p) => p.valid_from <= date && (!p.valid_to || p.valid_to >= date)) ?? xs.find((p) => p.valid_from <= date) ?? null;
}

/** Kıdem tazminatı tavanı (kuruş); tanımlı değilse null */
export function severanceCapAt(date: string): number | null {
  const p = paramAt(["severanceCap", "severanceCapPrev"], date);
  return p ? tl(p.value) : null;
}

/** Bültendeki değer ile bordro motorundaki değer uyuşuyor mu (yalnız motorda kullanılanlar) */
export function systemValue(key: string, date: string): number | null {
  const prm = PARAMS_BY_YEAR[Number(date.slice(0, 4))];
  if (!prm) return null;
  const br = prm.incomeTaxBrackets;
  const m: Record<string, number | undefined> = {
    minWageGross: prm.minWageGross, sgkFloor: prm.sgkFloor, sgkCeiling: prm.sgkCeiling,
    taxBracket1: br[0]?.[0], taxBracket2: br[1]?.[0], taxBracket3: br[2]?.[0], taxBracket4: br[3]?.[0],
  };
  const v = m[key];
  return v === undefined ? null : v / 100;
}
