// Kalite kontrol hattı: kontrol listeleri ve hata metinleri (sunucu ve tarayıcıda ortak)
export type QcItem = { key: string; label: string };
export const QC_LISTS: Record<"chief" | "qc", QcItem[]> = {
  chief: [
    { key: "fit", label: "Uyum / oturma" }, { key: "contact", label: "Kontakt noktaları" }, { key: "occlusion", label: "Oklüzyon" },
    { key: "margin", label: "Marjinal uyum" }, { key: "shade", label: "Renk / ton" }, { key: "surface", label: "Yüzey / cila" },
    { key: "model", label: "Model ve ölçü uyumu" }, { key: "crack", label: "Çatlak / kırık yok" },
  ],
  qc: [
    { key: "patient", label: "Doğru hasta / hekim" }, { key: "teeth", label: "Diş numaraları doğru" }, { key: "shade", label: "Renk iş emriyle aynı" },
    { key: "count", label: "Adet tam" }, { key: "clean", label: "Temizlik / dezenfeksiyon" }, { key: "surface", label: "Yüzey ve cila" },
    { key: "parts", label: "Model / aksesuar tam" }, { key: "docs", label: "Etiket / belgeler" },
  ],
};
export const QC_STAGE_LABEL: Record<string, string> = { chief: "Birinci kontrol", qc: "Son kontrol", dispatch: "Paketleme / çıkış" };
export const pkgNo = (p: { year: number; no: number }) => `PK-${p.year}-${String(p.no).padStart(4, "0")}`;

export function qcError(m: string): string {
  if (/prd_qc_decide|prd_pack|job_qc_checks|job_packages/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270108000000_qc_line.sql çalıştırılmalı.";
  if (/role_required/.test(m)) return "Bu ekran için akış rolünüz uygun değil (Üretim › Ekip sayfasından rol verilir).";
  if (/qc_required/.test(m)) return "Son kontrolden geçmemiş iş paketlenemez.";
  if (/empty_package/.test(m)) return "Paket boş.";
  if (/bad_status/.test(m)) return "Paket kapanmış.";
  return m;
}
