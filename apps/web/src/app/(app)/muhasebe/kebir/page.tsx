import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page, td, tdNum, th } from "@/components/erp";
import { PeriodForm } from "@/components/ledger/PeriodForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { VOUCHER_KIND, amt, bal, glError, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type Row = { voucher_id: string; year: number; no: number; journal_no: number | null; date: string; kind: string; doc_no: string | null; description: string | null; code: string; account: string; debit: number; credit: number };
type Res = { code: string; name: string; normal_side: string; opening: number; rows: Row[] };

/** Muavin defter / defter-i kebir: hesap ekstresi */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ hesap?: string; bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const code = (sp.hesap ?? "").trim();
  const supabase = await createClient();
  const { data: accs } = await supabase.from("gl_accounts").select("code, name").order("code").limit(5000);
  const { data, error } = code ? await supabase.rpc("gl_ledger", { p_code: code, p_from: from, p_to: to }) : { data: null, error: null };
  const r = data as Res | null;
  let run = Number(r?.opening ?? 0);
  const d = (r?.rows ?? []).reduce((x, y) => x + Number(y.debit), 0);
  const c = (r?.rows ?? []).reduce((x, y) => x + Number(y.credit), 0);
  return (
    <>
      <PageHeader title={r ? `${r.code} · ${r.name}` : "Muavin / kebir"} subtitle={`Hesap ekstresi · ${formatDate(from)} – ${formatDate(to)}`} actions={<Link href="/muhasebe/mizan" className="text-sm font-semibold text-brand-700">Mizan</Link>} />
      <div className={page}>
        <datalist id="gl-all">{((accs ?? []) as Array<{ code: string; name: string }>).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
        <PeriodForm from={from} to={to} extra={{ hesap: code }} print={code ? `/yazdir/muhasebe/muavin?hesap=${encodeURIComponent(code)}&bas=${from}&bit=${to}` : undefined} excel={code ? `/muhasebe/aktar/excel?tur=kebir&hesap=${encodeURIComponent(code)}&bas=${from}&bit=${to}` : undefined}>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Hesap<input name="hesap" list="gl-all" defaultValue={code} placeholder="ör. 120 ya da 120.0001" className="h-11 w-48 rounded-[10px] border border-line bg-white px-3 text-sm num" /></label>
        </PeriodForm>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270207000000_gl_reports.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {!code && <Notice tone="info">Hesap kodu seçin. Ana hesap (ör. 120) seçilirse tüm alt hesapların hareketleri birlikte gelir.</Notice>}
        {r && (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Fiş</th><th className={th}>Hesap</th><th className={th}>Açıklama</th><th className={th}>Belge</th><th className={`${th} text-right`}>Borç</th><th className={`${th} text-right`}>Alacak</th><th className={`${th} text-right`}>Bakiye</th></tr></thead>
              <tbody>
                <tr className="bg-[#F6F8FA] font-semibold"><td className={td} colSpan={5}>Devir ({formatDate(from)} öncesi)</td><td className={tdNum} /><td className={tdNum} /><td className={tdNum}>{bal(run)}</td></tr>
                {r.rows.map((x, i) => {
                  run += Number(x.debit) - Number(x.credit);
                  return (
                    <tr key={i}>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(x.date)}</td>
                      <td className={`${td} num`}><Link href={`/muhasebe/fisler/${x.voucher_id}`} className="text-brand-700">{x.year}/{x.no}</Link><span className="block text-xs text-muted">{VOUCHER_KIND[x.kind] ?? x.kind}</span></td>
                      <td className={`${td} num text-xs`}>{x.code !== r.code ? `${x.code} ${x.account}` : ""}</td>
                      <td className={td}>{x.description}</td>
                      <td className={`${td} text-xs`}>{x.doc_no}</td>
                      <td className={tdNum}>{amt(x.debit)}</td><td className={tdNum}>{amt(x.credit)}</td><td className={`${tdNum} font-semibold`}>{bal(run)}</td>
                    </tr>
                  );
                })}
                {!r.rows.length && <tr><td colSpan={8} className="py-8 text-center text-muted">Bu dönemde hareket yok.</td></tr>}
              </tbody>
              <tfoot><tr className="font-bold border-t-2 border-line"><td className={td} colSpan={5}>Dönem toplamı</td><td className={tdNum}>{amt(d)}</td><td className={tdNum}>{amt(c)}</td><td className={tdNum}>{bal(run)}</td></tr></tfoot>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
