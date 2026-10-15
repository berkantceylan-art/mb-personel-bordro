import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, Notice, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { DOC_TYPE, VOUCHER_KIND, VOUCHER_SOURCE, VOUCHER_STATUS, amt } from "@/lib/gl";
import { glApprove, glCancelVoucher, glUnapprove } from "@/lib/gl-actions";
import { VoucherEditor } from "../VoucherEditor";

export const dynamic = "force-dynamic";

type Line = { id: number; sort: number; debit: number; credit: number; currency: string; fx_amount: number | null; rate: number | null; description: string | null; gl_accounts: { code: string; name: string } | null; fin_parties: { id: string; name: string } | null };

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ duzenle?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: v } = await supabase.from("gl_vouchers").select("*").eq("id", id).maybeSingle();
  if (!v) notFound();
  const [{ data: ls }, { data: txn }, { data: accs }] = await Promise.all([
    supabase.from("gl_lines").select("id, sort, debit, credit, currency, fx_amount, rate, description, gl_accounts(code, name), fin_parties(id, name)").eq("voucher_id", id).order("sort"),
    v.fin_txn_id ? supabase.from("fin_txns").select("id, no, kind, ref_type, ref_id").eq("id", v.fin_txn_id).maybeSingle() : Promise.resolve({ data: null }),
    sp.duzenle ? supabase.from("gl_accounts").select("code, name").eq("postable", true).eq("is_active", true).order("code").limit(5000) : Promise.resolve({ data: [] }),
  ]);
  const lines = (ls ?? []) as unknown as Line[];
  const d = lines.reduce((x, l) => x + Number(l.debit), 0);
  const c = lines.reduce((x, l) => x + Number(l.credit), 0);
  const editable = (s.modules.ledger ?? 0) >= 2 && v.source !== "auto" && v.status !== "cancelled";
  const t = txn as { id: string; no: number; kind: string; ref_type: string | null; ref_id: string | null } | null;
  const src = t ? (t.ref_type === "invoice" && t.ref_id ? `/fatura/${t.ref_id}` : `/finans/islemler?q=${t.no}`) : null;
  return (
    <>
      <PageHeader title={`Fiş ${v.year}/${v.no}`} subtitle={`${VOUCHER_KIND[v.kind] ?? v.kind} fişi · ${VOUCHER_SOURCE[v.source] ?? v.source} · ${formatDate(v.voucher_date)}`} actions={<Link href="/muhasebe/fisler" className="text-sm font-semibold text-brand-700">Fişler</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Chip tone={VOUCHER_STATUS[v.status]?.[1] ?? "gray"}>{VOUCHER_STATUS[v.status]?.[0] ?? v.status}</Chip>
          {v.journal_no && <span>Yevmiye madde no: <b>{v.journal_no}</b></span>}
          {v.doc_no && <span>Belge: <b>{DOC_TYPE[v.doc_type ?? "other"] ?? ""} {v.doc_no}</b>{v.doc_date ? ` · ${formatDate(v.doc_date)}` : ""}</span>}
          {src && <Link href={src} className="font-semibold text-brand-700">ERP kaydına git ↗</Link>}
          <Link href={`/yazdir/muhasebe/fis?id=${v.id}`} target="_blank" className="font-semibold text-brand-700">🖨 Yazdır</Link>
          {v.reversal_of && <Link href={`/muhasebe/fisler/${v.reversal_of}`} className="font-semibold text-brand-700">Ters kaydı yapılan fiş</Link>}
        </div>
        {v.description && <p className="text-sm">{v.description}</p>}
        {v.issues && <Notice tone={v.status === "pending" ? "bad" : "info"}>{v.issues}</Notice>}
        {sp.duzenle && editable ? (
          <Card title="Fişi düzenle">
            <VoucherEditor accounts={(accs ?? []) as Array<{ code: string; name: string }>} initial={{ id: v.id, date: v.voucher_date, kind: v.kind, description: v.description ?? "", doc_type: v.doc_type ?? "other", doc_no: v.doc_no ?? "", doc_date: v.doc_date ?? "", lines: lines.map((l) => ({ code: l.gl_accounts?.code ?? "", debit: amt(l.debit), credit: amt(l.credit), description: l.description ?? "" })) }} />
          </Card>
        ) : (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-xs text-muted"><th className={th}>Hesap</th><th className={th}>Açıklama</th><th className={`${th} text-right`}>Borç</th><th className={`${th} text-right`}>Alacak</th><th className={`${th} text-right`}>Döviz</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className={td}><Link href={`/muhasebe/kebir?hesap=${encodeURIComponent(l.gl_accounts?.code ?? "")}`} className="num font-semibold text-brand-700">{l.gl_accounts?.code}</Link> {l.gl_accounts?.name}</td>
                    <td className={`${td} text-xs`}>{l.description}{l.fin_parties && <span className="block text-muted">Cari: {l.fin_parties.name}</span>}</td>
                    <td className={tdNum}>{amt(l.debit)}</td>
                    <td className={tdNum}>{amt(l.credit)}</td>
                    <td className={`${tdNum} text-xs text-muted`}>{l.fx_amount ? `${fmt(Math.abs(l.fx_amount), l.currency)} · ${Number(l.rate).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}` : ""}</td>
                  </tr>
                ))}
                {!lines.length && <tr><td colSpan={5} className="py-8 text-center text-muted">Satır yok.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td className={td} colSpan={2}>Toplam</td><td className={tdNum}>{amt(d)}</td><td className={tdNum}>{amt(c)}</td><td className={td} /></tr></tfoot>
            </table>
          </section>
        )}
        {editable && !sp.duzenle && (
          <div className="flex gap-4 text-sm">
            <Link href={`/muhasebe/fisler/${v.id}?duzenle=1`} className="font-semibold text-brand-700">Düzenle</Link>
            <form action={glCancelVoucher}><input type="hidden" name="id" value={v.id} /><PendingSubmit className="font-semibold text-bad">Fişi iptal et</PendingSubmit></form>
          </div>
        )}
        {(s.modules.ledger ?? 0) >= 3 && v.status === "draft" && <form action={glApprove}><input type="hidden" name="ids" value={v.id} /><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Fişi onayla</PendingSubmit></form>}
        {(s.modules.ledger ?? 0) >= 3 && v.status === "posted" && !["closing", "opening", "reversal"].includes(v.source) && <form action={glUnapprove}><input type="hidden" name="id" value={v.id} /><PendingSubmit className="text-sm font-semibold text-brand-700">Onayı geri al</PendingSubmit></form>}
        {v.source === "auto" && <p className="text-xs text-muted">Otomatik fiş ERP kaydından gelir. Değiştirmek için kaynağı (fatura, ödeme, banka işlemi) düzeltin; ERP kaydı iptal edilince fiş de iptal olur, kilitli dönemde ters kayıt atılır.</p>}
      </div>
    </>
  );
}
