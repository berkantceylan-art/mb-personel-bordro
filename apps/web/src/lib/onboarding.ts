/** Uyum (onboarding) sabitleri */
export const PHASES = [["day1", "İlk gün"], ["week1", "İlk hafta"], ["day30", "30. gün"], ["day60", "Deneme süresi sonu"], ["day90", "90. gün"]] as const;
export const PHASE_LABEL: Record<string, string> = Object.fromEntries(PHASES);
export const OWNER_LABEL: Record<string, string> = { hr: "İK", chief: "Şef", mentor: "Usta / mentor", employee: "Personel" };
export const PROBATION_CRITERIA = [["kalite", "İş kalitesi"], ["hiz", "Hız ve verim"], ["ogrenme", "Öğrenme isteği"], ["devam", "Devam ve dakiklik"], ["uyum", "Ekip uyumu"]] as const;
