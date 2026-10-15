import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { PeriodForm } from "@/components/ledger/PeriodForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { glError, period } from "@/lib/gl";
import { CF_SECTIONS, type CashFlow } from "@/lib/gl-reports";

export const dynamic = "force-dynamic";

const m = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Nakit akış tablosu (doğrudan yöntem, hazır değerler 10x) */
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const { from, to } = period(await searchParams);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_cash_flow", { p_from: from, p_to: to });
  const cf = data as CashFlow | null;
  const diff = cf ? cf.opening + cf.operating + cf.investing + cf.financing - cf.closing : 0;
  const line = (label: string, v: number, strong = false) => <div className={`flex justify-between py-1 ${strong ? "font-bold border-t border-line mt-1 pt-2" : ""}`}><span>{label}</span><span className={`num ${v < 0 ? "text-bad" : ""}`}>{m(v)}</span></div>;
  return (
    <>
      <PageHeader title="Nakit akış tablosu" subtitle={`${formatDate(from)} – ${formatDate(to)} · kasa, banka ve çeklerdeki giriş-çıkışlar karşı hesaplarına göre`} actions={<Link href="/muhasebe/karsilastirma" className="text-sm font-semibold text-brand-700">Karşılaştırmalı raporlar</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270222000000_gl_package.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <PeriodForm from={from} to={to} />
        {cf && (
          <section className="bg-white border border-line rounded-[14px] p-5 text-sm max-w-3xl">
            {line("Dönem başı hazır değerler (kasa, banka, çek)", cf.opening, true)}
            {CF_SECTIONS.map(([k, t]) => (
              <div key={k} className="pt-2">
                <div className="flex justify-between font-semibold"><span>{t}</span><span className={`num ${cf[k] < 0 ? "text-bad" : ""}`}>{m(cf[k])}</span></div>
                {cf.rows.filter((r) => r.section === k).map((r) => (
                  <div key={r.code} className="flex justify-between pl-5 text-[13px]"><Link href={`/muhasebe/kebir?hesap=${r.code}&bas=${from}&bit=${to}`} className="hover:text-brand-700"><span className="num text-muted mr-2">{r.code}</span>{r.name}</Link><span className={`num ${r.amount < 0 ? "text-bad" : ""}`}>{m(r.amount)}</span></div>
                ))}
              </div>
            ))}
            {line("Nakitteki net değişim", cf.operating + cf.investing + cf.financing, true)}
            {line("Dönem sonu hazır değerler", cf.closing, true)}
            {diff !== 0 && <p className="text-xs text-bad mt-2">Fark {m(diff)}: dönem içinde açılış / kapanış dışı dengesiz fiş olabilir.</p>}
            <p className="text-xs text-muted mt-3">Artı tutar nakit girişi, eksi tutar çıkıştır. Kasa ile banka arası virmanlar tabloya girmez. Yatırım: duran varlıklar ve menkul kıymetler; finansman: krediler, sermaye, ortaklarla işlemler.</p>
          </section>
        )}
      </div>
    </>
  );
}
