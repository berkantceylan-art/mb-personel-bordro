"use client";

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

/** FDI diş seçici: dişe dokun → seç / bırak */
export function ToothPicker({ value, onChange, labels }: { value: number[]; onChange: (v: number[]) => void; labels: { upper: string; lower: string } }) {
  const toggle = (n: number) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => a - b));
  const row = (teeth: number[], label: string) => (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-slate">{label}</p>
      <div className="grid grid-cols-8 gap-1 sm:grid-cols-16" role="group" aria-label={label}>
        {teeth.map((n) => {
          const on = value.includes(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(n)}
              className={`num h-11 rounded-lg border text-sm font-semibold transition-colors ${on ? "border-navy bg-navy text-white" : "border-gypsum bg-white text-ink hover:border-navy"}`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="grid gap-3">
      {row(UPPER, labels.upper)}
      {row(LOWER, labels.lower)}
    </div>
  );
}
