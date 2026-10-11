import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { KIND_LABEL, buyNo, mrNo } from "@/lib/material";
import { NewBuyListForm } from "./BuyList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alım listeleri" };

type Req = { id: string; kind: string; year: number; no: number; requested_by: string; employees: { first_name: string; last_name: string } | null; stk_request_lines: { id: string; name: string; qty: number; unit: string; vendor: string | null; note: string | null; to_purchase: boolean; buy_list_id: string | null; sort: number }[] };
type List = { id: string; year: number; no: number; status: string; courier_user: string | null; planned_on: string | null; created_at: string; done_at: string | null };
const ST: Record<string, [string, string]> = { open: ["Kuryede", "bg-[#EAF2FB] text-brand-700"], done: ["Tamamlandı", "bg-ok-bg text-ok"], cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"] };

/** Satın alma: onaylı isteklerden alım listesi çıkar, kuryeye ata, listeleri izle */
export default async function BuyListsPage() {
  const s = await getSession();
  const pur = s.modules.purchases ?? 0;
  if (pur < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: reqs, error }, { data: lists }, { data: dir }, { data: couriers }] = await Promise.all([
    supabase.from("stk_requests").select("id, kind, year, no, requested_by, employees(first_name, last_name), stk_request_lines(id, name, qty, unit, vendor, note, to_purchase, buy_list_id, sort)").eq("status", "approved").order("created_at").limit(200),
    supabase.from("stk_buy_lists").select("id, year, no, status, courier_user, planned_on, created_at, done_at").order("created_at", { ascending: false }).limit(60),
    supabase.rpc("company_directory"),
    pur >= 2 ? supabase.rpc("stk_couriers") : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const pending = ((reqs ?? []) as unknown as Req[])
    .map((r) => ({
      id: r.id, no: mrNo(r), kind: KIND_LABEL[r.kind] ?? "", requester: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : names.get(r.requested_by) ?? "—",
      lines: [...r.stk_request_lines].filter((l) => l.to_purchase && !l.buy_list_id).sort((a, b) => a.sort - b.sort),
    }))
    .filter((r) => r.lines.length);
  const L = (lists ?? []) as List[];

  return (
    <>
      <PageHeader title="Alım listeleri" subtitle="Onaylı satın alma istekleri → tedarikçiye göre liste → kurye alır → depo teslim eder" />
      <div className={`${page} max-w-[1100px]`}>
        <Link href="/stok/talepler" className="text-sm font-semibold text-brand-700">← İstekler</Link>
        {error && <Notice tone="bad">Supabase&apos;de 20270105000000_request_kinds.sql çalıştırılmalı.</Notice>}
        {pur >= 2 && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
            <h2 className="font-display text-lg font-bold mb-3">Yeni alım listesi <span className="text-sm font-normal text-muted">· {pending.length} onaylı istek bekliyor</span></h2>
            <NewBuyListForm pending={pending} couriers={(couriers ?? []) as { user_id: string; name: string; logistics: boolean }[]} />
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Listeler</h2>
          {L.map((b) => {
            const [label, cls] = ST[b.status] ?? ST.open!;
            return (
              <Link key={b.id} href={`/stok/talepler/alim/${b.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3 hover:border-brand-600">
                <b className="num w-32">{buyNo(b)}</b>
                <span className="flex-1 text-sm">Kurye: <b>{b.courier_user ? names.get(b.courier_user) ?? "—" : "—"}</b>{b.planned_on ? ` · ${formatDate(b.planned_on)}` : ""}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
                <span className="text-xs text-muted w-24 text-right">{formatDate((b.done_at ?? b.created_at).slice(0, 10))}</span>
              </Link>
            );
          })}
          {!L.length && <p className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz alım listesi yok.</p>}
        </section>
      </div>
    </>
  );
}
