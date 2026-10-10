import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { RELATED, visibleNav, type Item } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";

export const dynamic = "force-dynamic";

type Stat = { label: string; value: number; href: string; tone?: "bad" | "warn" };

/** Laboratuvar ana sayfası için günlük sayılar */
async function labStats(): Promise<Stat[]> {
  const supabase = await createClient();
  const today = todayIso();
  const active = ["open", "tryin", "ready"];
  const [open, dueToday, late, tryin, ready] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "tryin"]),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", active).eq("due_date", today),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", active).lt("due_date", today),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "tryin"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "ready"),
  ]);
  if (open.error) return [];
  return [
    { label: "Üretimdeki işler", value: open.count ?? 0, href: "/isler?sekme=acik" },
    { label: "Bugün çıkacak", value: dueToday.count ?? 0, href: "/isler?sekme=bugun", tone: "warn" },
    { label: "Geciken", value: late.count ?? 0, href: "/isler?sekme=geciken", tone: "bad" },
    { label: "Provada", value: tryin.count ?? 0, href: "/isler/prova" },
    { label: "Teslime hazır", value: ready.count ?? 0, href: "/isler?sekme=acik" },
  ];
}

function Tile({ item, primary }: { item: Item; primary?: boolean }) {
  const cls = `group rounded-[14px] border p-5 flex flex-col gap-1.5 min-h-[112px] transition-colors ${
    primary ? "bg-brand-700 border-brand-700 text-white hover:bg-brand-800" : "bg-white border-line hover:border-brand-600 hover:bg-[#F5F9FD]"
  }`;
  const body = (
    <>
      <span className={`font-display text-lg font-semibold flex items-center justify-between gap-2 ${primary ? "text-white" : "text-brand-800"}`}>
        {item.label}
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">{item.raw ? "↗" : "→"}</span>
      </span>
      {item.desc && <span className={`text-sm leading-snug ${primary ? "text-white/80" : "text-muted"}`}>{item.desc}</span>}
    </>
  );
  return item.raw ? <a href={item.href} className={cls}>{body}</a> : <Link href={item.href} className={cls}>{body}</Link>;
}

/** Modül ana sayfası: yan menüde grup başlığına basınca açılır; modülün tüm işlemleri buton olarak */
export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await getSession();
  const groups = visibleNav(s.role, s.siteAccess, s.logistics);
  const g = groups.find((x) => x.slug === slug);
  if (!g) notFound();
  const related = (RELATED[slug] ?? []).map((r) => groups.find((x) => x.slug === r)).filter((x): x is NonNullable<typeof x> => !!x);
  const stats = slug === "laboratuvar" ? await labStats() : [];
  const primary = slug === "laboratuvar" ? "/isler/yeni" : null;

  return (
    <>
      <PageHeader title={g.group} subtitle="Bu modülde yapabileceğiniz işlemler" />
      <div className="px-4 md:px-8 py-6 flex flex-col gap-8 max-w-[1200px]">
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.map((st) => (
              <Link key={st.label} href={st.href} className="bg-white border border-line rounded-[14px] px-4 py-3 flex flex-col hover:border-brand-600">
                <span className="text-xs text-muted">{st.label}</span>
                <span className={`font-display text-2xl font-bold ${st.value > 0 && st.tone === "bad" ? "text-bad" : st.value > 0 && st.tone === "warn" ? "text-warn" : "text-brand-800"}`}>{st.value}</span>
              </Link>
            ))}
          </div>
        )}
        <section aria-label="İşlemler" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {g.items.map((i) => <Tile key={i.href} item={i} primary={i.href === primary} />)}
        </section>
        {related.map((r) => (
          <section key={r.slug} aria-labelledby={`r-${r.slug}`} className="flex flex-col gap-3">
            <h2 id={`r-${r.slug}`} className="font-display text-base font-semibold text-brand-800 flex items-center gap-3">
              {r.group}
              <Link href={`/modul/${r.slug}`} className="text-sm font-normal text-brand-600 hover:underline">modüle git</Link>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {r.items.map((i) => <Tile key={i.href} item={i} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
