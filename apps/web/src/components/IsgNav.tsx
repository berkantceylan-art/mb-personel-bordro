import Link from "next/link";

const ITEMS: Array<[string, string]> = [
  ["/isg", "Eğitim ve KKD"], ["/isg/egitim", "Eğitim yükümlülükleri"], ["/isg/katip", "İSG-KATİP"], ["/isg/risk", "Risk değerlendirmesi"], ["/isg/acil", "Acil durum"],
  ["/isg/kurul", "İSG kurulu"], ["/isg/defter", "Tespit ve öneri"], ["/isg/kaza", "İş kazası"], ["/isg/kontrol", "Kontrol ve ölçüm"],
];

/** İSG bölümleri arasında gezinme (telefonda yatay kaydırılır) */
export function IsgNav({ active }: { active: string }) {
  return (
    <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 print:hidden" aria-label="İSG bölümleri">
      {ITEMS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={active === href ? "page" : undefined}
          className={`shrink-0 h-10 px-3.5 rounded-full text-sm font-semibold grid place-items-center ${active === href ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{label}</Link>
      ))}
    </nav>
  );
}
