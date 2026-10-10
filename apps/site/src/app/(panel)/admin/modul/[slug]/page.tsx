import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcon";
import { ADMIN_NAV } from "@/lib/admin-nav";

/** Modül sayfası: menüde modül ikonuna basınca açılır; modülün tüm sayfaları buton olarak */
export default async function AdminModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = ADMIN_NAV.find((x) => x.slug === slug);
  if (!g) notFound();
  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-smile to-blue text-white shadow-lg">
          <AdminIcon name={g.slug} className="h-6 w-6" />
        </span>
        <div>
          <h1 className="display text-3xl font-semibold text-navy">{g.title}</h1>
          <p className="text-slate">Bu modüldeki sayfalar</p>
        </div>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {g.items.map((i, n) => (
          <Link
            key={i.href}
            href={i.href}
            className={`group flex min-h-[112px] flex-col gap-1.5 rounded-2xl border p-5 transition-colors ${n === 0 ? "border-navy bg-navy text-white hover:bg-blue" : "border-gypsum bg-white hover:border-blue"}`}
          >
            <span className={`display flex items-center justify-between gap-2 text-lg font-semibold ${n === 0 ? "text-white" : "text-navy"}`}>
              {i.label}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
            {i.desc && <span className={`text-sm leading-snug ${n === 0 ? "text-white/80" : "text-slate"}`}>{i.desc}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
