import Link from "next/link";
import { Card } from "@/components/ui";
import { KPI, btnPrimary, inputCls, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { formatDate } from "@/lib/session";
import { glStampClose, glStampDelete } from "@/lib/gl-actions";
import { RpcError, STAMP_TYPES, type TabProps } from "./shared";
import { StampForm } from "./StampForm";

type Doc = { id: string; doc_date: string; doc_type: string; title: string; party: string | null; base: number; rate_pm: number; fixed_amount: number | null; share_pct: number; tax: number; our_tax: number; note: string | null };
type R = { docs: Doc[]; total: number; payroll: number; voucher: { id: string; no: number; year: number; total: number } | null };

const m = (v: number) => fmt(v);
const TYPE = Object.fromEntries(STAMP_TYPES.map(([k, l]) => [k, l]));

/** Damga vergisi: sözleşme defteri, aylık beyan tutarı, tahakkuk fişi */
export async function StampTab({ month, canEdit }: TabProps) {
  const supabase = await createClient();
  const [{ data, error }, { data: parties }] = await Promise.all([
    supabase.rpc("gl_stamp_report", { p_month: month }),
    canEdit ? supabase.from("fin_parties").select("id, name").eq("is_active", true).order("name").limit(800) : Promise.resolve({ data: [] }),
  ]);
  if (error) return <RpcError message={error.message} file="20270212000000_tax_center.sql" />;
  const r = data as R;
  const total = Number(r.total);
  const changed = r.voucher && Number(r.voucher.total) !== total;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPI label="Damga vergisi beyannamesi" value={m(total)} tone={total > 0 ? "bad" : undefined} sub={`${r.docs.length} kâğıt · izleyen ayın 26'sı`} />
        <KPI label="Ücret damga vergisi" value={m(Number(r.payroll))} sub="muhtasar ve prim hizmette (kod 302)" />
        <KPI label="Tahakkuk fişi" value={r.voucher ? `${r.voucher.year}/${r.voucher.no}` : "yok"} tone={changed ? "bad" : undefined} sub={changed ? "kayıtlar değişti: yeniden oluşturun" : undefined} />
      </div>
      <Card title={`${month} damga vergisine tabi kâğıtlar`}>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Tür</th><th className={th}>Kâğıt</th><th className={`${th} text-right`}>Bedel</th><th className={`${th} text-right`}>Oran</th><th className={`${th} text-right`}>Vergi</th><th className={`${th} text-right`}>Şirket payı</th>{canEdit && <th className={th} />}</tr></thead>
          <tbody>
            {r.docs.map((d) => (
              <tr key={d.id}>
                <td className={td}>{formatDate(d.doc_date)}</td><td className={`${td} text-xs`}>{TYPE[d.doc_type] ?? d.doc_type}</td>
                <td className={td}>{d.title}{d.party ? <span className="text-xs text-muted"> · {d.party}</span> : null}{d.note ? <div className="text-xs text-muted">{d.note}</div> : null}</td>
                <td className={tdNum}>{d.fixed_amount != null ? "maktu" : m(d.base)}</td>
                <td className={tdNum}>{d.fixed_amount != null ? "" : `‰${Number(d.rate_pm).toLocaleString("tr-TR")}`}</td>
                <td className={tdNum}>{m(d.tax)}</td>
                <td className={tdNum}>{m(d.our_tax)}{Number(d.share_pct) < 100 ? <span className="text-xs text-muted"> (%{Number(d.share_pct)})</span> : null}</td>
                {canEdit && <td className={td}><form action={glStampDelete}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" question="Bu kayıt silinsin mi?" /></form></td>}
              </tr>
            ))}
            {!r.docs.length && <tr><td colSpan={8} className="py-6 text-center text-muted">Bu ay kayıt yok.</td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-muted">2026 oranları: kira sözleşmesi binde 1,89, diğer sözleşme ve taahhütler binde 9,48. Bir kâğıt için azami vergi 29.115.961,10 TL. Taraflar vergiden birlikte sorumludur; sözleşmede ödeyen taraf yazıyorsa şirket payını ona göre girin.</p>
      </Card>
      {canEdit && (
        <Card title="Kâğıt ekle">
          <StampForm month={month} parties={(parties ?? []) as Array<{ id: string; name: string }>} />
        </Card>
      )}
      <Card title="Tahakkuk">
        {r.voucher && <p className="text-sm">Fiş: <Link href={`/muhasebe/fisler/${r.voucher.id}`} className="font-semibold text-brand-700">{r.voucher.year}/{r.voucher.no}</Link> · {m(r.voucher.total)}</p>}
        {canEdit && total > 0 && (
          <form action={glStampClose} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="month" value={month} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Gider hesabı<input name="expense" defaultValue="770" className={`${inputCls} w-28`} /></label>
            <PendingSubmit className={btnPrimary}>{r.voucher ? "Fişi yeniden oluştur" : "Tahakkuk fişini oluştur"} (gider / 360)</PendingSubmit>
          </form>
        )}
        {!total && <p className="text-sm text-muted">Bu ay beyan edilecek damga vergisi yok.</p>}
      </Card>
    </>
  );
}
