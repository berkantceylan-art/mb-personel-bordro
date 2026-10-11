// Site içerikleri sayfasının sunucu ve tarayıcı tarafında ortak kullanılan sabitleri
export const PORTAL_TYPE_LABELS: [string, string][] = [["doctor_tr", "Hekim (Türkiye)"], ["doctor_foreign", "Hekim (yurtdışı)"], ["clinic", "Klinik"], ["agency", "Aracı kuruluş"]];
export const siteMediaUrl = (p: string | null | undefined) => (p ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/${p}` : null);
