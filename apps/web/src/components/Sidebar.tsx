"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutForm } from "./SignOut";

type Item = { label: string; href: string; roles?: string[] };
const MANAGERS = ["owner", "accountant", "hr", "branch_manager", "safety"];
const PAY = ["owner", "accountant"];
const HR = ["owner", "hr", "branch_manager"];

export const NAV: Array<{ group: string; items: Item[] }> = [
  {
    group: "Genel",
    items: [
      { label: "Gösterge Paneli", href: "/", roles: MANAGERS },
      { label: "Patron ekranı", href: "/patron", roles: ["owner", "accountant"] },
      { label: "Benim sayfam", href: "/benim", roles: ["employee"] },
      { label: "Avans iste", href: "/benim/avans", roles: ["employee"] },
      { label: "İzin iste", href: "/benim/izin", roles: ["employee"] },
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
      { label: "İş güvenliği", href: "/benim/isg", roles: ["employee"] },
      { label: "Sağlık", href: "/benim/saglik", roles: ["employee"] },
      { label: "İlk günlerim", href: "/benim/ilk-gunlerim", roles: ["employee"] },
      { label: "Performansım", href: "/benim/performans", roles: ["employee"] },
      { label: "Hedef ve becerilerim", href: "/benim/hedefler", roles: ["employee"] },
      { label: "İş ilanları", href: "/benim/ilanlar", roles: ["employee"] },
      { label: "Kişisel verilerim (KVKK)", href: "/benim/kvkk", roles: ["employee"] },
      { label: "Ayarlar", href: "/benim/ayarlar", roles: ["employee"] },
      { label: "Personel", href: "/personel", roles: MANAGERS },
      { label: "Zimmet", href: "/zimmet", roles: ["owner", "accountant", "hr", "branch_manager"] },
    ],
  },
  {
    group: "İnsan kaynakları",
    items: [
      { label: "İşe alım", href: "/ise-alim", roles: ["owner", "accountant", "hr", "branch_manager"] },
      { label: "Uyum süreci", href: "/uyum", roles: ["owner", "accountant", "hr", "branch_manager"] },
      { label: "Performans", href: "/performans", roles: ["owner", "accountant", "hr", "branch_manager"] },
      { label: "Yetkinlik ve hedefler", href: "/yetkinlik", roles: ["owner", "accountant", "hr", "branch_manager"] },
      { label: "Organizasyon", href: "/organizasyon", roles: MANAGERS },
    ],
  },
  {
    group: "İletişim",
    items: [
      { label: "Duyurular", href: "/duyurular" },
      { label: "Mesajlar", href: "/mesajlar" },
      { label: "Talepler", href: "/talepler", roles: [...new Set([...PAY, ...HR])] },
      { label: "Bildirimler", href: "/bildirimler" },
    ],
  },
  {
    group: "Zaman",
    items: [
      { label: "Puantaj", href: "/puantaj", roles: MANAGERS },
      { label: "Vardiyalar", href: "/vardiyalar", roles: MANAGERS },
      { label: "İzin", href: "/izin", roles: MANAGERS },
      { label: "Fazla Mesai", href: "/fazla-mesai", roles: MANAGERS },
      { label: "Mesai yemeği", href: "/yemek", roles: ["owner", "accountant", "hr", "branch_manager"] },

    ],
  },
  {
    group: "Para",
    items: [
      { label: "Ay sonu", href: "/ay-sonu", roles: PAY },
      { label: "Avans & Ödemeler", href: "/odemeler/yeni", roles: PAY },
      { label: "Dönemler", href: "/donemler", roles: PAY },
      { label: "Zamlar", href: "/zamlar", roles: PAY },
      { label: "Bordro", href: "/bordro", roles: PAY },
      { label: "BES", href: "/bes", roles: PAY },
      { label: "İcra & Nafaka", href: "/icra", roles: PAY },
    ],
  },
  { group: "Uyum", items: [{ label: "İş Güvenliği", href: "/isg", roles: MANAGERS }, { label: "Sağlık", href: "/saglik", roles: ["owner", "hr", "safety"] }, { label: "KVKK", href: "/kvkk", roles: ["owner", "hr"] }] },
  { group: "Analiz", items: [{ label: "Raporlar", href: "/raporlar", roles: MANAGERS }, { label: "Excel'den Aktar", href: "/ice-aktar", roles: PAY }] },
  { group: "Sistem", items: [{ label: "Kiosk ekranı", href: "/kiosk", roles: ["owner", "hr", "branch_manager"] }, { label: "Yönetim", href: "/yonetim", roles: ["owner", "hr"] }, { label: "Mevzuat", href: "/mevzuat", roles: ["owner", "accountant", "hr"] }] },
];

export function Sidebar({ companyName, role, badges = {} }: { companyName: string; role: string; badges?: Record<string, number> }) {
  const path = usePathname();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter((g) => g.items.length);
  const isActive = (href: string) => (href === "/" || href === "/benim" ? path === href : path.startsWith(href));
  return (
    <nav aria-label="Ana menü" className="print:hidden hidden md:flex md:w-62 md:shrink-0 bg-brand-900 text-[#C9D6E5] flex-col gap-5 px-3.5 py-5">
      <div className="flex items-center gap-3 px-2">
        <div className="w-11 h-11 rounded-[10px] bg-white grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-9 h-9 object-contain" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-bold text-white text-[15px] tracking-wide">{companyName.toUpperCase() || "MB DENTAL"}</span>
          <span className="text-xs text-[#8FA6BF]">Personel &amp; Bordro</span>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.group} className="flex flex-col gap-0.5">
            <span className="block text-[11px] uppercase tracking-[0.08em] text-[#6F8AA8] px-2.5 pb-1">{g.group}</span>
            {g.items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-2.5 rounded-lg whitespace-nowrap flex items-center justify-between gap-2 ${isActive(n.href) ? "bg-brand-600 text-white font-semibold" : "hover:bg-white/5"}`}
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
        ))}
      </div>
      <SignOutForm className="mt-auto px-1" buttonClassName="w-full text-left px-3 py-2.5 rounded-lg text-[#8FA6BF] hover:bg-white/5" />
    </nav>
  );
}
