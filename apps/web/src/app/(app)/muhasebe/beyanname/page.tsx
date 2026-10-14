import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, Notice, Tabs, btnPrimary, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glPayrollAccrual, glVatClose } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type VatLine = { direction: "sale" | "purchase"; type: "invoice" | "return"; vat_rate: number; export: boolean; exemption: string | null; withholding_code: string | null; invoices: number; base: number; vat: number; withholding: number };
type Vat = { lines: VatLine[]; gl: { v190_open: number; v191: number; v391: number; v191_bal: number; v391_bal: number; v190_bal: number }; closed: { id: string; no: number; year: number } | null };
type BaBs = { limit: number; ba: Array<{ party_id: string; party: string; tax_no: string | null; country: string | null; docs: number; amount: number }>; bs: BaBs["ba"] };
type Pay = { people: number; days: number; gross: number; income_tax: number; stamp_tax: number; sgk_employee: number; unemployment_employee: number; employer_share: number; employer_cost: number; net: number; bes: number; garnishment: number; net_to_bank: number; accrual: { id: string; no: number; year: number } | null };

/** Beyanname hazırlık: KDV, Ba-Bs, muhtasar ve prim hizmet */
export default async function TaxPrep({ searchParams }: { searchParams: Promise<{ ay?: string; sekme?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : prev;
  const tab = ["kdv", "babs", "muhtasar"].includes(sp.sekme ?? "") ? sp.sekme! : "kdv";
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = await createClient();
  const res = tab === "kdv" ? await supabase.rpc("gl_vat_report", { p_from: from, p_to: to }) : tab === "babs" ? await supabase.rpc("gl_babs", { p_month: month }) : await supabase.rpc("gl_payroll_report", { p_period: month });
  const err = res.error;
  const link = (p: Record<string, string>) => `/muhasebe/beyanname?${new URLSearchParams({ ay: month, sekme: tab, ...p })}`;
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const m = (v: number) => fmt(v);
  return (
    <>
      <PageHeader title="Beyanname hazırlık" subtitle={`${month} dönemi · tutarlar ERP kayıtlarından; beyanname mali müşavirin kendi şifresiyle verilir`} actions={<Link href="/muhasebe/donem" className="text-sm font-semibold text-brand-700">Dönem işlemleri</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs active={link({ sekme: tab })} items={[[link({ sekme: "kdv" }), "KDV"], [link({ sekme: "babs" }), "Ba-Bs"], [link({ sekme: "muhtasar" }), "Muhtasar ve prim hizmet"]]} />
          <form className="ml-auto flex gap-2"><input type="hidden" name="sekme" value={tab} /><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button></form>
        </div>
        {err && <Notice tone="bad">{/function|does not exist|schema cache/.test(err.message) ? "Supabase'de 20270208000000_gl_close.sql çalıştırılmalı." : glError(err.message)}</Notice>}

        {tab === "kdv" && res.data && (() => {
          const v = res.data as Vat;
          const sale = v.lines.filter((l) => l.direction === "sale");
          const pur = v.lines.filter((l) => l.direction === "purchase");
          const sum = (a: VatLine[], k: "base" | "vat" | "withholding", sign = (l: VatLine) => (l.type === "return" ? -1 : 1)) => a.reduce((x, l) => x + sign(l) * Number(l[k]), 0);
          const out = sum(sale, "vat") - sum(sale, "withholding");
          const inn = sum(pur, "vat");
          const pay = out - inn - Number(v.gl.v190_open);
          const T = ({ rows }: { rows: VatLine[] }) => (
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-xs text-muted"><th className={th}>Tür</th><th className={th}>Oran</th><th className={th}>Not</th><th className={`${th} text-right`}>Fatura</th><th className={`${th} text-right`}>Matrah</th><th className={`${th} text-right`}>KDV</th><th className={`${th} text-right`}>Tevkifat</th></tr></thead>
              <tbody>{rows.map((l, i) => (
                <tr key={i}><td className={td}>{l.type === "return" ? "İade" : "Fatura"}</td><td className={td}>%{l.vat_rate}</td>
                  <td className={`${td} text-xs`}>{[l.export && "İhracat", l.exemption && `istisna ${l.exemption}`, l.withholding_code && `tevkifat ${l.withholding_code}`].filter(Boolean).join(" · ")}</td>
                  <td className={tdNum}>{l.invoices}</td><td className={tdNum}>{m(l.base)}</td><td className={tdNum}>{m(l.vat)}</td><td className={tdNum}>{l.withholding ? m(l.withholding) : ""}</td></tr>
              ))}{!rows.length && <tr><td colSpan={7} className="py-6 text-center text-muted">Fatura yok.</td></tr>}</tbody>
            </table></div>
          );
          return (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPI label="Hesaplanan KDV (tevkifat sonrası)" value={m(out)} />
                <KPI label="İndirilecek KDV" value={m(inn)} />
                <KPI label="Önceki aydan devreden" value={m(Number(v.gl.v190_open))} />
                <KPI label={pay >= 0 ? "Ödenecek KDV (tahmini)" : "Sonraki aya devreden"} value={m(Math.abs(pay))} tone={pay > 0 ? "bad" : "ok"} />
              </div>
              <Card title="Satışlar (KDV 1: teslim ve hizmetler)"><T rows={sale} /></Card>
              <Card title="Alışlar (indirilecek KDV)"><T rows={pur} /></Card>
              <Card title="Muhasebe karşılaştırması">
                <div className="grid gap-2 text-sm md:grid-cols-3">
                  <span>391 bu ay: <b className="num">{m(v.gl.v391)}</b> · faturalardan: <b className="num">{m(sum(sale, "vat"))}</b></span>
                  <span>191 bu ay: <b className="num">{m(v.gl.v191)}</b> · faturalardan: <b className="num">{m(inn)}</b></span>
                  <span>Ay sonu bakiyeler: 190 <b className="num">{m(v.gl.v190_bal)}</b> · 191 <b className="num">{m(v.gl.v191_bal)}</b> · 391 <b className="num">{m(v.gl.v391_bal)}</b></span>
                </div>
                {(v.gl.v391 !== sum(sale, "vat") || v.gl.v191 !== inn) && <Notice tone="warn">Faturalardaki KDV ile muhasebe hesapları farklı: masraf fişlerinden gelen KDV, eşleştirme bekleyen kayıtlar ya da elle fiş olabilir.</Notice>}
                {v.closed ? <p className="text-sm">KDV mahsubu yapıldı: <Link href={`/muhasebe/fisler/${v.closed.id}`} className="font-semibold text-brand-700">fiş {v.closed.year}/{v.closed.no}</Link></p>
                  : canEdit && <form action={glVatClose}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>{month} KDV mahsup fişini oluştur</PendingSubmit></form>}
              </Card>
            </>
          );
        })()}

        {tab === "babs" && res.data && (() => {
          const b = res.data as BaBs;
          const T = ({ rows, title }: { rows: BaBs["ba"]; title: string }) => (
            <Card title={`${title} · ${rows.length} cari`}>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-xs text-muted"><th className={th}>Cari</th><th className={th}>VKN / TCKN</th><th className={th}>Ülke</th><th className={`${th} text-right`}>Belge sayısı</th><th className={`${th} text-right`}>KDV hariç tutar</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.party_id}><td className={td}><Link href={`/finans/cariler/${r.party_id}`} className="text-brand-700">{r.party}</Link></td><td className={`${td} num ${r.tax_no ? "" : "text-bad"}`}>{r.tax_no ?? "eksik"}</td><td className={td}>{r.country}</td><td className={tdNum}>{r.docs}</td><td className={tdNum}>{m(r.amount)}</td></tr>)}
                  {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted">Sınırı aşan cari yok.</td></tr>}</tbody>
              </table></div>
            </Card>
          );
          return (<><Notice tone="info">Sınır: {m(b.limit)} (KDV hariç, aynı kişiden aylık toplam). İade faturaları ve fişli cariler dahil değildir.</Notice><T rows={b.ba} title="Form Ba · mal ve hizmet alımları" /><T rows={b.bs} title="Form Bs · mal ve hizmet satışları" /></>);
        })()}

        {tab === "muhtasar" && res.data && (() => {
          const p = res.data as Pay;
          if (!p.people) return <Notice tone="info">{month} dönemi bordrosu hesaplanmamış.</Notice>;
          return (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPI label="Personel / gün" value={`${p.people} / ${p.days}`} />
                <KPI label="Brüt ücret (matrah)" value={m(p.gross)} />
                <KPI label="Gelir vergisi + damga" value={m(Number(p.income_tax) + Number(p.stamp_tax))} sub={`GV ${m(p.income_tax)} · DV ${m(p.stamp_tax)}`} />
                <KPI label="SGK primleri (toplam)" value={m(Number(p.sgk_employee) + Number(p.unemployment_employee) + Number(p.employer_share))} sub={`işçi ${m(Number(p.sgk_employee) + Number(p.unemployment_employee))} · işveren ${m(p.employer_share)}`} />
              </div>
              <Card title="Bordro tahakkuku">
                <div className="grid gap-1 text-sm md:grid-cols-2">
                  <span>Net ücret: <b className="num">{m(p.net)}</b></span><span>BES + icra kesintisi: <b className="num">{m(Number(p.bes) + Number(p.garnishment))}</b></span>
                  <span>Bankaya ödenecek: <b className="num">{m(p.net_to_bank)}</b></span><span>İşveren maliyeti: <b className="num">{m(p.employer_cost)}</b></span>
                </div>
                <p className="text-xs text-muted">Kira ve serbest meslek stopajı ERP&apos;de ayrı izlenmediği için muhtasara mali müşavir ekler.</p>
                {p.accrual ? <p className="text-sm">Tahakkuk fişi: <Link href={`/muhasebe/fisler/${p.accrual.id}`} className="font-semibold text-brand-700">{p.accrual.year}/{p.accrual.no}</Link></p>
                  : canEdit && <form action={glPayrollAccrual} className="flex items-end gap-2"><input type="hidden" name="period" value={month} /><label className="flex flex-col gap-1 text-xs font-semibold text-muted">Gider hesabı<input name="expense" defaultValue="770" className={`${inputCls} w-28`} /></label><PendingSubmit className={btnPrimary}>Tahakkuk fişini oluştur</PendingSubmit></form>}
              </Card>
            </>
          );
        })()}
        <p className="text-xs text-muted">Dönem: {formatDate(from)} – {formatDate(to)}</p>
      </div>
    </>
  );
}
