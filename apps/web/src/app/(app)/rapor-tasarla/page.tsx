import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DATASETS, type DsKey, type ReportConfig } from "@/lib/report-defs";
import { ReportDesigner } from "./ReportDesigner";

export const dynamic = "force-dynamic";

/** Rapor tasarlayıcı: kendi tablo ve grafiğini kur, kaydet, paylaş */
export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const s = await getSession();
  const allowed = (Object.keys(DATASETS) as DsKey[]).filter((k) => s.role === "owner" || DATASETS[k].modules.some((m) => (s.modules[m] ?? 0) >= 1));
  if (!allowed.length) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: list, error } = await supabase.from("rpt_reports").select("id, name, config, shared, owner_id, updated_at").order("updated_at", { ascending: false }).limit(100);
  const reps = ((list ?? []) as { id: string; name: string; config: ReportConfig; shared: boolean; owner_id: string; updated_at: string }[]).filter((r) => allowed.includes(r.config?.ds));
  const sel = sp.r ? reps.find((r) => r.id === sp.r) : undefined;

  return (
    <>
      <PageHeader title="Rapor tasarlayıcı" subtitle="Veri kümesi, kırılım ve ölçü seçin; grafik ya da tablo olarak görün, kaydedin, şirkette paylaşın, CSV indirin" actions={sel ? <Link href="/rapor-tasarla" className="text-sm font-semibold text-brand-700">Yeni rapor</Link> : undefined} />
      <div className="p-4 md:p-8 grid gap-5 lg:grid-cols-[260px_1fr] max-w-[1400px]">
        <aside className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Kayıtlı raporlar</h2>
          {error && <p className="text-xs text-bad">Supabase&apos;de 20261229000000_reports_group.sql çalıştırılmalı.</p>}
          {reps.map((r) => (
            <Link key={r.id} href={`/rapor-tasarla?r=${r.id}`} className={`rounded-[12px] border px-3 py-2 text-sm ${sel?.id === r.id ? "border-brand-700 bg-[#EAF2FB]" : "border-line bg-white"}`}>
              <b className="block truncate">{r.name}</b>
              <span className="text-xs text-muted">{DATASETS[r.config.ds]?.label}{r.shared ? " · paylaşılan" : ""}{r.owner_id !== s.userId ? " · başkasının" : ""}</span>
            </Link>
          ))}
          {reps.length === 0 && <p className="text-sm text-muted">Henüz kayıtlı rapor yok. Sağda bir rapor kurup kaydedin.</p>}
        </aside>
        <ReportDesigner key={sel?.id ?? "new"} allowed={allowed} saved={!!sel} initial={sel ? { id: sel.id, name: sel.name, config: sel.config, shared: sel.shared, mine: sel.owner_id === s.userId } : undefined} />
      </div>
    </>
  );
}
