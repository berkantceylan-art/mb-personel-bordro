import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { dsNo } from "@/lib/barcode";
import { StartCount } from "./StartCount";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demirbaş sayımı" };

type C = { id: string; year: number; no: number; title: string; scope_location: string | null; status: string; created_at: string; closed_at: string | null; ast_count_items: { expected: boolean; found_at: string | null }[] };

/** Demirbaş sayımları: başlat, devam et, sonuçlar */
export default async function AssetCountsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: can } = await supabase.rpc("ast_count_can");
  if ((s.modules.assets ?? 0) < 1 && !can) redirect("/");
  const [{ data, error }, { data: locs }] = await Promise.all([
    supabase.from("ast_counts").select("id, year, no, title, scope_location, status, created_at, closed_at, ast_count_items(expected, found_at)").neq("status", "cancelled").order("created_at", { ascending: false }).limit(60),
    supabase.from("assets").select("location").not("location", "is", null).limit(3000),
  ]);
  const locations = [...new Set(((locs ?? []) as { location: string }[]).map((l) => l.location))].sort((a, b) => a.localeCompare(b, "tr"));
  const rows = (data ?? []) as unknown as C[];
  return (
    <>
      <PageHeader title="Demirbaş sayımı" subtitle="QR / barkod okutarak say · eksik, fazla, yer değiştiren ve arızalı demirbaşlar · sonuçları kartlara işle"
        actions={<Link href="/demirbas/etiket" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">🏷 QR etiket bas</Link>} />
      <div className={`${page} max-w-[1000px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270107000000_barcode.sql çalıştırılmalı.</Notice>}
        {(s.modules.assets ?? 0) >= 2 && <section className="bg-white border border-line rounded-[16px] p-4 md:p-5"><h2 className="font-display text-lg font-bold mb-3">Yeni sayım</h2><StartCount locations={locations} /></section>}
        <ul className="flex flex-col gap-2">
          {rows.map((c) => {
            const exp = c.ast_count_items.filter((i) => i.expected).length;
            const found = c.ast_count_items.filter((i) => i.expected && i.found_at).length;
            const extra = c.ast_count_items.filter((i) => !i.expected).length;
            return (
              <li key={c.id}>
                <Link href={`/demirbas/sayim/${c.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3 hover:border-brand-600">
                  <b className="num w-28">{dsNo(c)}</b>
                  <span className="flex-1 min-w-[200px]"><b>{c.title}</b><span className="block text-xs text-muted">{c.scope_location ?? "Tüm konumlar"} · {formatDate(c.created_at.slice(0, 10))}</span></span>
                  <span className="w-40"><span className="block h-2 overflow-hidden rounded-full bg-[#EEF2F6]"><span className="block h-full bg-[#22C55E]" style={{ width: `${exp ? (found / exp) * 100 : 0}%` }} /></span><span className="text-xs text-muted">{found} / {exp} bulundu{extra ? ` · ${extra} fazla` : ""}</span></span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c.status === "open" ? "bg-[#EAF2FB] text-brand-700" : "bg-ok-bg text-ok"}`}>{c.status === "open" ? "Sayılıyor" : "Kapandı"}</span>
                </Link>
              </li>
            );
          })}
          {!rows.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz sayım yok.</li>}
        </ul>
      </div>
    </>
  );
}
