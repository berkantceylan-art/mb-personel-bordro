import Link from "next/link";
import { Card } from "@/components/ui";
import { KPI, Notice, btnPrimary, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { glVatClose } from "@/lib/gl-actions";
import { EXEMPTION, RpcError, type TabProps } from "./shared";

type VatLine = { direction: "sale" | "purchase"; type: "invoice" | "return"; vat_rate: number; export: boolean; exemption: string | null; withholding_code: string | null; invoices: number; base: number; vat: number; withholding: number };
type Vat = { lines: VatLine[]; gl: { v190_open: number; v191: number; v391: number; v191_bal: number; v391_bal: number; v190_bal: number }; closed: { id: string; no: number; year: number } | null };
type Refund = { export_base: number; vat_in: number; refund_now: number; refundable: number; missing_docs: number; export_invoices: number };

const m = (v: number) => fmt(v);
const sgn = (l: VatLine) => (l.type === "return" ? -1 : 1);
const sum = (a: VatLine[], k: "base" | "vat" | "withholding") => a.reduce((x, l) => x + sgn(l) * Number(l[k]), 0);

/** KDV1: satış / alış dökümü, beyanname özeti, muhasebe karşılaştırması ve mahsup */
export async function Vat1Tab({ month, from, to, canEdit }: TabProps) {
  const supabase = await createClient();
  const [{ data, error }, ref] = await Promise.all([
    supabase.rpc("gl_vat_report", { p_from: from, p_to: to }),
    supabase.rpc("gl_vat_refund_calc", { p_from: from, p_to: to }),
  ]);
  if (error) return <RpcError message={error.message} file="20270208000000_gl_close.sql" />;
  const v = data as Vat;
  const r = (ref.data ?? null) as Refund | null;
  const sale = v.lines.filter((l) => l.direction === "sale");
  const pur = v.lines.filter((l) => l.direction === "purchase");
  const out = sum(sale, "vat") - sum(sale, "withholding");
  const inn = sum(pur, "vat");
  const pay = out - inn - Number(v.gl.v190_open);

  // beyanname özeti: KDV'li teslimler oran bazında, istisnalar kod bazında
  const taxed = new Map<number, { base: number; vat: number; wh: number }>();
  const exempt = new Map<string, { base: number; n: number }>();
  for (const l of sale) {
    const s = sgn(l);
    if (Number(l.vat_rate) > 0) {
      const x = taxed.get(Number(l.vat_rate)) ?? { base: 0, vat: 0, wh: 0 };
      x.base += s * Number(l.base); x.vat += s * Number(l.vat); x.wh += s * Number(l.withholding);
      taxed.set(Number(l.vat_rate), x);
    } else {
      const code = l.exemption ?? (l.export ? "301" : "—");
      const x = exempt.get(code) ?? { base: 0, n: 0 };
      x.base += s * Number(l.base); x.n += Number(l.invoices);
      exempt.set(code, x);
    }
  }

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
        <KPI label="İndirilecek KDV" value={m(inn)} sub="KDV2 ile ödenen sorumlu KDV dahil" />
        <KPI label="Önceki aydan devreden" value={m(Number(v.gl.v190_open))} />
        <KPI label={pay >= 0 ? "Ödenecek KDV (tahmini)" : "Sonraki aya devreden"} value={m(Math.abs(pay))} tone={pay > 0 ? "bad" : "ok"} />
      </div>

      <Card title="Beyanname özeti (KDV1)">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-xs text-muted"><th className={th}>Vergiye tabi işlemler</th><th className={`${th} text-right`}>Matrah</th><th className={`${th} text-right`}>KDV</th><th className={`${th} text-right`}>Tevkifat</th></tr></thead>
            <tbody>
              {[...taxed.entries()].sort((a, b) => a[0] - b[0]).map(([rate, x]) => <tr key={rate}><td className={td}>%{rate} oranlı teslim ve hizmetler</td><td className={tdNum}>{m(x.base)}</td><td className={tdNum}>{m(x.vat)}</td><td className={tdNum}>{x.wh ? m(x.wh) : ""}</td></tr>)}
              {!taxed.size && <tr><td colSpan={4} className="py-4 text-center text-muted">KDV&apos;li satış yok.</td></tr>}
            </tbody>
          </table></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-xs text-muted"><th className={th}>İstisnalar</th><th className={`${th} text-right`}>Fatura</th><th className={`${th} text-right`}>Teslim bedeli</th></tr></thead>
            <tbody>
              {[...exempt.entries()].map(([code, x]) => <tr key={code}><td className={td}><b className="num">{code}</b> {EXEMPTION[code] ?? ""}</td><td className={tdNum}>{x.n}</td><td className={tdNum}>{m(x.base)}</td></tr>)}
              {!exempt.size && <tr><td colSpan={3} className="py-4 text-center text-muted">İstisnalı satış yok.</td></tr>}
            </tbody>
          </table></div>
        </div>
        <p className="text-xs text-muted">İstisna kodu girilmemiş ihracat faturaları 301 (mal ihracatı) sayıldı. Hizmet ihracatında satıra 302 yazın.</p>
      </Card>

      {r && Number(r.export_base) > 0 && (
        <Card title="İhracat KDV iadesi (tahmini)" action={<Link href={`/muhasebe/beyanname?ay=${month}&sekme=iade`} className="text-sm font-semibold text-brand-700">İade dosyası →</Link>}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="İhracat bedeli" value={m(r.export_base)} sub={`${r.export_invoices} fatura`} />
            <KPI label="Yüklenilen KDV (oranlama)" value={m(r.refundable)} />
            <KPI label="Bu ay iade edilebilir" value={m(r.refund_now)} tone={r.refund_now > 0 ? "ok" : undefined} sub="indirimle giderilemeyen" />
            <KPI label="Belgesi eksik fatura" value={String(r.missing_docs)} tone={r.missing_docs ? "bad" : undefined} sub="GÇB / ETGB no" />
          </div>
        </Card>
      )}

      <Card title="Satışlar (teslim ve hizmetler)"><T rows={sale} /></Card>
      <Card title="Alışlar (indirilecek KDV)"><T rows={pur} /></Card>
      <Card title="Muhasebe karşılaştırması">
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <span>391 bu ay: <b className="num">{m(v.gl.v391)}</b> · faturalardan: <b className="num">{m(sum(sale, "vat") - sum(sale, "withholding"))}</b></span>
          <span>191 bu ay: <b className="num">{m(v.gl.v191)}</b> · faturalardan: <b className="num">{m(inn)}</b></span>
          <span>Ay sonu bakiyeler: 190 <b className="num">{m(v.gl.v190_bal)}</b> · 191 <b className="num">{m(v.gl.v191_bal)}</b> · 391 <b className="num">{m(v.gl.v391_bal)}</b></span>
        </div>
        {!v.closed && (v.gl.v391 !== sum(sale, "vat") - sum(sale, "withholding") || v.gl.v191 !== inn) && <Notice tone="warn">Faturalardaki KDV ile muhasebe hesapları farklı: masraf girişlerinden gelen KDV, eşleştirme bekleyen kayıtlar ya da elle fiş olabilir.</Notice>}
        {v.closed ? <p className="text-sm">KDV mahsubu yapıldı: <Link href={`/muhasebe/fisler/${v.closed.id}`} className="font-semibold text-brand-700">fiş {v.closed.year}/{v.closed.no}</Link></p>
          : canEdit && <form action={glVatClose}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>{month} KDV mahsup fişini oluştur</PendingSubmit></form>}
      </Card>
    </>
  );
}
