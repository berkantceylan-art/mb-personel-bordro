import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Table, btnPrimary, btnSecondary, inputCls, page, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { transferAction } from "@/lib/stock-actions";
import { TRANSFER_STATUS, qty } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Transfer fişi: gönder, teslim al (eksik miktar), iptal */
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("stk_transfers").select("*, from:stk_warehouses!stk_transfers_from_warehouse_id_fkey(name), to:stk_warehouses!stk_transfers_to_warehouse_id_fkey(name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = data as { id: string; no: number; transfer_date: string; status: string; note: string | null; sent_at: string | null; received_at: string | null; from: { name: string } | null; to: { name: string } | null };
  const { data: lines } = await supabase.from("stk_transfer_lines").select("id, qty, lot_no, received_qty, stk_items(id, code, name, unit)").eq("transfer_id", id);
  type L = { id: string; qty: number; lot_no: string | null; received_qty: number | null; stk_items: { id: string; code: string; name: string; unit: string } | null };
  const ls = (lines ?? []) as unknown as L[];
  const can = (s.modules.stock ?? 0) >= 2;
  return (
    <>
      <PageHeader title={`Transfer #${t.no}`} subtitle={`${t.from?.name} → ${t.to?.name} · ${formatDate(t.transfer_date)}`} actions={<Link href="/stok/transfer" className="text-sm font-semibold text-brand-700">← Transferler</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Chip tone={TRANSFER_STATUS[t.status]?.[1]}>{TRANSFER_STATUS[t.status]?.[0]}</Chip>
          {t.sent_at && <span className="text-muted">Gönderildi: {formatDate(t.sent_at)}</span>}
          {t.received_at && <span className="text-muted">Teslim: {formatDate(t.received_at)}</span>}
          {t.note && <span>{t.note}</span>}
        </div>
        <form action={transferAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={t.id} />
          <Table head={["Kod", "Malzeme", "Lot", "Gönderilen", t.status === "in_transit" ? "Gelen" : "Teslim alınan"]} min={640}>
            {ls.map((l) => (
              <tr key={l.id}>
                <td className={`${td} num text-muted`}>{l.stk_items?.code}</td>
                <td className={td}>{l.stk_items?.name}</td>
                <td className={`${td} num`}>{l.lot_no ?? "otomatik"}</td>
                <td className={tdNum}>{qty(l.qty)} {l.stk_items?.unit}</td>
                <td className={tdNum}>
                  {t.status === "in_transit" && can ? <input name={`got_${l.id}`} defaultValue={String(l.qty)} inputMode="decimal" className={`${inputCls} w-28 text-right`} /> : l.received_qty !== null ? `${qty(l.received_qty)} ${l.stk_items?.unit}` : "—"}
                </td>
              </tr>
            ))}
            {ls.length === 0 && <EmptyRow cols={5} />}
          </Table>
          {can && (
            <div className="flex flex-wrap gap-2">
              {t.status === "draft" && <PendingSubmit name="op" value="send" className={btnPrimary}>Gönder</PendingSubmit>}
              {t.status === "in_transit" && <PendingSubmit name="op" value="receive" className={btnPrimary}>Teslim al</PendingSubmit>}
              {(t.status === "draft" || t.status === "in_transit") && <span className={btnSecondary}><ConfirmSubmit label="Transferi iptal et" name="op" value="cancel" question="İptal edilsin mi? Yoldaki miktar çıkış deposuna geri döner." /></span>}
            </div>
          )}
        </form>
      </div>
    </>
  );
}
