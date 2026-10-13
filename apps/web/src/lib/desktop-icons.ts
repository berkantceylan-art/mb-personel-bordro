// Masaüstü simgeleri: sayfa yoluna göre varsayılan simge (sunucu ve tarayıcıda ortak)
const ICONS: [RegExp, string][] = [
  [/^\/isler/, "🦷"], [/^\/uretim|^\/atolye/, "🏭"], [/^\/stok/, "📦"], [/^\/alis/, "🛒"], [/^\/satis|fatura/, "🧾"], [/^\/finans/, "💰"], [/^\/cari/, "📒"],
  [/^\/personel|^\/ik/, "👥"], [/^\/bordro|^\/odemeler|^\/ay-sonu|^\/maas-plani|^\/donemler/, "💵"], [/^\/izin|^\/yillik/, "🌴"], [/^\/puantaj|^\/vardiya/, "⏱"], [/^\/benim/, "🙂"],
  [/^\/kalite/, "✅"], [/^\/crm/, "🤝"], [/^\/rapor|^\/kpi/, "📊"], [/^\/onaylar/, "✔️"], [/^\/kargo|^\/kurye/, "🚚"], [/^\/site|^\/duyuru/, "📣"],
  [/^\/masraf/, "🧮"], [/^\/asistan/, "✨"], [/^\/mesaj/, "💬"], [/^\/posta/, "📧"], [/^\/servis|^\/teknik-servis/, "🛠"], [/^\/istekler|^\/alim/, "🛒"], [/^\/ziyaretci|^\/guvenlik/, "🛡"], [/^\/ik-whatsapp/, "🟢"], [/^\/kameralar/, "📹"], [/^\/kalite-hatti/, "🔍"], [/^\/takvim|^\/vardiyalar/, "📅"], [/^\/isg|^\/saglik/, "⛑"], [/^\/zimmet|^\/demirbas/, "🔧"],
];
export const iconFor = (href: string) => ICONS.find(([r]) => r.test(href))?.[1] ?? "⭐";
