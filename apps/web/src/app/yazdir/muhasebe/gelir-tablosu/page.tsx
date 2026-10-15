import { redirect } from "next/navigation";
import { PrintShell, PeriodTools, pdate, pmoney } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; amount: number; from_cost: boolean };
const SECTIONS: Array<[string, string]> = [
  ["A. BRÜT SATIŞLAR", "60"], ["B. SATIŞ İNDİRİMLERİ (-)", "61"], ["D. SATIŞLARIN MALİYETİ (-)", "62"], ["E. FAALİYET GİDERLERİ (-)", "63"],
  ["F. DİĞER FAALİYETLERDEN OLAĞAN GELİR VE KÂRLAR", "64"], ["G. DİĞER FAALİYETLERDEN OLAĞAN GİDER VE ZARARLAR (-)", "65"], ["H. FİNANSMAN GİDERLERİ (-)", "66"],
  ["J. OLAĞANDIŞI GELİR VE KÂRLAR", "67"], ["K. OLAĞANDIŞI GİDER VE ZARARLAR (-)", "68"],
];
const m = (v: number) => (v < 0 ? `(${pmoney(-v) || "0,00"})` : pmoney(v) || "0,00");

/** Gelir tablosu çıktısı */
export default async function IncomePrint({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const supabase = await createClient();
  const { data } = await supabase.rpc("gl_income_statement", { p_from: from, p_to: to });
  const rows = (data ?? []) as R[];
  const g = (p: string) => rows.filter((r) => r.code.startsWith(p)).reduce((x, r) => x + Number(r.amount), 0);
  const net = g("60") + g("61"), gross = net + g("62"), op = gross + g("63"), ord = op + g("64") + g("65") + g("66"), pre = ord + g("67") + g("68"), tax = g("691");
  const total = (l: string, v: number) => <div className="flex justify-between font-bold border-t border-black mt-0.5 pt-0.5"><span>{l}</span><span className="tabular-nums">{m(v)}</span></div>;
  return (
    <PrintShell title="GELİR TABLOSU" sub={`${pdate(from)} – ${pdate(to)}`} back={`/muhasebe/gelir-tablosu?bas=${from}&bit=${to}`} tools={<PeriodTools from={from} to={to} />}>
      <div className="flex flex-col gap-0.5 text-[11px] max-w-[150mm]">
        {SECTIONS.map(([t, p], i) => (
          <div key={p}>
            <div className="flex justify-between font-semibold pt-1"><span>{t}</span><span className="tabular-nums">{m(g(p))}</span></div>
            {rows.filter((r) => r.code.startsWith(p)).map((r) => <div key={r.code + r.from_cost} className="flex justify-between pl-4"><span><span className="tabular-nums mr-1">{r.code}</span>{r.name}{r.from_cost ? " (7/A)" : ""}</span><span className="tabular-nums">{m(Number(r.amount))}</span></div>)}
            {i === 1 && total("C. NET SATIŞLAR", net)}
            {i === 2 && total("BRÜT SATIŞ KÂRI VEYA ZARARI", gross)}
            {i === 3 && total("FAALİYET KÂRI VEYA ZARARI", op)}
            {i === 6 && total("OLAĞAN KÂR VEYA ZARAR", ord)}
            {i === 8 && total("DÖNEM KÂRI VEYA ZARARI", pre)}
          </div>
        ))}
        <div className="flex justify-between pt-1"><span>L. DÖNEM KÂRI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)</span><span className="tabular-nums">{m(tax)}</span></div>
        <div className="flex justify-between font-bold text-[12px] border-t-2 border-black pt-1 mt-1"><span>DÖNEM NET KÂRI VEYA ZARARI</span><span className="tabular-nums">{m(pre + tax)}</span></div>
      </div>
    </PrintShell>
  );
}
