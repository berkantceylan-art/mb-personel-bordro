import { redirect } from "next/navigation";
import { PrintShell, PeriodTools, pcell, pdate, pmoney, pnum } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { VOUCHER_KIND, bal, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type Row = { year: number; no: number; journal_no: number | null; date: string; kind: string; doc_no: string | null; description: string | null; code: string; account: string; debit: number; credit: number };
type Res = { code: string; name: string; opening: number; rows: Row[] };

/** Muavin defter / hesap ekstresi çıktısı. ?hesap=120.0001 (birden çok: virgülle) */
export default async function LedgerPrint({ searchParams }: { searchParams: Promise<{ hesap?: string; bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const codes = (sp.hesap ?? "").split(",").map((x) => x.trim()).filter((x) => /^[0-9][0-9A-Za-z.]*$/.test(x)).slice(0, 50);
  const supabase = await createClient();
  const results = await Promise.all(codes.map(async (c) => (await supabase.rpc("gl_ledger", { p_code: c, p_from: from, p_to: to })).data as Res | null));
  const list = results.filter(Boolean) as Res[];
  return (
    <PrintShell title="MUAVİN DEFTER" sub={`${pdate(from)} – ${pdate(to)}`} back={`/muhasebe/kebir?hesap=${encodeURIComponent(codes[0] ?? "")}&bas=${from}&bit=${to}`}
      tools={<><PeriodTools from={from} to={to} extra={{ hesap: sp.hesap }} /><form className="flex items-center gap-1"><input type="hidden" name="bas" value={from} /><input type="hidden" name="bit" value={to} /><input name="hesap" defaultValue={sp.hesap ?? ""} placeholder="120, 320.0001" className="h-9 w-48 rounded border border-[#D5DEE8] px-2" /><button className="h-9 px-3 rounded border border-[#D5DEE8] font-semibold">Hesap</button></form></>}>
      {!codes.length && <p className="print:hidden">Hesap kodu girin (birden çok hesap için virgülle ayırın).</p>}
      {list.map((r, idx) => {
        let run = Number(r.opening);
        const d = r.rows.reduce((x, y) => x + Number(y.debit), 0);
        const c = r.rows.reduce((x, y) => x + Number(y.credit), 0);
        return (
          <section key={r.code} className={`flex flex-col gap-1 ${idx > 0 ? "break-before-page print:mt-0 mt-6" : ""}`}>
            <div className="font-bold text-[12px] border-b border-black pb-0.5">{r.code} · {r.name}</div>
            <table className="w-full border-collapse">
              <thead><tr className="bg-[#EEF2F6]"><th className={`${pcell} text-left w-[18mm]`}>Tarih</th><th className={`${pcell} text-left w-[18mm]`}>Fiş</th><th className={`${pcell} text-left`}>Açıklama</th><th className={`${pcell} text-left w-[22mm]`}>Belge</th><th className={`${pcell} text-right w-[24mm]`}>Borç</th><th className={`${pcell} text-right w-[24mm]`}>Alacak</th><th className={`${pcell} text-right w-[28mm]`}>Bakiye</th></tr></thead>
              <tbody>
                <tr className="font-semibold"><td className={pcell} colSpan={6}>Devir ({pdate(from)} öncesi)</td><td className={pnum}>{bal(run)}</td></tr>
                {r.rows.map((x, i) => {
                  run += Number(x.debit) - Number(x.credit);
                  return (
                    <tr key={i}>
                      <td className={pcell}>{pdate(x.date)}</td>
                      <td className={`${pcell} tabular-nums`}>{x.year}/{x.no}<div className="text-[9px]">{VOUCHER_KIND[x.kind] ?? ""}</div></td>
                      <td className={pcell}>{x.code !== r.code ? <span className="tabular-nums">{x.code} · </span> : null}{x.description}</td>
                      <td className={pcell}>{x.doc_no}</td>
                      <td className={pnum}>{pmoney(x.debit)}</td><td className={pnum}>{pmoney(x.credit)}</td><td className={pnum}>{bal(run)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="font-bold bg-[#EEF2F6]"><td className={pcell} colSpan={4}>Dönem toplamı</td><td className={pnum}>{pmoney(d)}</td><td className={pnum}>{pmoney(c)}</td><td className={pnum}>{bal(run)}</td></tr></tfoot>
            </table>
          </section>
        );
      })}
    </PrintShell>
  );
}
