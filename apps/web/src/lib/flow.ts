/** Kutu akışı: etiketler */
export const FLOW_ROLE: Record<string, string> = { technician: "Teknisyen", chief: "Şef (ara kontrol)", qc: "Kontrol sorumlusu", dispatch: "Pazarlama / çıkış" };
export const FLOW_STAGE: Record<string, [string, string]> = {
  reception: ["Kayıtta (alınmadı)", "#64748B"], production: ["Üretimde", "#2563EB"], chief: ["Şef kontrolünde", "#7C3AED"], qc: ["Kalite kontrolde", "#0891B2"],
  dispatch: ["Çıkışa hazır", "#059669"], tryin: ["Provada (hekimde)", "#D97706"], out: ["Teslim edildi", "#94A3B8"],
};
export const FLOW_ACTION: Record<string, string> = {
  take: "aldı", done: "bitirdi, bıraktı", approve: "onayladı", reject: "geri gönderdi", exit: "çıkış yaptı (cariye işlendi)", tryin_out: "provaya gönderdi", note: "not",
};
export const ACTION_BUTTON: Record<string, string> = { done: "Bitirdim, bırakıyorum", approve: "Onayla", reject: "Geri gönder", exit: "Çıkış yap", tryin_out: "Provaya gönder" };

export function flowError(m: string): string {
  if (/not_allowed/.test(m)) return "Kutu okutma yetkiniz yok. Yöneticiniz sizi Üretim › Ekip sayfasından akışa eklemeli.";
  if (/no_employee/.test(m)) return "Hesabınız bir personel kaydına bağlı değil.";
  if (/job_not_found/.test(m)) return "Bu kodla iş bulunamadı.";
  if (/job_cancelled/.test(m)) return "İş iptal edilmiş.";
  if (/already_out/.test(m)) return "Bu işin çıkışı yapılmış (teslim edildi).";
  if (/not_holder/.test(m)) return "Bu iş sizin elinizde değil; önce okutup alın.";
  if (/role_required/.test(m)) return "Bu işlem sizin rolünüzde yok.";
  if (/reason_required/.test(m)) return "Geri gönderme nedenini yazın.";
  if (/qc_required/.test(m)) return "Kalite kontrol onayı olmadan çıkış yapılamaz.";
  if (/function prd_flow_scan|schema cache|flow_stage/.test(m)) return "Supabase'de 20261209000000_job_flow.sql çalıştırılmalı.";
  return m;
}
export const since = (iso: string | null | undefined) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} dk`;
  if (m < 1440) return `${Math.floor(m / 60)} sa ${m % 60} dk`;
  return `${Math.floor(m / 1440)} gün ${Math.floor((m % 1440) / 60)} sa`;
};
