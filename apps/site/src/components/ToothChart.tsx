/**
 * FDI diş şeması — hekimin bakış açısı (hastanın sağı ekranda solda).
 * Her diş bir bağlantı: /{dil}/vaka-gonder?dis=NN
 * Sunucu bileşeni; etkileşim yalnız CSS (hover / klavye odağı).
 */

// Orta hattan dışa doğru: 1 orta kesici … 8 yirmilik — göreli meziodistal genişlik
const WIDTHS = [8.6, 6.6, 7.6, 7, 6.8, 10.2, 9.4, 8.8];
const TOTAL = WIDTHS.reduce((a, b) => a + b, 0);
const SPREAD = 1.47; // radyan: orta hattan son azı dişine

const CX = 260;
const RX = 196;
const RY = 205;
const UPPER_CY = 268;
const LOWER_CY = 296;

type Tooth = { fdi: number; x: number; y: number; rot: number; w: number; h: number; lx: number; ly: number };

function angleOf(k: number) {
  // k: 0..7 (orta kesiciden dışa)
  const before = WIDTHS.slice(0, k).reduce((a, b) => a + b, 0);
  return (SPREAD * (before + WIDTHS[k] / 2)) / TOTAL;
}

function buildTeeth(): Tooth[] {
  const teeth: Tooth[] = [];
  for (let k = 0; k < 8; k++) {
    const a = angleOf(k);
    const w = WIDTHS[k] * 2.55;
    const h = k >= 5 ? 33 : k >= 3 ? 29 : 27;
    for (const side of [-1, 1] as const) {
      const s = side * a;
      // Üst çene: kesiciler yukarıda
      {
        const x = CX + RX * Math.sin(s);
        const y = UPPER_CY - RY * Math.cos(s);
        const rot = (Math.atan2(RY * Math.sin(s), RX * Math.cos(s)) * 180) / Math.PI;
        const lx = CX + RX * 1.15 * Math.sin(s);
        const ly = UPPER_CY - RY * 1.15 * Math.cos(s) + 4;
        teeth.push({ fdi: (side < 0 ? 10 : 20) + k + 1, x, y, rot, w, h, lx, ly });
      }
      // Alt çene: kesiciler aşağıda
      {
        const x = CX + RX * Math.sin(s);
        const y = LOWER_CY + RY * Math.cos(s);
        const rot = (Math.atan2(-RY * Math.sin(s), RX * Math.cos(s)) * 180) / Math.PI;
        const lx = CX + RX * 1.15 * Math.sin(s);
        const ly = LOWER_CY + RY * 1.15 * Math.cos(s) + 4;
        teeth.push({ fdi: (side < 0 ? 40 : 30) + k + 1, x, y, rot, w, h, lx, ly });
      }
    }
  }
  return teeth;
}

const TEETH = buildTeeth();

export function ToothChart({
  locale,
  upperLabel,
  lowerLabel,
  hint,
  toothWord,
}: {
  locale: string;
  upperLabel: string;
  lowerLabel: string;
  hint: string;
  toothWord: string;
}) {
  return (
    <figure className="relative mx-auto w-full max-w-[520px]">
      <svg viewBox="0 0 520 560" className="h-auto w-full" role="group" aria-label={hint}>
        {/* Logodaki gülüş çizgisi: iki çenenin arasında */}
        <path d="M150 300 Q 260 336 370 300" fill="none" stroke="var(--color-smile)" strokeWidth="7" strokeLinecap="round" opacity="0.9" />
        <text x="260" y="258" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.55)" className="display">
          {upperLabel}
        </text>
        <text x="260" y="364" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.55)" className="display">
          {lowerLabel}
        </text>
        {TEETH.map((t) => (
          <a key={t.fdi} href={`/${locale}/vaka-gonder?dis=${t.fdi}`} className="tooth-link" aria-label={`${toothWord} ${t.fdi}`}>
            <rect
              className="tooth"
              x={-t.w / 2}
              y={-t.h / 2}
              width={t.w}
              height={t.h}
              rx={Math.min(t.w, t.h) / 2.4}
              transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) rotate(${t.rot.toFixed(1)})`}
              fill="rgba(243,246,249,0.92)"
              stroke="rgba(243,246,249,0.35)"
              strokeWidth="1.5"
            />
            <text className="tooth-num num" x={t.lx.toFixed(1)} y={t.ly.toFixed(1)} textAnchor="middle" fontSize="11.5" fill="rgba(255,255,255,0.6)">
              {t.fdi}
            </text>
          </a>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-sm text-white/65">{hint}</figcaption>
    </figure>
  );
}
