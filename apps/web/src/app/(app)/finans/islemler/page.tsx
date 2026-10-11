import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Notice, Table, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { voidTxn } from "@/lib/fin-actions";
import { TXN_KIND, dateOk, fmt } from "@/lib/fin";

export const dynamic = "force-dynamic";

type Row = { id: string; no: number; txn_date: string; kind: string; description: string | null; doc_no: string | null; amount: number; currency: string; voided_at: string | null; void_reason: string | null; fin_parties: { id: string; name: string } | null; fin_accounts: { id: string; name: string } | null; fin_categories: { name: string } | null };

/** İşlem defteri: tüm finans kayıtları */
export default async function TxnsPage({ searchParams }: { searchParams: Promise<{ tur?: string; bas?: string; bit?: string; q?: string; iptal?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("fin_txns").select("id, no, txn_date, kind, description, doc_no, amount, currency, voided_at, void_reason, fin_parties(id, name), fin_accounts(id, name), fin_categories(name)").order("txn_date", { ascending: false }).order("no", { ascending: false }).limit(500);
  if (sp.tur && sp.tur in TXN_KIND) q = q.eq("kind", sp.tur);
  if (dateOk(sp.bas)) q = q.gte("txn_date", sp.bas!);
  if (dateOk(sp.bit)) q = q.lte("txn_date", sp.bit!);
  if (sp.iptal !== "1") q = q.is("voided_at", null);
  const { data, error } = await q;
  const term = (sp.q ?? "").toLocaleLowerCase("tr");
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !term || `${r.description ?? ""} ${r.doc_no ?? ""} ${r.fin_parties?.name ?? ""} ${r.no}`.toLocaleLowerCase("tr").includes(term));
  const canVoid = (s.modules.finance ?? 0) >= 2;
  return (
    <>
      <PageHeader title="İşlem defteri" subtitle="Son 500 kayıt" actions={canVoid ? <Link href="/finans/islem" className="text-sm font-semibold text-brand-700">+ İşlem gir</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        <form className="flex flex-wrap items-end gap-2">
          <select name="tur" defaultValue={sp.tur ?? ""} className={`${selectCls} w-48`}>
            <option value="">Tüm türler</option>
            {Object.entries(TXN_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" name="bas" defaultValue={sp.bas} className={`${inputCls} w-40`} />
          <input type="date" name="bit" defaultValue={sp.bit} className={`${inputCls} w-40`} />
          <input name="q" defaultValue={sp.q} placeholder="Açıklama, belge, cari, no" className={`${inputCls} w-56`} />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="iptal" value="1" defaultChecked={sp.iptal === "1"} /> İptalleri göster</label>
          <button className={btnSecondary}>Filtrele</button>
        </form>
        <Table head={["No", "Tarih", "Tür", "Açıklama", "Cari / hesap", "Tutar", ""]} min={980}>
          {rows.map((r) => (
            <tr key={r.id} className={r.voided_at ? "opacity-50 line-through" : ""}>
              <td className={`${td} num text-muted`}>{r.no}</td>
              <td className={`${td} whitespace-nowrap`}>{formatDate(r.txn_date)}</td>
              <td className={td}><Chip tone={r.kind === "collection" ? "green" : r.kind === "payment" || r.kind === "expense" ? "red" : "blue"}>{TXN_KIND[r.kind] ?? r.kind}</Chip></td>
              <td className={td}>{r.description ?? "—"}{r.doc_no && <span className="block text-xs text-muted">{r.doc_no}</span>}{r.fin_categories && <span className="block text-xs text-muted">{r.fin_categories.name}</span>}{r.voided_at && <span className="block text-xs text-bad no-underline">İptal: {r.void_reason}</span>}</td>
              <td className={td}>
                {r.fin_parties && <Link href={`/finans/cariler/${r.fin_parties.id}`} className="block text-brand-700">{r.fin_parties.name}</Link>}
                {r.fin_accounts && <Link href={`/finans/hesap/${r.fin_accounts.id}`} className="block text-xs text-muted">{r.fin_accounts.name}</Link>}
              </td>
              <td className={tdNum}>{fmt(r.amount, r.currency)}</td>
              <td className={`${td} text-right`}>
                {canVoid && !r.voided_at && (
                  <form action={voidTxn} className="inline">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="reason" value="İşlem defterinden iptal" />
                    <ConfirmSubmit label="İptal" question="İptal edilsin mi?" />
                  </form>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} />}
        </Table>
      </div>
    </>
  );
}
