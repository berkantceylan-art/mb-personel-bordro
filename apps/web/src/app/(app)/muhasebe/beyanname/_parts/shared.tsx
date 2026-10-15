import { Notice } from "@/components/erp";
import { glError } from "@/lib/gl";

export type TabProps = { month: string; from: string; to: string; canEdit: boolean };

/** KDV istisna kodları (e-fatura / KDV1) */
export const EXEMPTION: Record<string, string> = {
  "301": "11/1-a mal ihracatı",
  "302": "11/1-a hizmet ihracatı",
  "350": "Diğer istisnalar",
  "351": "İstisna dışı (KDV %0)",
};

export function RpcError({ message, file }: { message: string; file: string }) {
  return <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(message) ? `Supabase'de ${file} çalıştırılmalı.` : glError(message)}</Notice>;
}

/** 2026 nispi damga vergisi oranları (binde) — yeni yıl oranları ilan edilince güncellenir */
export const STAMP_TYPES: Array<[string, string, number]> = [
  ["rent", "Kira sözleşmesi", 1.89],
  ["contract", "Sözleşme (hizmet, tedarik, satış)", 9.48],
  ["commitment", "Taahhütname", 9.48],
  ["guarantee", "Kefalet / teminat / rehin", 9.48],
  ["other", "Diğer (oranı siz yazın)", 9.48],
  ["fixed", "Maktu (sabit tutar)", 0],
];

