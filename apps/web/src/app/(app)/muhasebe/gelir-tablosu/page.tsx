import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { PeriodForm } from "@/components/ledger/PeriodForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { glError, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; amount: number; from_cost: boolean };
const m = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Tek Düzen gelir tablosu kalemleri: [başlık, hesap grubu (2 hane)]
const SECTIONS: Array<[string, string]> = [
  ["A. BRÜT SATIŞLAR", "60"], ["B. SATIŞ İNDİRİMLERİ (-)", "61"], ["D. SATIŞLARIN MALİYETİ (-)", "62"], ["E. FAALİYET GİDERLERİ (-)", "63"],
  ["F. DİĞER FAALİYETLERDEN OLAĞAN GELİR VE KÂRLAR", "64"], ["G. DİĞER FAALİYETLERDEN OLAĞAN GİDER VE ZARARLAR (-)", "65"], ["H. FİNANSMAN GİDERLERİ (-)", "66"],
  ["J. OLAĞANDIŞI GELİR VE KÂRLAR", "67"], ["K. OLAĞANDIŞI GİDER VE ZARARLAR (-)", "68"],
];

/** Gelir tablosu */
export default async function IncomeStatement({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_income_statement", { p_from: from, p_to: to });
  const rows = (data ?? []) as R[];
  const g = (p: string) => rows.filter((r) => r.code.startsWith(p)).reduce((x, r) => x + Number(r.amount), 0);
  const net = g("60") + g("61");
  const gross = net + g("62");
  const op = gross + g("63");
  const ord = op + g("64") + g("65") + g("66");
  const pre = ord + g("67") + g("68");
  const tax = g("691");
  const line = (label: string, v: number, strong = false) => <div className={`flex justify-between py-1 ${strong ? "font-bold border-t border-line mt-1 pt-2" : ""}`}><span>{label}</span><span className={`num ${v < 0 ? "text-bad" : ""}`}>{m(v)}</span></div>;
  const cost = rows.some((r) => r.from_cost);
  return (
    <>
      <PageHeader title="Gelir tablosu" subtitle={`${formatDate(from)} – ${formatDate(to)}`} actions={<Link href="/muhasebe/bilanco" className="text-sm font-semibold text-brand-700">Bilanço</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270207000000_gl_reports.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <PeriodForm from={from} to={to} />
        {cost && <Notice tone="info">7/A gider hesapları (770, 760, 780 …) dönem sonunda 6xx hesaplarına yansıtılmadığı için ilgili satıra doğrudan alındı (işaretli satırlar).</Notice>}
        <section className="bg-white border border-line rounded-[14px] p-5 text-sm max-w-3xl">
          {SECTIONS.map(([t, p], i) => {
            const inS = rows.filter((r) => r.code.startsWith(p));
            return (
              <div key={p}>
                <div className="flex justify-between font-semibold pt-2"><span>{t}</span><span className="num">{m(g(p))}</span></div>
                {inS.map((r) => <div key={r.code + r.from_cost} className="flex justify-between pl-5 text-[13px]"><Link href={`/muhasebe/kebir?hesap=${r.from_cost ? ({ "620": "710", "622": "740", "630": "750", "631": "760", "632": "770", "660": "780" } as Record<string, string>)[r.code] ?? r.code : r.code}&bas=${from}&bit=${to}`} className="hover:text-brand-700"><span className="num text-muted mr-2">{r.code}</span>{r.name}{r.from_cost && " · 7/A'dan"}</Link><span className="num">{m(Number(r.amount))}</span></div>)}
                {i === 1 && line("C. NET SATIŞLAR", net, true)}
                {i === 2 && line("BRÜT SATIŞ KÂRI VEYA ZARARI", gross, true)}
                {i === 3 && line("FAALİYET KÂRI VEYA ZARARI", op, true)}
                {i === 6 && line("OLAĞAN KÂR VEYA ZARAR", ord, true)}
                {i === 8 && line("DÖNEM KÂRI VEYA ZARARI", pre, true)}
              </div>
            );
          })}
          {line("L. DÖNEM KÂRI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)", tax)}
          <div className="flex justify-between font-bold text-base border-t-2 border-ink pt-2 mt-2"><span>DÖNEM NET KÂRI VEYA ZARARI</span><span className={`num ${pre + tax < 0 ? "text-bad" : ""}`}>{m(pre + tax)}</span></div>
        </section>
      </div>
    </>
  );
}
