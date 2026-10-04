import { roundKurus, type Kurus } from "./money";

/**
 * İcra ve nafaka kesinti dağıtımı.
 * - Nafaka dosyaları önceliklidir ve aylık tutarları tam kesilir.
 * - Diğer icra dosyaları tebliğ sırasına göre, kalan haczedilebilir
 *   tutardan (varsayılan resmi netin 1/4'ü) sırayla karşılanır.
 * - afterAlimony: 1/4, nafaka düşüldükten sonra kalan netten hesaplanır (İİK 83 yorumu).
 * - Toplam kesinti hiçbir durumda verilen netten fazla olamaz.
 */
export interface GarnishmentFile {
  id: string;
  kind: "ALIMONY" | "ENFORCEMENT";
  /** Tebliğ tarihi (ISO) — sıralama için */
  servedAt: string;
  /** Nafaka: aylık kesilecek tutar */
  monthlyAmount?: Kurus;
  /** İcra: kalan borç */
  remainingDebt?: Kurus;
  active: boolean;
}

export interface GarnishmentLine {
  fileId: string;
  amount: Kurus;
}

export function allocateGarnishments(
  officialNet: Kurus,
  files: GarnishmentFile[],
  seizableRatio = 0.25,
  opts: { afterAlimony?: boolean } = {},
): { lines: GarnishmentLine[]; total: Kurus } {
  officialNet = Math.max(0, officialNet);
  const active = files.filter((f) => f.active);
  const lines: GarnishmentLine[] = [];

  const alimony = active
    .filter((f) => f.kind === "ALIMONY")
    .sort((a, b) => a.servedAt.localeCompare(b.servedAt));
  let left = officialNet;
  for (const f of alimony) {
    const amount = Math.min(f.monthlyAmount ?? 0, left);
    if (amount > 0) {
      lines.push({ fileId: f.id, amount });
      left -= amount;
    }
  }

  const seizableBase = opts.afterAlimony ? left : officialNet;
  let pool = Math.min(roundKurus(seizableBase * seizableRatio), left);
  const enforcement = active
    .filter((f) => f.kind === "ENFORCEMENT")
    .sort((a, b) => a.servedAt.localeCompare(b.servedAt));
  for (const f of enforcement) {
    if (pool <= 0) break;
    const amount = Math.min(f.remainingDebt ?? 0, pool);
    if (amount > 0) {
      lines.push({ fileId: f.id, amount });
      pool -= amount;
    }
  }

  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
