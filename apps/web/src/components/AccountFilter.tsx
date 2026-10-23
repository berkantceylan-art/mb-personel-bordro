"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { DEFAULT_FILTER, FILTER_KEYS, parseFilter, type FilterKey } from "@/lib/account-filter";

const LABEL: Record<FilterKey, string> = { aktif: "Aktifler", pasif: "Pasifler", borclu: "Borçlular (bize borçlu)", alacakli: "Alacaklılar (biz borçluyuz)", kapali: "Kapalılar (bakiye 0)" };

export function AccountFilter({ counts }: { counts?: Partial<Record<FilterKey, number>> }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const cur = parseFilter(sp.get("g") ?? undefined, { bakiye: sp.get("bakiye") ?? undefined, pasif: sp.get("pasif") ?? undefined });
  const go = (next: Set<FilterKey>) => {
    const u = new URLSearchParams(sp.toString());
    u.delete("bakiye"); u.delete("pasif");
    const v = FILTER_KEYS.filter((k) => next.has(k)).join(",");
    if (v === DEFAULT_FILTER.join(",")) u.delete("g"); else u.set("g", v || "yok");
    router.push(`${path}${u.toString() ? `?${u}` : ""}`);
  };
  const isDefault = FILTER_KEYS.filter((k) => cur.has(k)).join(",") === DEFAULT_FILTER.join(",");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {FILTER_KEYS.map((k) => (
        <label key={k} className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={cur.has(k)} onChange={(e) => { const n = new Set(cur); if (e.target.checked) n.add(k); else n.delete(k); go(n); }} className="w-4 h-4" />
          {LABEL[k]}{counts?.[k] != null ? <span className="text-muted">({counts[k]})</span> : null}
        </label>
      ))}
      {!isDefault && <button type="button" onClick={() => go(new Set(DEFAULT_FILTER))} className="text-xs font-semibold text-brand-700">Standart: açık hesaplar</button>}
    </div>
  );
}
