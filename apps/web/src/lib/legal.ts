import { cache } from "react";
import { paramsFromJson, resolveParams, type LegalParams, type ResolvedParams } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/**
 * Veritabanındaki yıl bazlı yasal parametreler (legal_params). Yeni yılın değerleri
 * kod güncellemesi beklemeden buradan girilebilir; geçerli kayıt koddakini ezer.
 */
const loadDbParams = cache(async (supabase: SB): Promise<Record<number, LegalParams>> => {
  const { data } = await supabase.from("legal_params").select("year, data");
  const out: Record<number, LegalParams> = {};
  for (const r of data ?? []) {
    const p = paramsFromJson(Number(r.year), r.data);
    if (p) out[p.year] = p;
  }
  return out;
});

/** Yılın yasal parametreleri; tanımlı değilse en yakın önceki yıl + uyarı bayrağı */
export async function legalParams(supabase: SB, year: number): Promise<ResolvedParams> {
  return resolveParams(year, await loadDbParams(supabase));
}

/** Ekranda gösterilecek uyarı metni (tam eşleşmede null) */
export function paramsWarning(r: ResolvedParams, year: number): string | null {
  return r.exact ? null : `${year} yılının yasal değerleri (asgari ücret, SGK sınırları, vergi dilimleri) henüz tanımlı değil; hesap ${r.usedYear} değerleriyle yapıldı. Mevzuat ekranından ya da yazılım güncellemesiyle yeni yıl girilmeli.`;
}
