"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: Array<{ group: string; items: Array<{ label: string; href: string; soon?: boolean }> }> = [
  { group: "Genel", items: [{ label: "Gösterge Paneli", href: "/" }, { label: "Personel", href: "/personel" }] },
  {
    group: "Zaman",
    items: [
      { label: "Puantaj", href: "/puantaj" },
      { label: "Vardiyalar", href: "/vardiyalar" },
      { label: "İzin", href: "/izin" },
      { label: "Fazla Mesai", href: "/fazla-mesai" },
    ],
  },
  {
    group: "Para",
    items: [
      { label: "Avans & Ödemeler", href: "/odemeler/yeni" },
      { label: "Dönemler", href: "/donemler" },
      { label: "Zamlar", href: "/zamlar" },
      { label: "Bordro", href: "/bordro" },
      { label: "BES", href: "/bes" },
      { label: "İcra & Nafaka", href: "/icra" },
    ],
  },
  { group: "Uyum", items: [{ label: "İş Güvenliği", href: "/isg" }, { label: "Sağlık", href: "/saglik" }] },
  { group: "Analiz", items: [{ label: "Raporlar", href: "/raporlar", soon: true }, { label: "Excel'den Aktar", href: "/ice-aktar" }] },
];

export function Sidebar({ companyName }: { companyName: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav aria-label="Ana menü" className="md:w-62 md:shrink-0 bg-brand-900 text-[#C9D6E5] flex flex-col gap-5 px-3.5 py-5">
      <div className="flex items-center gap-3 px-2">
        <div className="w-11 h-11 rounded-[10px] bg-white grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-9 h-8 object-contain" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-bold text-white text-[15px] tracking-wide">{companyName.toUpperCase() || "MB DENTAL"}</span>
          <span className="text-xs text-[#8FA6BF]">Personel &amp; Bordro</span>
        </div>
      </div>
      <div className="flex md:flex-col gap-4 overflow-x-auto md:overflow-visible">
        {NAV.map((g) => (
          <div key={g.group} className="flex md:flex-col gap-0.5 shrink-0">
            <span className="hidden md:block text-[11px] uppercase tracking-[0.08em] text-[#6F8AA8] px-2.5 pb-1">{g.group}</span>
            {g.items.map((n) =>
              n.soon ? (
                <span key={n.href} className="px-3 py-2.5 rounded-lg text-[#6F8AA8] whitespace-nowrap" title="Sonraki aşamada">
                  {n.label}
                </span>
              ) : (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`px-3 py-2.5 rounded-lg whitespace-nowrap ${isActive(n.href) ? "bg-brand-600 text-white font-semibold" : "hover:bg-white/5"}`}
                >
                  {n.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
