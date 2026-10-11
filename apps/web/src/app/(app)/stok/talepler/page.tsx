import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, Tabs, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { MR_STATUS, mrNo, qtyFmt } from "@/lib/material";

export const dynamic = "force-dynamic";
export const metadata = { title: "Malzeme talepleri" };

type Row = { id: string; year: number; no: number; status: string; needed_by: string | null; created_at: string; employees: { first_name: string; last_name: string } | null; stk_request_lines: { name: string; qty: number; unit: string; sort: number }[] };
const TABS: [string, string, string[]][] = [
  ["acik", "Yapılacaklar", ["pending", "ready", "approved"]],
  ["satin", "Satın alma onayı", ["purchase"]],
  ["imza", "İmza bekleyen", ["delivered"]],
  ["biten", "Tamamlanan", ["completed"]],
  ["hepsi", "Hepsi", []],
];

/** Depo ve satın alma: personelden gelen malzeme istekleri */
export default async function MaterialRequestsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const ses = await getSession();
  if ((ses.modules.stock ?? 0) < 1 && (ses.modules.purchases ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("stk_requests").select("id, year, no, status, needed_by, created_at, employees(first_name, last_name), stk_request_lines(name, qty, unit, sort)").order("created_at", { ascending: false }).limit(300);
  const all = (data ?? []) as unknown as Row[];
  const defTab = (ses.modules.stock ?? 0) >= 2 ? "acik" : "satin";
  const tab = TABS.find((t) => t[0] === sp.s) ?? TABS.find((t) => t[0] === defTab)!;
  const rows = tab[2].length ? all.filter((r) => tab[2].includes(r.status)) : all;
  const count = (st: string[]) => (st.length ? all.filter((r) => st.includes(r.status)).length : all.length);

  return (
    <>
      <PageHeader title="Malzeme talepleri" subtitle="Personel isteği → depo (varsa teslim, yoksa satın alma) → satın alma onayı → teslim ve çift imza" />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270102000000_material_requests.sql çalıştırılmalı.</Notice>}
        <Tabs active={`/stok/talepler?s=${tab[0]}`} items={TABS.map(([k, l, st]) => [`/stok/talepler?s=${k}`, l, count(st)])} />
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const [label, cls] = MR_STATUS[r.status] ?? MR_STATUS.pending!;
            const late = r.needed_by && r.needed_by < new Date().toISOString().slice(0, 10) && !["completed", "delivered", "rejected", "cancelled"].includes(r.status);
            return (
              <li key={r.id}>
                <Link href={`/stok/talepler/${r.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3 hover:border-brand-600">
                  <b className="num w-28">{mrNo(r)}</b>
                  <span className="w-40 truncate font-semibold">{r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "—"}</span>
                  <span className="flex-1 min-w-[200px] truncate text-sm text-muted">{[...r.stk_request_lines].sort((a, b) => a.sort - b.sort).map((l) => `${l.name} × ${qtyFmt(l.qty)} ${l.unit}`).join(", ")}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
                  <span className={`text-xs w-28 text-right ${late ? "text-bad font-semibold" : "text-muted"}`}>{r.needed_by ? `lazım ${formatDate(r.needed_by)}` : formatDate(r.created_at.slice(0, 10))}</span>
                </Link>
              </li>
            );
          })}
          {rows.length === 0 && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Bu listede istek yok.</li>}
        </ul>
      </div>
    </>
  );
}
