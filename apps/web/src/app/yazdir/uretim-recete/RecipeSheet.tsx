import Link from "next/link";
import { pcell, pnum } from "@/components/ledger/PrintShell";

export type RecipeCost = {
  product: { id: string; name: string; code: string | null; price_try: number | null; price_eur: number | null };
  settings: { labor_rate_min: number; overhead_per_unit: number; remake_pct: number; marketing_pct: number; admin_pct: number; finance_pct: number };
  materials: { bom_id: string; code: string; name: string; unit: string; qty: number; waste_pct: number; unit_cost: number; cost: number; note: string | null }[];
  labor: { step_id: string; station: string; minutes: number; rate: number; own_rate: boolean; cost: number }[];
  minutes: number; material: number; labor_total: number; overhead: number; remake: number; production: number; marketing: number; admin: number; finance: number; total: number;
  price_try: number | null; margin_try: number | null; margin_eur: number | null; missing_prices: number;
};

/** "maliyetli": tutarlarla tam reçete; "atolye": fiyatsız, üretim alanı için (miktar, fire, adım ve süre) */
export type SheetMode = "maliyetli" | "atolye";

const tl = (v: number | null | undefined) => (Number(v ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: number) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const withWaste = (q: number, w: number) => Number(q) * (1 + Number(w) / 100);

/** Tek ürünün üretim reçetesi (A4 bölümü). Toplu çıktıda her ürün yeni sayfadan başlar. */
export function RecipeSheet({ c, mode, pageBreak }: { c: RecipeCost; mode: SheetMode; pageBreak?: boolean }) {
  const cost = mode === "maliyetli";
  const totalMin = c.labor.reduce((a, l) => a + Number(l.minutes), 0);
  return (
    <section className={`flex flex-col gap-3 ${pageBreak ? "break-before-page pt-2" : ""}`}>
      <div className="flex justify-between items-end gap-3 border-b border-black pb-1">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[#555]">Üretim reçetesi · 1 üye</div>
          <div className="text-[14px] font-bold">{c.product.name}</div>
          {c.product.code && <div className="text-[10px]">Kod: {c.product.code}</div>}
        </div>
        <div className="text-right text-[10px]">
          <div><b>{c.materials.length}</b> malzeme · <b>{c.labor.length}</b> adım · <b>{totalMin}</b> dk standart süre</div>
          {cost && <div className="text-[12px] font-bold">Tam maliyet: {tl(c.total)} TL</div>}
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">A. Malzemeler</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#EEF2F6]">
              <th className={`${pcell} w-6`}>#</th>
              <th className={`${pcell} text-left`}>Malzeme</th>
              <th className={`${pcell} text-left w-20`}>Kod</th>
              <th className={`${pcell} text-right w-20`}>Miktar</th>
              <th className={`${pcell} w-10`}>Birim</th>
              <th className={`${pcell} text-right w-12`}>Fire %</th>
              <th className={`${pcell} text-right w-20`}>Fireli miktar</th>
              {cost && <th className={`${pcell} text-right w-20`}>Birim fiyat</th>}
              {cost && <th className={`${pcell} text-right w-20`}>Tutar (TL)</th>}
            </tr>
          </thead>
          <tbody>
            {c.materials.map((m, i) => (
              <tr key={m.bom_id}>
                <td className={`${pcell} text-center`}>{i + 1}</td>
                <td className={pcell}>{m.name}{m.note ? <span className="text-[9px] text-[#555]"> · {m.note}</span> : null}</td>
                <td className={`${pcell} text-[9.5px]`}>{m.code}</td>
                <td className={pnum}>{num(m.qty)}</td>
                <td className={`${pcell} text-center`}>{m.unit}</td>
                <td className={pnum}>{Number(m.waste_pct) ? `%${num(m.waste_pct)}` : ""}</td>
                <td className={pnum}>{num(Math.round(withWaste(m.qty, m.waste_pct) * 1000) / 1000)}</td>
                {cost && <td className={pnum}>{m.unit_cost ? tl(m.unit_cost) : "—"}</td>}
                {cost && <td className={`${pnum} font-semibold`}>{tl(m.cost)}</td>}
              </tr>
            ))}
            {!c.materials.length && <tr><td colSpan={cost ? 9 : 7} className={`${pcell} text-center text-[#555]`}>Malzeme satırı yok.</td></tr>}
            {cost && c.materials.length > 0 && <tr className="font-bold"><td colSpan={8} className={`${pcell} text-right`}>Saf malzeme toplamı</td><td className={pnum}>{tl(c.material)}</td></tr>}
          </tbody>
        </table>
        {cost && c.missing_prices > 0 && <div className="text-[9.5px] mt-1">Not: {c.missing_prices} malzemenin fiyatı yok; maliyet eksik olabilir.</div>}
      </div>

      <div>
        <div className="font-bold mb-1">B. Üretim adımları</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#EEF2F6]">
              <th className={`${pcell} w-6`}>#</th>
              <th className={`${pcell} text-left`}>Adım / istasyon</th>
              <th className={`${pcell} text-right w-20`}>Süre (dk)</th>
              {cost && <th className={`${pcell} text-right w-24`}>Dakika ücreti</th>}
              {cost && <th className={`${pcell} text-right w-20`}>Tutar (TL)</th>}
              {!cost && <th className={`${pcell} w-32`}>Yapan / paraf</th>}
            </tr>
          </thead>
          <tbody>
            {c.labor.map((l, i) => (
              <tr key={l.step_id}>
                <td className={`${pcell} text-center`}>{i + 1}</td>
                <td className={pcell}>{l.station}</td>
                <td className={pnum}>{l.minutes}</td>
                {cost && <td className={pnum}>{tl(l.rate)}{l.own_rate ? "" : " (genel)"}</td>}
                {cost && <td className={`${pnum} font-semibold`}>{tl(l.cost)}</td>}
                {!cost && <td className={pcell}>&nbsp;</td>}
              </tr>
            ))}
            {!c.labor.length && <tr><td colSpan={cost ? 5 : 4} className={`${pcell} text-center text-[#555]`}>Üretim adımı yok.</td></tr>}
            {c.labor.length > 0 && <tr className="font-bold"><td colSpan={2} className={`${pcell} text-right`}>Toplam</td><td className={pnum}>{totalMin}</td>{cost && <td className={pcell} />}{cost && <td className={pnum}>{tl(c.labor_total)}</td>}{!cost && <td className={pcell} />}</tr>}
          </tbody>
        </table>
      </div>

      {cost && (
        <div className="grid grid-cols-2 gap-4 break-inside-avoid">
          <div>
            <div className="font-bold mb-1">C. Maliyet özeti</div>
            <table className="w-full border-collapse">
              <tbody>
                {([
                  ["Saf malzeme", c.material, ""],
                  ["İşçilik", c.labor_total, `${c.minutes} dk`],
                  ["Üretim genel gideri", c.overhead, "üye başına"],
                  ["Tekrar / fire payı", c.remake, `%${Number(c.settings.remake_pct)}`],
                  ["Üretim maliyeti", c.production, ""],
                  ["Pazarlama ve satış", c.marketing, `%${Number(c.settings.marketing_pct)}`],
                  ["Genel yönetim", c.admin, `%${Number(c.settings.admin_pct)}`],
                  ["Finansman", c.finance, `%${Number(c.settings.finance_pct)}`],
                  ["Tam maliyet", c.total, ""],
                ] as [string, number, string][]).map(([l, v, n]) => (
                  <tr key={l} className={l === "Üretim maliyeti" || l === "Tam maliyet" ? "font-bold bg-[#F4F6F9]" : ""}>
                    <td className={pcell}>{l}{n ? <span className="text-[9px] font-normal text-[#555]"> · {n}</span> : null}</td>
                    <td className={pnum}>{tl(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="font-bold mb-1">D. Fiyat ve marj</div>
            <table className="w-full border-collapse">
              <tbody>
                <tr><td className={pcell}>Satış fiyatı (TL)</td><td className={pnum}>{c.price_try ? tl(c.price_try) : "—"}</td></tr>
                <tr><td className={pcell}>Satış fiyatı (€)</td><td className={pnum}>{c.product.price_eur ? tl(c.product.price_eur) : "—"}</td></tr>
                <tr><td className={pcell}>Marj (TL fiyata göre)</td><td className={pnum}>{c.margin_try != null ? `%${Number(c.margin_try)}` : "—"}</td></tr>
                <tr><td className={pcell}>Marj (€ fiyata göre)</td><td className={pnum}>{c.margin_eur != null ? `%${Number(c.margin_eur)}` : "—"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mt-4 text-[10px] break-inside-avoid">
        {["Hazırlayan", "Kontrol eden", "Onaylayan"].map((x) => <div key={x} className="border-t border-black pt-1">{x}<div className="h-8" /></div>)}
      </div>
    </section>
  );
}

export const modeOf = (v: string | undefined): SheetMode => (v === "atolye" ? "atolye" : "maliyetli");

/** Ekranda maliyetli / atölye nüshası seçimi (yazıcıda gizli araç çubuğunda) */
export function ModeTabs({ base, mode, q }: { base: string; mode: string; q?: string }) {
  const qs = (t: string) => { const p = new URLSearchParams(); if (t !== "maliyetli") p.set("tur", t); if (q) p.set("q", q); const x = p.toString(); return x ? `${base}?${x}` : base; };
  return (
    <span className="flex gap-1">
      {([["maliyetli", "Maliyetli"], ["atolye", "Atölye (fiyatsız)"]] as const).map(([k, l]) => (
        <Link key={k} href={qs(k)} className={`px-3 py-1 rounded-full border ${k === mode ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l}</Link>
      ))}
    </span>
  );
}
