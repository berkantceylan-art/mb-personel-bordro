import { Card } from "@/components/ui";
import { KPI, Notice, td, tdNum, th } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { formatDate } from "@/lib/session";
import { RpcError, type TabProps } from "./shared";

type Line = { code: string | null; rate: number; vat_rate: number; foreign: boolean; invoices: number; base: number; vat: number; withholding: number };
type Other = { txn_id: string; date: string; description: string | null; doc_no: string | null; party: string | null; amount: number };
type R = { lines: Line[]; others: Other[]; total: number };

const m = (v: number) => fmt(v);

/** KDV2: sorumlu sıfatıyla beyan edilen KDV (kısmi / tam tevkifat, yurt dışından hizmet) */
export async function Vat2Tab({ from, to }: TabProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_vat2_report", { p_from: from, p_to: to });
  if (error) return <RpcError message={error.message} file="20270212000000_tax_center.sql" />;
  const r = data as R;
  const fromInv = r.lines.reduce((x, l) => x + Number(l.withholding), 0);
  const fromOther = r.others.reduce((x, o) => x + Number(o.amount), 0);
  const total = Number(r.total);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPI label="KDV2 ile ödenecek" value={m(total)} tone={total > 0 ? "bad" : undefined} sub="izleyen ayın 25'i" />
        <KPI label="Faturalardan (tevkifat)" value={m(fromInv)} />
        <KPI label="Masraf girişlerinden" value={m(fromOther)} sub="yurt dışı reklam, yazılım" />
      </div>
      <Notice tone="info">
        KDV2&apos;de beyan edilen tutar aynı zamanda KDV1&apos;de indirilecek KDV olarak yer alır (191). Kayıt: KDV&apos;nin tamamı 191 borç, tevkif edilen kısım 360 alacak; satıcıya yalnız kalan tutar ödenir.
        Vergi dairesine ödemeyi finansta &quot;Vergi dairesine ödeme&quot; kategorisiyle girin.
      </Notice>
      {fromInv !== total - fromOther && <Notice tone="warn">Faturalardaki tevkifat ile muhasebeye geçen tutar farklı. Bu güncellemeden önce kesilmiş tevkifatlı alış faturaları eski yöntemle kaydedildi; gerekirse elle fişle düzeltin.</Notice>}
      <Card title="Faturalardaki tevkifat">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Tevkifat kodu</th><th className={th}>Tür</th><th className={`${th} text-right`}>Oran</th><th className={`${th} text-right`}>Fatura</th><th className={`${th} text-right`}>Matrah</th><th className={`${th} text-right`}>KDV</th><th className={`${th} text-right`}>Tevkif edilen</th></tr></thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i}><td className={`${td} num`}>{l.code ?? "—"}</td><td className={td}>{l.foreign ? "Yurt dışından hizmet (tam)" : Number(l.rate) >= 100 ? "Tam tevkifat" : "Kısmi tevkifat"}</td>
                <td className={tdNum}>{Number(l.rate) >= 100 ? "tamamı" : `${Math.round(Number(l.rate) / 10)}/10`}</td><td className={tdNum}>{l.invoices}</td><td className={tdNum}>{m(l.base)}</td><td className={tdNum}>{m(l.vat)}</td><td className={tdNum}>{m(l.withholding)}</td></tr>
            ))}
            {!r.lines.length && <tr><td colSpan={7} className="py-6 text-center text-muted">Tevkifatlı alış faturası yok.</td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-muted">Yurt dışından alınan hizmette (Google, Meta reklamı vb.) alış faturasına KDV %20 ve tevkifat %100 yazın: satıcıya KDV&apos;siz tutar ödenir, KDV&apos;yi siz KDV2 ile ödersiniz.</p>
      </Card>
      <Card title="Masraf girişlerinden sorumlu KDV">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Açıklama</th><th className={th}>Cari</th><th className={`${th} text-right`}>KDV</th></tr></thead>
          <tbody>
            {r.others.map((o) => <tr key={o.txn_id}><td className={td}>{formatDate(o.date)}</td><td className={td}>{o.description ?? "—"}{o.doc_no ? <span className="text-xs text-muted"> · {o.doc_no}</span> : null}</td><td className={td}>{o.party ?? ""}</td><td className={tdNum}>{m(o.amount)}</td></tr>)}
            {!r.others.length && <tr><td colSpan={4} className="py-6 text-center text-muted">Kayıt yok. Masraf girerken &quot;Sorumlu KDV&quot; seçilen kayıtlar burada görünür.</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </>
  );
}
