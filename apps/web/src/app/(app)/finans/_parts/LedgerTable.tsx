import Link from "next/link";
import { EmptyRow, Money, Table, td, tdNum } from "@/components/erp";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { voidTxn } from "@/lib/fin-actions";
import { TXN_KIND, fmt } from "@/lib/fin";
import { formatDate } from "@/lib/session";
import type { LedgerLine } from "@/lib/fin-data";

/** Ekstre tablosu: borç / alacak / yürüyen bakiye; finans kayıtları iptal edilebilir */
export function LedgerTable({ rows, currency, canVoid, debitLabel = "Borç", creditLabel = "Alacak", total }: { rows: LedgerLine[]; currency: string; canVoid: boolean; debitLabel?: string; creditLabel?: string; total: { debit: number; credit: number; balance: number } }) {
  return (
    <Table
      head={["Tarih", "Açıklama", "Tür", debitLabel, creditLabel, "Bakiye", ""]}
      min={880}
      foot={
        <tr className="font-semibold bg-ground">
          <td className={td} colSpan={3}>Toplam</td>
          <td className={tdNum}>{fmt(total.debit, currency)}</td>
          <td className={tdNum}>{fmt(total.credit, currency)}</td>
          <td className={tdNum}><Money v={total.balance} cur={currency} strong /></td>
          <td className={td} />
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.key} className={r.key === "devir" ? "bg-ground/60" : ""}>
          <td className={`${td} whitespace-nowrap`}>{r.date ? formatDate(r.date) : "—"}</td>
          <td className={td}>
            {r.href ? <Link href={r.href} className="font-semibold text-brand-700">{r.label}</Link> : <span className={r.key === "devir" ? "font-semibold" : ""}>{r.label || "—"}</span>}
            {r.sub && <span className="block text-xs text-muted">{r.sub}</span>}
          </td>
          <td className={`${td} text-xs text-muted whitespace-nowrap`}>{r.kind === "job" ? "İş kaydı" : r.kind ? TXN_KIND[r.kind] ?? r.kind : ""}</td>
          <td className={tdNum}>{r.debit ? fmt(r.debit, currency) : ""}</td>
          <td className={tdNum}>{r.credit ? fmt(r.credit, currency) : ""}</td>
          <td className={tdNum}><Money v={r.balance} cur={currency} /></td>
          <td className={`${td} text-right`}>
            {canVoid && r.voidable && r.txnId && (
              <form action={voidTxn}>
                <input type="hidden" name="id" value={r.txnId} />
                <input type="hidden" name="reason" value="Ekstreden iptal" />
                <ConfirmSubmit label="İptal" question="Bu kayıt iptal edilsin mi?" />
              </form>
            )}
          </td>
        </tr>
      ))}
      {rows.length === 0 && <EmptyRow cols={7} />}
    </Table>
  );
}
