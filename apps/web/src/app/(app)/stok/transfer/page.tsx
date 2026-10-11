import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Notice, Table, page, td } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { TRANSFER_STATUS } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Depo transferleri */
export default async function TransfersPage() {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.from("stk_transfers").select("id, no, transfer_date, status, note, from:stk_warehouses!stk_transfers_from_warehouse_id_fkey(name), to:stk_warehouses!stk_transfers_to_warehouse_id_fkey(name), stk_transfer_lines(id)").order("no", { ascending: false }).limit(200);
  type Row = { id: string; no: number; transfer_date: string; status: string; note: string | null; from: { name: string } | null; to: { name: string } | null; stk_transfer_lines: { id: string }[] };
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Depo transferleri" subtitle={`${rows.filter((r) => r.status === "in_transit").length} yolda`} actions={(s.modules.stock ?? 0) >= 2 ? <Link href="/stok/transfer/yeni" className="text-sm font-semibold text-brand-700">+ Yeni transfer</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        <Table head={["No", "Tarih", "Çıkış", "Giriş", "Kalem", "Durum", "Not"]} min={760}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}><Link href={`/stok/transfer/${r.id}`} className="font-semibold text-brand-700">#{r.no}</Link></td>
              <td className={td}>{formatDate(r.transfer_date)}</td>
              <td className={td}>{r.from?.name}</td>
              <td className={td}>{r.to?.name}</td>
              <td className={`${td} num`}>{r.stk_transfer_lines.length}</td>
              <td className={td}><Chip tone={TRANSFER_STATUS[r.status]?.[1]}>{TRANSFER_STATUS[r.status]?.[0]}</Chip></td>
              <td className={td}>{r.note ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} />}
        </Table>
      </div>
    </>
  );
}
