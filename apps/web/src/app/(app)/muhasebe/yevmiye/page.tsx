import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { PeriodForm } from "@/components/ledger/PeriodForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { DOC_TYPE, VOUCHER_KIND, amt, glError, period } from "@/lib/gl";
import { glRenumber } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type J = { id: string; year: number; no: number; jn: number | null; date: string; kind: string; description: string | null; doc_type: string | null; doc_no: string | null; doc_date: string | null; lines: Array<{ code: string; name: string; debit: number; credit: number; description: string | null }> };

/** Yevmiye defteri */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_journal", { p_from: from, p_to: to, p_limit: 3000 });
  const rows = (data ?? []) as J[];
  const unnumbered = rows.filter((r) => !r.jn).length;
  let td_ = 0, tc_ = 0;
  return (
    <>
      <PageHeader title="Yevmiye defteri" subtitle={`${formatDate(from)} – ${formatDate(to)} · madde madde, tarih sırasıyla`} actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270207000000_gl_reports.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <PeriodForm from={from} to={to} excel={`/muhasebe/aktar/excel?tur=fis&bas=${from}&bit=${to}`} />
        {unnumbered > 0 && (s.modules.ledger ?? 0) >= 3 && (
          <Notice tone="warn">{unnumbered} fişe henüz yevmiye madde numarası verilmedi. <form action={glRenumber} className="inline"><input type="hidden" name="year" value={from.slice(0, 4)} /><PendingSubmit className="font-semibold underline">{from.slice(0, 4)} yılını numaralandır</PendingSubmit></form> (tarih sırasıyla 1&apos;den başlar; açılış fişi ilk sırada).</Notice>
        )}
        {rows.length >= 3000 && <Notice tone="info">İlk 3.000 madde gösteriliyor; tamamı için Excel&apos;i indirin ya da dönemi daraltın.</Notice>}
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Madde</th><th className={th}>Tarih</th><th className={th}>Hesap</th><th className={th}>Açıklama</th><th className={`${th} text-right`}>Borç</th><th className={`${th} text-right`}>Alacak</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="bg-[#F6F8FA]">
                    <td className={`${td} num font-semibold`}><Link href={`/muhasebe/fisler/${r.id}`} className="text-brand-700">{r.jn ?? "—"}</Link></td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(r.date)}</td>
                    <td className={td} colSpan={4}><b>{VOUCHER_KIND[r.kind] ?? r.kind}</b> · fiş {r.year}/{r.no}{r.doc_no ? ` · ${DOC_TYPE[r.doc_type ?? "other"] ?? ""} ${r.doc_no}${r.doc_date ? ` (${formatDate(r.doc_date)})` : ""}` : ""}{r.description ? ` · ${r.description}` : ""}</td>
                  </tr>
                  {(r.lines ?? []).map((l, i) => { td_ += Number(l.debit); tc_ += Number(l.credit); return (
                    <tr key={r.id + i}>
                      <td className={td} /><td className={td} />
                      <td className={`${td} num ${l.credit ? "pl-10" : ""}`}>{l.code} <span className="font-sans">{l.name}</span></td>
                      <td className={`${td} text-xs text-muted`}>{l.description}</td>
                      <td className={tdNum}>{amt(l.debit)}</td><td className={tdNum}>{amt(l.credit)}</td>
                    </tr>
                  ); })}
                </Fragment>
              ))}
              {!rows.length && <tr><td colSpan={6} className="py-10 text-center text-muted">Bu dönemde kayıtlı fiş yok.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="font-bold border-t-2 border-line"><td className={td} colSpan={4}>Toplam</td><td className={tdNum}>{amt(td_)}</td><td className={tdNum}>{amt(tc_)}</td></tr></tfoot>}
          </table>
        </section>
      </div>
    </>
  );
}
