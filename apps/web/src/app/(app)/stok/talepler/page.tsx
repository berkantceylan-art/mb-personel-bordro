import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, Tabs, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { KIND_LABEL, MR_STATUS, mrNo, qtyFmt } from "@/lib/material";

export const dynamic = "force-dynamic";
export const metadata = { title: "Malzeme talepleri" };

type Row = { id: string; kind?: string; requested_by?: string; year: number; no: number; status: string; needed_by: string | null; created_at: string; employees: { first_name: string; last_name: string } | null; stk_request_lines: { name: string; qty: number; unit: string; sort: number }[] };
const TABS: [string, string, string[]][] = [
  ["acik", "Yapılacaklar", ["pending", "ready", "approved"]],
  ["satin", "Satın alma onayı", ["purchase"]],
  ["imza", "İmza bekleyen", ["delivered"]],
  ["biten", "Tamamlanan", ["completed"]],
  ["hepsi", "Hepsi", []],
];

/** Depo ve satın alma: personelden gelen malzeme istekleri */
export default async function MaterialRequestsPage({ searchParams }: { searchParams: Promise<{ s?: string; tur?: string }> }) {
  const ses = await getSession();
  if ((ses.modules.stock ?? 0) < 1 && (ses.modules.purchases ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let res = await supabase.from("stk_requests").select("id, kind, requested_by, year, no, status, needed_by, created_at, employees(first_name, last_name), stk_request_lines(name, qty, unit, sort)").order("created_at", { ascending: false }).limit(400);
  const v2 = !res.error;
  if (res.error) res = await supabase.from("stk_requests").select("id, year, no, status, needed_by, created_at, employees(first_name, last_name), stk_request_lines(name, qty, unit, sort)").order("created_at", { ascending: false }).limit(300) as typeof res;
  const { data, error } = res;
  const { data: dir } = await supabase.rpc("company_directory");
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const tur = ["material", "asset", "supply"].includes(sp.tur ?? "") ? sp.tur! : "";
  const all = ((data ?? []) as unknown as Row[]).filter((r) => !tur || (r.kind ?? "material") === tur);
  const who = (r: Row) => (r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : r.requested_by ? names.get(r.requested_by) ?? "—" : "—");
  const q = (k: string) => `/stok/talepler?s=${k}${tur ? `&tur=${tur}` : ""}`;
  const defTab = (ses.modules.stock ?? 0) >= 2 ? "acik" : "satin";
  const tab = TABS.find((t) => t[0] === sp.s) ?? TABS.find((t) => t[0] === defTab)!;
  const rows = tab[2].length ? all.filter((r) => tab[2].includes(r.status)) : all;
  const count = (st: string[]) => (st.length ? all.filter((r) => st.includes(r.status)).length : all.length);

  return (
    <>
      <PageHeader title="İstekler" subtitle="Malzeme, demirbaş ve dış sipariş istekleri → depo (varsa teslim, yoksa satın alma) → satın alma onayı → alım listesi / kurye → teslim ve çift imza"
        actions={v2 && (ses.modules.purchases ?? 0) >= 1 ? <Link href="/stok/talepler/alim" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">🛒 Alım listeleri</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270102000000_material_requests.sql çalıştırılmalı.</Notice>}
        <Tabs active={q(tab[0])} items={TABS.map(([k, l, st]) => [q(k), l, count(st)])} />
        {v2 && (
          <nav className="flex flex-wrap gap-1.5 text-xs">
            {[["", "Tüm türler"], ["material", "Malzeme"], ["asset", "Demirbaş"], ["supply", "Dış sipariş"]].map(([k, l]) => (
              <Link key={k} href={`/stok/talepler?s=${tab[0]}${k ? `&tur=${k}` : ""}`} className={`rounded-md px-2.5 py-1 font-semibold ${tur === k ? "bg-ink text-white" : "bg-[#EEF2F6] text-ink"}`}>{l}</Link>
            ))}
          </nav>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const [label, cls] = MR_STATUS[r.status] ?? MR_STATUS.pending!;
            const late = r.needed_by && r.needed_by < new Date().toISOString().slice(0, 10) && !["completed", "delivered", "rejected", "cancelled"].includes(r.status);
            return (
              <li key={r.id}>
                <Link href={`/stok/talepler/${r.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3 hover:border-brand-600">
                  <b className="num w-28">{mrNo(r)}</b>
                  <span className="w-40 truncate font-semibold">{who(r)}{r.kind && r.kind !== "material" && <span className="block text-[11px] font-semibold text-[#6D28D9]">{KIND_LABEL[r.kind]}</span>}</span>
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
