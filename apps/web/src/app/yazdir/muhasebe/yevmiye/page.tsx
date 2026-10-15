import { Fragment } from "react";
import { redirect } from "next/navigation";
import { PrintShell, PeriodTools, pcell, pdate, pmoney, pnum } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DOC_TYPE, VOUCHER_KIND, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type J = { id: string; year: number; no: number; jn: number | null; date: string; kind: string; description: string | null; doc_type: string | null; doc_no: string | null; doc_date: string | null; lines: Array<{ code: string; name: string; debit: number; credit: number; description: string | null }> };

/** Yevmiye defteri çıktısı */
export default async function JournalPrint({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const supabase = await createClient();
  const { data } = await supabase.rpc("gl_journal", { p_from: from, p_to: to, p_limit: 5000 });
  const rows = (data ?? []) as J[];
  let d = 0, c = 0;
  return (
    <PrintShell title="YEVMİYE DEFTERİ" sub={`${pdate(from)} – ${pdate(to)} · ${rows.length} madde`} back={`/muhasebe/yevmiye?bas=${from}&bit=${to}`} tools={<PeriodTools from={from} to={to} />}>
      {rows.length >= 5000 && <p className="print:hidden text-[#B45309]">İlk 5.000 madde gösteriliyor; dönemi daraltın.</p>}
      <table className="w-full border-collapse">
        <thead><tr className="bg-[#EEF2F6]"><th className={`${pcell} text-left w-[14mm]`}>Madde</th><th className={`${pcell} text-left w-[18mm]`}>Tarih</th><th className={`${pcell} text-left`}>Hesap / açıklama</th><th className={`${pcell} text-right w-[26mm]`}>Borç</th><th className={`${pcell} text-right w-[26mm]`}>Alacak</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr className="bg-[#F6F8FA]">
                <td className={`${pcell} font-bold tabular-nums`}>{r.jn ?? "—"}</td>
                <td className={pcell}>{pdate(r.date)}</td>
                <td className={pcell} colSpan={3}><b>{VOUCHER_KIND[r.kind] ?? r.kind}</b> · fiş {r.year}/{r.no}{r.doc_no ? ` · ${DOC_TYPE[r.doc_type ?? "other"] ?? ""} ${r.doc_no}${r.doc_date ? ` (${pdate(r.doc_date)})` : ""}` : ""}{r.description ? ` · ${r.description}` : ""}</td>
              </tr>
              {(r.lines ?? []).map((l, i) => { d += Number(l.debit); c += Number(l.credit); return (
                <tr key={i}>
                  <td className={pcell} /><td className={pcell} />
                  <td className={pcell} style={{ paddingLeft: l.credit ? 28 : 6 }}><span className="tabular-nums">{l.code}</span> {l.name}{l.description ? <span className="text-[9px] text-[#555]"> · {l.description}</span> : null}</td>
                  <td className={pnum}>{pmoney(l.debit)}</td><td className={pnum}>{pmoney(l.credit)}</td>
                </tr>
              ); })}
            </Fragment>
          ))}
        </tbody>
        <tfoot><tr className="font-bold bg-[#EEF2F6]"><td className={pcell} colSpan={3}>Toplam</td><td className={pnum}>{pmoney(d)}</td><td className={pnum}>{pmoney(c)}</td></tr></tfoot>
      </table>
      {!rows.length && <p>Bu dönemde kayıtlı fiş yok.</p>}
    </PrintShell>
  );
}
