/** Modül kataloğu: kullanıcı türlerinde ve kişi ayarında kullanılan tüm modüller */
export const MODS = ["hr", "attendance", "payroll", "safety", "lab", "finance", "sales", "purchases", "stock", "production", "assets", "expenses", "users"] as const;
export type Mod = (typeof MODS)[number];

export type ModInfo = { key: Mod; label: string; icon: string; desc: string; group: string; levels: [string, string, string] };

/** Her modülde 1 / 2 / 3 seviyesinin ne demek olduğu */
export const MOD_INFO: ModInfo[] = [
  { key: "hr", group: "İnsan kaynakları", label: "Personel ve İK", icon: "id", desc: "Personel kartları, işe alım, uyum, performans, organizasyon, zimmet", levels: ["Listeyi görür", "Kayıt girer", "Tam yönetir"] },
  { key: "attendance", group: "İnsan kaynakları", label: "Puantaj ve izin", icon: "clock", desc: "Puantaj, vardiya, izin, fazla mesai, mesai yemeği, kiosk", levels: ["Görür", "Girer / onaylar", "Tam yönetir"] },
  { key: "payroll", group: "İnsan kaynakları", label: "Bordro ve ücret", icon: "money", desc: "Maaşlar, bordro, ay sonu, avans ödemeleri, zam, BES, icra, SGK", levels: ["Görür", "Hesaplar / öder", "Tam yönetir"] },
  { key: "safety", group: "İnsan kaynakları", label: "İSG ve yasal uyum", icon: "shield", desc: "İş güvenliği, sağlık muayeneleri, eğitim, İş Kanunu, KVKK", levels: ["Görür", "Kayıt girer", "Tam yönetir"] },
  { key: "lab", group: "Laboratuvar", label: "İş kayıt, hekim ve kargo", icon: "box", desc: "İş kayıt, iş listesi, prova / teslim, hekim kartları, fiyatlar, kargo ve kurye", levels: ["Görür", "İş kaydeder", "Tam yönetir"] },
  { key: "production", group: "Laboratuvar", label: "Üretim ve kutu akışı", icon: "target", desc: "Kutu okut, iş nerede, üretim panosu, performans, istasyonlar", levels: ["Görür", "Okutur / çalışır", "Tam yönetir"] },
  { key: "finance", group: "Finans ve ticaret", label: "Finans", icon: "piggy", desc: "Kasa, banka, cari, çek-senet, kredi kartı, kredi, veresiye", levels: ["Görür", "İşlem girer", "İptal ve ayar"] },
  { key: "sales", group: "Finans ve ticaret", label: "Satış ve fatura", icon: "doc", desc: "Satış faturası, e-fatura, faturalanmamış işler", levels: ["Görür", "Fatura keser", "İptal ve ayar"] },
  { key: "purchases", group: "Finans ve ticaret", label: "Alış", icon: "doc", desc: "Alış faturası, e-fatura içe aktarma, tedarikçiler", levels: ["Görür", "Fatura girer", "İptal ve ayar"] },
  { key: "stock", group: "Finans ve ticaret", label: "Stok ve depo", icon: "box", desc: "Ürün kartları, depolar, transfer, sayım, reçeteler", levels: ["Görür", "Hareket girer", "Tam yönetir"] },
  { key: "expenses", group: "Finans ve ticaret", label: "Masraflar", icon: "list", desc: "Masraf onayı, tekrarlayan masraflar (herkes kendi masrafını zaten girebilir)", levels: ["Görür", "Onaylar", "Tam yönetir"] },
  { key: "assets", group: "Finans ve ticaret", label: "Demirbaş", icon: "briefcase", desc: "Demirbaş listesi, amortisman, bakım", levels: ["Görür", "Kayıt girer", "Tam yönetir"] },
  { key: "users", group: "Sistem", label: "Kullanıcı yönetimi", icon: "lock", desc: "Kullanıcılar, hesap açma, kullanıcı türleri, işlem geçmişi", levels: ["Görür", "Hesap açar", "Türleri ve yetkileri yönetir"] },
];
export const MOD_LABEL: Record<string, string> = Object.fromEntries(MOD_INFO.map((m) => [m.key, m.label]));
export const MOD_GROUPS = [...new Set(MOD_INFO.map((m) => m.group))];

export const LEVEL_CLS = ["bg-[#EEF2F6] text-muted", "bg-[#EAF2FB] text-brand-700", "bg-warn-bg text-warn", "bg-ok-bg text-ok"];

export const ROLE_LABEL: Record<string, string> = { owner: "Şirket sahibi", accountant: "Muhasebe erişimi", hr: "İK erişimi", branch_manager: "Şef (kendi bölümü)", safety: "İSG erişimi", employee: "Personel erişimi", site_editor: "Web sitesi editörü" };
export const FLOW_LABEL: Record<string, string> = { technician: "Teknisyen", chief: "Şef (ara kontrol)", qc: "Kontrol sorumlusu", dispatch: "Pazarlama / çıkış" };

export const TYPE_COLORS = ["#0A3D73", "#2563EB", "#0891B2", "#059669", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#9333EA", "#475569"];

/** Seviyelerden temel erişim (veritabanındaki user_type_role ile aynı) */
export function typeRole(levels: Record<string, number>, scoped: boolean): string {
  if ((levels.payroll ?? 0) >= 2) return "accountant";
  if ((levels.hr ?? 0) >= 2 || (levels.attendance ?? 0) >= 2) return scoped ? "branch_manager" : "hr";
  if ((levels.safety ?? 0) >= 1) return "safety";
  if ((levels.hr ?? 0) >= 1 || (levels.attendance ?? 0) >= 1) return scoped ? "branch_manager" : "hr";
  return "employee";
}

export function usersError(m: string): string {
  if (/owner_full/.test(m)) return "Şirket sahibinin yetkileri her zaman tamdır, türü değiştirilemez.";
  if (/self_lockout/.test(m)) return "Kendi kullanıcı yönetimi yetkinizi düşüremezsiniz.";
  if (/\bself\b/.test(m)) return "Kendi türünüzü değiştiremezsiniz; şirket sahibine başvurun.";
  if (/above_own:(\w+)/.test(m)) return `Kendinizde olmayan bir yetkiyi veremezsiniz (${MOD_LABEL[/above_own:(\w+)/.exec(m)![1]!] ?? "modül"}).`;
  if (/target_above/.test(m)) return "Sizden daha yetkili bir kullanıcıyı değiştiremezsiniz; şirket sahibine başvurun.";
  if (/name_taken/.test(m)) return "Bu adda bir kullanıcı türü zaten var.";
  if (/name_required/.test(m)) return "Tür adı yazın.";
  if (/type_not_found/.test(m)) return "Kullanıcı türü bulunamadı.";
  if (/branch_required/.test(m)) return "Tüm şubeler seçili değilse en az bir şube seçin.";
  if (/employee_linked/.test(m)) return "Bu personel başka bir hesaba bağlı.";
  if (/other_company/.test(m)) return "Bu kullanıcı adı başka bir şirkete ait.";
  if (/not_allowed/.test(m)) return "Bu işlem için Kullanıcı yönetimi yetkiniz yetmiyor.";
  if (/function .*user_type|users_overview|user_types|schema cache|users_without_account/.test(m)) return "Supabase'de 20261210000000_user_types.sql çalıştırılmalı.";
  return m;
}
