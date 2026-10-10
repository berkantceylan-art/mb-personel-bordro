"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutForm } from "./SignOut";

/** site: yalnız web sitesi yönetim yetkisi olana; raw: Next bağlantısı değil, düz adres (sunucu yönlendirmesi) */
type Item = { label: string; href: string; roles?: string[]; site?: boolean; logistics?: boolean; raw?: boolean };
const MANAGERS = ["owner", "accountant", "hr", "branch_manager", "safety"];
const PAY = ["owner", "accountant"];
const HR = ["owner", "hr", "branch_manager"];

const HRM = ["owner", "accountant", "hr", "branch_manager"];

/** Modül grupları: her grup bir ERP modülü; kullanıcı yalnız yetkili olduğu öğeleri görür */
export const NAV: Array<{ group: string; items: Item[] }> = [
  {
    group: "Genel",
    items: [
      { label: "Gösterge Paneli", href: "/", roles: MANAGERS },
      { label: "Patron ekranı", href: "/patron", roles: ["owner", "accountant"] },
      { label: "Bildirimler", href: "/bildirimler" },
      { label: "Duyurular", href: "/duyurular" },
      { label: "Mesajlar", href: "/mesajlar" },
      { label: "Talepler", href: "/talepler", roles: [...new Set([...PAY, ...HR])] },
      { label: "İK asistanı", href: "/asistan" },
    ],
  },
  {
    group: "Benim sayfam",
    items: [
      { label: "Benim sayfam", href: "/benim", roles: ["employee"] },
      { label: "Avans iste", href: "/benim/avans", roles: ["employee"] },
      { label: "İzin", href: "/benim/izin", roles: ["employee"] },
      { label: "Bordrolarım", href: "/benim/bordro", roles: ["employee"] },
      { label: "Hesap hareketlerim", href: "/benim/hareketler", roles: ["employee"] },
      { label: "Puantajım", href: "/benim/puantaj", roles: ["employee"] },
      { label: "Takvimim", href: "/benim/takvim", roles: ["employee"] },
      { label: "Özlük bilgilerim", href: "/benim/ozluk", roles: ["employee"] },
      { label: "Belgelerim", href: "/benim/belgeler", roles: ["employee"] },
      { label: "Zimmetim", href: "/benim/zimmet", roles: ["employee"] },
      { label: "İmzalarım", href: "/benim/imza", roles: ["employee"] },
      { label: "BES", href: "/benim/bes", roles: ["employee"] },
      { label: "İcra ve nafaka", href: "/benim/icra", roles: ["employee"] },
      { label: "Uzaktan eğitim", href: "/benim/egitim", roles: ["employee"] },
      { label: "İş güvenliği", href: "/benim/isg", roles: ["employee"] },
      { label: "Sağlık", href: "/benim/saglik", roles: ["employee"] },
      { label: "İlk günlerim", href: "/benim/ilk-gunlerim", roles: ["employee"] },
      { label: "Performansım", href: "/benim/performans", roles: ["employee"] },
      { label: "Hedef ve becerilerim", href: "/benim/hedefler", roles: ["employee"] },
      { label: "İş ilanları", href: "/benim/ilanlar", roles: ["employee"] },
      { label: "Bana gelen yazılar", href: "/benim/yazilar", roles: ["employee"] },
      { label: "Kişisel verilerim (KVKK)", href: "/benim/kvkk", roles: ["employee"] },
      { label: "Ayarlar", href: "/benim/ayarlar", roles: ["employee"] },
    ],
  },
  {
    group: "İnsan kaynakları",
    items: [
      { label: "Personel", href: "/personel", roles: MANAGERS },
      { label: "İşe alım ve ilanlar", href: "/ise-alim", roles: HRM },
      { label: "Uyum süreci", href: "/uyum", roles: HRM },
      { label: "Performans", href: "/performans", roles: HRM },
      { label: "Yetkinlik ve hedefler", href: "/yetkinlik", roles: HRM },
      { label: "Organizasyon", href: "/organizasyon", roles: MANAGERS },
    ],
  },
  {
    group: "Puantaj ve izin",
    items: [
      { label: "Puantaj", href: "/puantaj", roles: MANAGERS },
      { label: "Vardiyalar", href: "/vardiyalar", roles: MANAGERS },
      { label: "Yıllık izin", href: "/yillik-izin", roles: HRM },
      { label: "İzin kayıtları", href: "/izin", roles: MANAGERS },
      { label: "Fazla mesai", href: "/fazla-mesai", roles: MANAGERS },
      { label: "Mesai yemeği", href: "/yemek", roles: HRM },
    ],
  },
  {
    group: "Muhasebe ve bordro",
    items: [
      { label: "Ay sonu", href: "/ay-sonu", roles: PAY },
      { label: "Bordro", href: "/bordro", roles: PAY },
      { label: "Dönemler", href: "/donemler", roles: PAY },
      { label: "Avans ve ödemeler", href: "/odemeler/yeni", roles: PAY },
      { label: "Zamlar", href: "/zamlar", roles: PAY },
      { label: "BES", href: "/bes", roles: PAY },
      { label: "İcra ve nafaka", href: "/icra", roles: PAY },
      { label: "SGK işlemleri", href: "/sgk", roles: ["owner", "accountant", "hr"] },
    ],
  },
  {
    group: "Cari",
    items: [
      { label: "Cari hesaplar", href: "/isler/cari", logistics: true },
      { label: "Hekim / hastane kartları", href: "/isler/hekimler", logistics: true },
    ],
  },
  {
    group: "Laboratuvar / üretim",
    items: [
      { label: "İş kayıt", href: "/isler/yeni", logistics: true },
      { label: "İş listesi", href: "/isler", logistics: true },
      { label: "Prova / teslim listesi", href: "/isler/prova", logistics: true },
      { label: "Protez / ürün ve fiyatlar", href: "/isler/urunler", logistics: true },
      { label: "Laboratuvar listeleri", href: "/isler/ayarlar", logistics: true },
    ],
  },
  {
    group: "Lojistik",
    items: [
      { label: "Kargo, gümrük, kurye", href: "/kargo", logistics: true },
      { label: "Paket okut", href: "/kargo/okut", logistics: true },
      { label: "Kurye rotası", href: "/kargo/kurye", logistics: true },
    ],
  },
  {
    group: "Demirbaş ve zimmet",
    items: [{ label: "Zimmet / demirbaş", href: "/zimmet", roles: HRM }],
  },
  {
    group: "İSG ve yasal uyum",
    items: [
      { label: "İş güvenliği", href: "/isg", roles: MANAGERS },
      { label: "Sağlık", href: "/saglik", roles: ["owner", "hr", "safety"] },
      { label: "İş Kanunu uyumu", href: "/is-hukuku", roles: ["owner", "accountant", "hr"] },
      { label: "KVKK", href: "/kvkk", roles: ["owner", "hr"] },
      { label: "Mevzuat", href: "/mevzuat", roles: ["owner", "accountant", "hr"] },
    ],
  },
  { group: "Raporlar", items: [{ label: "Raporlar", href: "/raporlar", roles: MANAGERS }, { label: "Excel'den aktar", href: "/ice-aktar", roles: PAY }] },
  { group: "Web sitesi", items: [{ label: "Site yönetimi (mbdentaire.com)", href: "/site-gecis", site: true, raw: true }] },
  { group: "Sistem", items: [{ label: "Kiosk ekranı", href: "/kiosk", roles: ["owner", "hr", "branch_manager"] }, { label: "Yönetim ve yetkiler", href: "/yonetim", roles: ["owner", "hr"] }] },
];

const ALL_HREFS = () => NAV.flatMap((g) => g.items.map((i) => i.href));
/** Yol için en uygun (en uzun eşleşen) menü bağlantısı */
export function activeHref(path: string): string | null {
  let best: string | null = null;
  for (const h of ALL_HREFS()) {
    const hit = h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}

/** Kullanıcının yetkili olduğu modüller: rol + web sitesi erişimi */
export function visibleNav(role: string, siteAccess = false, logistics = false) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => (i.site ? siteAccess : i.logistics ? logistics : !i.roles || i.roles.includes(role))) })).filter((g) => g.items.length);
}

export function Sidebar({ companyName, role, siteAccess = false, logistics = false, badges = {} }: { companyName: string; role: string; siteAccess?: boolean; logistics?: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  const groups = visibleNav(role, siteAccess, logistics);
  const current = activeHref(path);
  const isActive = (href: string) => href === current;
  return (
    <nav aria-label="Ana menü" className="print:hidden hidden md:flex md:w-62 md:shrink-0 bg-brand-900 text-[#C9D6E5] flex-col gap-5 px-3.5 py-5">
      <div className="flex items-center gap-3 px-2">
        <div className="w-11 h-11 rounded-[10px] bg-white grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-9 h-9 object-contain" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-bold text-white text-[15px] tracking-wide">{companyName.toUpperCase() || "MB DENTAL"}</span>
          <span className="text-xs text-[#8FA6BF]">ERP · İK, bordro ve tüm modüller</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0">
        {groups.map((g) => {
          const open = g.group === "Genel" || g.group === "Benim sayfam" || groups.length <= 3 || g.items.some((n) => isActive(n.href));
          return (
            <details key={`${g.group}-${open}`} open={open} className="group/nav flex flex-col">
              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FA6BF] hover:bg-white/5 hover:text-white">
                {g.group}
                <span className="flex items-center gap-1.5">
                  {(() => {
                    const n = g.items.reduce((a, i) => a + (badges[i.href] ?? 0), 0);
                    return n > 0 ? <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center normal-case tracking-normal group-open/nav:hidden">{n > 99 ? "99+" : n}</span> : null;
                  })()}
                  <span aria-hidden="true" className="transition-transform group-open/nav:rotate-90">›</span>
                </span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {g.items.map((n) => n.raw ? (
                  <a key={n.href} href={n.href} className="px-3 py-2 rounded-lg whitespace-nowrap flex items-center justify-between gap-2 hover:bg-white/5">
                    {n.label} <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`px-3 py-2 rounded-lg whitespace-nowrap flex items-center justify-between gap-2 ${isActive(n.href) ? "bg-brand-600 text-white font-semibold" : "hover:bg-white/5"}`}
                  >
                    {n.label}
                    {(badges[n.href] ?? 0) > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold grid place-items-center" aria-label={`${badges[n.href]} okunmamış`}>
                        {badges[n.href]! > 99 ? "99+" : badges[n.href]}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <SignOutForm className="mt-auto px-1" buttonClassName="w-full text-left px-3 py-2.5 rounded-lg text-[#8FA6BF] hover:bg-white/5" />
    </nav>
  );
}
