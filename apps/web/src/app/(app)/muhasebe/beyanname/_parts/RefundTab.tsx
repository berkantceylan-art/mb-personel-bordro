import Link from "next/link";
import { Card } from "@/components/ui";
import { KPI, Notice, btnPrimary, btnSecondary, inputCls, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { formatDate } from "@/lib/session";
import { glVatRefundPost } from "@/lib/gl-actions";
import { RpcError, type TabProps } from "./shared";

type Calc = { export_base: number; sale_base: number; vat_out: number; vat_in: number; open: number; loaded: number; cap: number; refundable: number; carry: number; refund_now: number; export_invoices: number; missing_docs: number; posted: { id: string; no: number; year: number; total: number } | null };
type Exp = { id: string; date: string; doc_no: string | null; party: string; country: string | null; currency: string; total_fx: number; base: number; doc_kind: string | null; doc_no2: string | null; doc_date: string | null };
type Pur = { id: string; date: string; doc_no: string | null; party: string; tax_no: string | null; type: string; items: string | null; base: number; vat: number };
type Oth = { txn_id: string; date: string; doc_no: string | null; description: string | null; party: string | null; vat: number };
type List = { exports: Exp[]; purchases: Pur[]; others: Oth[] };

const m = (v: number) => fmt(v);

/** İhracat KDV iadesi: tahmini hesap, ihracat faturaları (GÇB / ETGB), yüklenilen KDV listesi, 136 fişi */
export async function RefundTab({ month, from, to, canEdit }: TabProps) {
  const supabase = await createClient();
  const [c, l] = await Promise.all([
    supabase.rpc("gl_vat_refund_calc", { p_from: from, p_to: to }),
    supabase.rpc("gl_vat_refund_list", { p_from: from, p_to: to }),
  ]);
  const err = c.error ?? l.error;
  if (err) return <RpcError message={err.message} file="20270212000000_tax_center.sql" />;
  const k = c.data as Calc;
  const x = l.data as List;
  const vatSum = x.purchases.reduce((a, p) => a + Number(p.vat), 0) + x.others.reduce((a, o) => a + Number(o.vat), 0);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="İhracat bedeli (TL)" value={m(k.export_base)} sub={`${k.export_invoices} fatura · toplam satışın %${k.sale_base ? Math.round((100 * k.export_base) / k.sale_base) : 0}'i`} />
        <KPI label="Yüklenilen KDV (oranlama)" value={m(k.loaded)} sub={`üst sınır %20: ${m(k.cap)}`} />
        <KPI label="Sonraki aya devreden KDV" value={m(k.carry)} />
        <KPI label="Bu ay iade edilebilir" value={m(k.refund_now)} tone={k.refund_now > 0 ? "ok" : undefined} sub="indirimle giderilemeyen" />
      </div>
      <Notice tone="info">
        Hesap tahminidir: yüklenilen KDV, ayın indirilecek KDV&apos;si ihracatın satışlar içindeki payıyla oranlanarak bulundu. Doğrudan ihracata ait alışlar ayrıca belirlenebilir. İade talebini mali müşaviriniz verir; bu sayfadaki listeler ve Excel dosyası iade dosyası için hazırlık sağlar.
      </Notice>
      {k.missing_docs > 0 && <Notice tone="warn">{k.missing_docs} ihracat faturasında gümrük beyannamesi (GÇB) ya da ETGB numarası yok. Fatura sayfasından ekleyin.</Notice>}

      <Card title="İade alacağı fişi" action={<a href={`/muhasebe/beyanname/iade-excel?ay=${month}`} className={btnSecondary}>Excel (iade listeleri)</a>}>
        {k.posted ? <p className="text-sm">Fiş: <Link href={`/muhasebe/fisler/${k.posted.id}`} className="font-semibold text-brand-700">{k.posted.year}/{k.posted.no}</Link> · {m(k.posted.total)} (136 borç / 190 alacak)</p>
          : <p className="text-sm text-muted">İade talebi verildiğinde talep edilen tutarı devreden KDV&apos;den (190) iade alacağına (136) aktarın. Para hesaba geçince finansta &quot;KDV iade alacağı&quot; kategorisiyle tahsilat girin; mahsuben iadede de aynı kategori kullanılır.</p>}
        {canEdit && (
          <form action={glVatRefundPost} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="month" value={month} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Talep edilen tutar (TL)<input name="amount" inputMode="decimal" defaultValue={k.refund_now ? (k.refund_now / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : ""} className={`${inputCls} w-48`} /></label>
            <PendingSubmit className={btnPrimary}>{k.posted ? "Fişi güncelle" : "İade alacağı fişini oluştur"}</PendingSubmit>
          </form>
        )}
        <p className="text-xs text-muted">Önce KDV1 sekmesinden ayın KDV mahsup fişini oluşturun; devreden KDV 190&apos;a ancak o zaman geçer.</p>
      </Card>

      <Card title={`İhracat faturaları · ${x.exports.length}`}>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Fatura</th><th className={th}>Müşteri</th><th className={`${th} text-right`}>Döviz tutarı</th><th className={`${th} text-right`}>TL</th><th className={th}>GÇB / ETGB</th></tr></thead>
          <tbody>
            {x.exports.map((e) => (
              <tr key={e.id}>
                <td className={td}>{formatDate(e.date)}</td>
                <td className={td}><Link href={`/fatura/${e.id}`} className="text-brand-700">{e.doc_no ?? "taslak no"}</Link></td>
                <td className={td}>{e.party}{e.country ? <span className="text-xs text-muted"> · {e.country}</span> : null}</td>
                <td className={tdNum}>{fmt(e.total_fx, e.currency)}</td><td className={tdNum}>{m(e.base)}</td>
                <td className={td}>{e.doc_no2 ? <span className="num">{e.doc_kind === "gb" ? "GÇB" : "ETGB"} {e.doc_no2}{e.doc_date ? <span className="text-xs text-muted"> · {formatDate(e.doc_date)}</span> : null}</span> : <Link href={`/fatura/${e.id}`} className="text-bad font-semibold">eksik: ekle</Link>}</td>
              </tr>
            ))}
            {!x.exports.length && <tr><td colSpan={6} className="py-6 text-center text-muted">Bu ay ihracat faturası yok.</td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card title={`Yüklenilen KDV listesi · ${x.purchases.length + x.others.length} belge · ${m(vatSum)}`}>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Belge</th><th className={th}>Satıcı</th><th className={th}>VKN</th><th className={th}>Mal / hizmet</th><th className={`${th} text-right`}>KDV hariç</th><th className={`${th} text-right`}>KDV</th></tr></thead>
          <tbody>
            {x.purchases.map((p) => (
              <tr key={p.id}><td className={td}>{formatDate(p.date)}</td><td className={td}><Link href={`/fatura/${p.id}`} className="text-brand-700">{p.doc_no ?? "—"}</Link>{p.type === "return" ? <span className="text-xs text-bad"> iade</span> : null}</td>
                <td className={td}>{p.party}</td><td className={`${td} num`}>{p.tax_no ?? ""}</td><td className={`${td} text-xs`}>{p.items ?? ""}</td><td className={tdNum}>{m(p.base)}</td><td className={tdNum}>{m(p.vat)}</td></tr>
            ))}
            {x.others.map((o) => (
              <tr key={o.txn_id}><td className={td}>{formatDate(o.date)}</td><td className={td}>{o.doc_no ?? "masraf"}</td><td className={td}>{o.party ?? ""}</td><td className={td} /><td className={`${td} text-xs`}>{o.description ?? ""}</td><td className={td} /><td className={tdNum}>{m(o.vat)}</td></tr>
            ))}
            {!x.purchases.length && !x.others.length && <tr><td colSpan={7} className="py-6 text-center text-muted">KDV&apos;li alış yok.</td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-muted">Fişli cariler listeye alınmaz. Masraf girişlerinde satıcı VKN ve matrah bulunmadığından iade listesine eklemeden önce belgesini kontrol edin.</p>
      </Card>
    </>
  );
}
