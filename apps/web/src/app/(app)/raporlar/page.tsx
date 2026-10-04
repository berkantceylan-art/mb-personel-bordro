import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { REPORTS } from "@/lib/reports";
import { getSession } from "@/lib/session";

const GROUPS = ["Ödeme listeleri", "Maaş ve maliyet", "Zaman", "Uyum", "Personel"] as const;
const OTHER = [
  { href: "/zamlar", title: "Zam raporu", description: "Aylara, bölümlere ve personele göre zamlar; Excel çıktısı.", group: "Maaş ve maliyet", roles: ["owner", "accountant"] },
  { href: "/donemler", title: "Dönem maaş listeleri", description: "Her dönemin kişi bazlı hakediş / ödeme / kalan listesi.", group: "Maaş ve maliyet", roles: ["owner", "accountant"] },
  { href: "/bordro", title: "Bordro ve PDF fişler", description: "Resmi bordro ve iç hakediş fişleri, toplu yazdırma.", group: "Maaş ve maliyet", roles: ["owner", "accountant"] },
];

export default async function ReportsPage() {
  const s = await getSession();
  const list = REPORTS.filter((r) => r.roles.includes(s.role));
  return (
    <>
      <PageHeader title="Raporlar" subtitle="Tüm modüllerden filtreli raporlar; ekranda görüntüleyin veya Excel olarak indirin." />
      <div className="p-4 md:p-8 flex flex-col gap-7 max-w-[1240px]">
        {GROUPS.map((g) => {
          const items = [...list.filter((r) => r.group === g).map((r) => ({ href: `/raporlar/${r.key}`, title: r.title, description: r.description })), ...OTHER.filter((o) => o.group === g && o.roles.includes(s.role))];
          if (!items.length) return null;
          return (
            <section key={g} className="flex flex-col gap-3">
              <h2 className="font-display font-semibold text-brand-800">{g}</h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                {items.map((r) => (
                  <Link key={r.href} href={r.href} className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-1.5 hover:border-brand-700">
                    <span className="font-semibold text-brand-700">{r.title}</span>
                    <span className="text-[13px] text-muted">{r.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
