/** Üretim: etiketler */
export const STATION_KIND: Record<string, string> = {
  model: "Model / alçı", cad: "CAD tasarım", milling: "Kazıma (frez)", printing: "3B yazıcı", sintering: "Sinterleme", casting: "Döküm",
  porcelain: "Porselen / seramik", finishing: "Bitirme / cila", qc: "Kalite kontrol", packing: "Paketleme", other: "Diğer",
};
export const OP_STATUS: Record<string, [string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  waiting: ["Sırada", "gray"], ready: ["Hazır (başlayabilir)", "blue"], in_progress: ["Çalışılıyor", "amber"], paused: ["Durduruldu", "red"], done: ["Bitti", "green"], skipped: ["Atlandı", "gray"],
};
export const REMAKE_REASON: Record<string, string> = {
  fit: "Uyum / oturmuyor", color: "Renk uyumsuz", fracture: "Kırık / çatlak", margin: "Kenar uyumu", occlusion: "Kapanış (oklüzyon)", contact: "Kontakt",
  doctor_change: "Hekim değişiklik istedi", lab_error: "Laboratuvar hatası", other: "Diğer",
};
export function prdError(m: string): string {
  if (/not_allowed|permission/.test(m)) return "Üretim yetkiniz yok (Yönetim > Yetkiler).";
  if (/job_not_found/.test(m)) return "Bu numarayla iş bulunamadı.";
  if (/job_cancelled/.test(m)) return "İş iptal edilmiş.";
  if (/bad_status/.test(m)) return "Adımın durumu bu işleme uygun değil.";
  if (/relation "prd_|function prd_|schema cache/.test(m)) return "Üretim tabloları yok: Supabase'de 20261207000000_production.sql çalıştırılmalı.";
  return m;
}
export const minutes = (m: number | null | undefined) => {
  const v = Math.max(0, Math.round(Number(m ?? 0)));
  return v >= 60 ? `${Math.floor(v / 60)} sa ${v % 60} dk` : `${v} dk`;
};
