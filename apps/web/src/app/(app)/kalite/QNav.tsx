import Link from "next/link";

/** Kalite alt menüsü */
export const QNav = ({ at }: { at: string }) => (
  <div className="flex flex-wrap gap-1">
    {[["/kalite", "Şikâyetler"], ["/kalite/uygunsuzluk", "Uygunsuzluk ve DÖF"], ["/kalite/denetim", "İç denetim"], ["/kalite/anket", "Memnuniyet anketi"]].map(([h, l]) => <Link key={h} href={h} className={`h-9 px-3 inline-flex items-center rounded-[10px] text-sm font-semibold ${at === h ? "bg-ink text-white" : "border border-line bg-white"}`}>{l}</Link>)}
  </div>
);
