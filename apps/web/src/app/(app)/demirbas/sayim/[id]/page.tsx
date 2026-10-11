import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { dsNo } from "@/lib/barcode";
import { CountScreen, type CItem } from "./CountScreen";

export const dynamic = "force-dynamic";

/** Demirbaş sayımı: canlı okutma ekranı ve sonuç raporu */
export default async function AssetCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: c }, { data: it }, { data: locs }] = await Promise.all([
    supabase.from("ast_counts").select("id, year, no, title, scope_location, status, created_at, closed_at").eq("id", id).maybeSingle(),
    supabase.from("ast_count_items").select("id, asset_id, expected, expected_location, found_at, found_location, condition, note, assets(name, code, serial_no, category)").eq("count_id", id).limit(5000),
    supabase.from("assets").select("location").not("location", "is", null).limit(3000),
  ]);
  if (!c) notFound();
  const items: CItem[] = ((it ?? []) as unknown as (Omit<CItem, "name" | "code" | "serial_no" | "category"> & { assets: { name: string; code: string | null; serial_no: string | null; category: string } | null })[])
    .map((i) => ({ ...i, name: i.assets?.name ?? "—", code: i.assets?.code ?? null, serial_no: i.assets?.serial_no ?? null, category: i.assets?.category ?? "DIGER" }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const locations = [...new Set(((locs ?? []) as { location: string }[]).map((l) => l.location))].sort((a, b) => a.localeCompare(b, "tr"));
  return (
    <>
      <PageHeader title={`${dsNo(c)} · ${c.title}`} subtitle={`${c.scope_location ?? "Tüm konumlar"} · ${c.status === "open" ? "sayılıyor" : "kapandı"}`} actions={<PrintButton />} />
      <div className={page}>
        <Link href="/demirbas/sayim" className="text-sm font-semibold text-brand-700 print:hidden">← Sayımlar</Link>
        <CountScreen id={id} items={items} open={c.status === "open"} canClose={(s.modules.assets ?? 0) >= 2} locations={locations} />
      </div>
    </>
  );
}
