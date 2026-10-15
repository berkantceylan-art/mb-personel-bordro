import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnPrimary, btnSecondary, inputCls, page, td, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { DOC_TYPE, glError } from "@/lib/gl";
import { LUCA_FIELDS, type LucaColumn } from "@/lib/luca-gl";
import { lucaMapSet, lucaResetColumns, lucaSaveColumns, lucaSaveRules, lucaUploadPlan, lucaUploadTemplate } from "@/lib/luca-actions";

export const dynamic = "force-dynamic";

type Settings = { columns: LucaColumn[]; exclude_prefixes: string[]; doc_map: Record<string, string>; pay_map: Record<string, string>; template_name: string | null; updated_at: string | null; plan_count: number; plan_imported_at: string | null; map_count: number };

const PREFIXES: Array<[string, string]> = [
  ["vat:", "KDV mahsup fişleri"], ["gecici:", "Geçici vergi tahakkuku"], ["cit:", "Kurumlar vergisi tahakkuku"], ["vatrefund:", "KDV iade fişleri"],
  ["stamp:", "Damga vergisi tahakkuku"], ["payroll:", "Bordro tahakkuku"], ["reflect:", "Yansıtma (7/A → 6)"],
];

/** Luca aktarım ayarları: şablon sütunları, hesap planı, eşleştirmeler, hariç tutulan fişler */
export default async function LucaSettings() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const approver = (s.modules.ledger ?? 0) >= 3;
  const supabase = await createClient();
  const [{ data, error }, { data: maps }] = await Promise.all([
    supabase.rpc("gl_luca_get_settings"),
    supabase.from("gl_luca_map").select("erp_code,luca_code").order("erp_code"),
  ]);
  const st = data as Settings | null;
  const fields = Object.entries(LUCA_FIELDS);

  return (
    <>
      <PageHeader title="Luca aktarım ayarları" subtitle="Luca şablonu, hesap planı ve aktarım kuralları" actions={<Link href="/muhasebe/luca" className="text-sm font-semibold text-brand-700">Luca aktarımı</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270219000000_luca_export.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {!approver && <Notice tone="info">Ayarları yönetici veya mali müşavir değiştirebilir.</Notice>}
        {st && (
          <>
            <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
              <h2 className="font-bold">1. Luca fiş şablonu</h2>
              <p className="text-sm text-muted">Luca&apos;da Muhasebe › Excel Veri Aktarımı ekranında &quot;Şablon indir&quot; ile aldığınız boş dosyayı yükleyin. Başlıklar okunur ve dosya birebir aynı sütun sırasıyla üretilir.</p>
              <p className="text-sm">{st.template_name ? <>Yüklü şablon: <b>{st.template_name}</b>{st.updated_at && ` · ${formatDate(st.updated_at.slice(0, 10))}`}</> : <span className="text-[#7A4F00]">Şablon yüklenmedi — varsayılan sütunlar kullanılıyor.</span>}</p>
              {approver && <form action={lucaUploadTemplate} className="flex flex-wrap gap-2"><input type="file" name="file" accept=".xls,.xlsx" className="text-sm" required /><PendingSubmit className={btnPrimary}>Şablonu yükle</PendingSubmit></form>}
              <form action={lucaSaveColumns} className="flex flex-col gap-2">
                <input type="hidden" name="n" value={st.columns.length} />
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>#</th><th className={th}>Luca başlığı</th><th className={th}>ERP&apos;den gelecek bilgi</th></tr></thead>
                  <tbody>
                    {st.columns.map((c, i) => (
                      <tr key={i}>
                        <td className={`${td} num`}>{i + 1}</td>
                        <td className={td}><input name={`h${i}`} defaultValue={c.header} disabled={!approver} className={`${inputCls} h-9`} /></td>
                        <td className={td}><select name={`f${i}`} defaultValue={c.field} disabled={!approver} className={`${inputCls} h-9`}>{fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      </tr>
                    ))}
                    {approver && (
                      <tr>
                        <td className={td}>+</td>
                        <td className={td}><input name="new_header" placeholder="yeni sütun başlığı" className={`${inputCls} h-9`} /></td>
                        <td className={td}><select name="new_field" defaultValue="bos" className={`${inputCls} h-9`}>{fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="text-xs text-muted">Bir sütunu kaldırmak için başlığını silip kaydedin. Fiş no ve hesap kodu sütunu zorunludur.</p>
                {approver && <div className="flex gap-3 items-center"><PendingSubmit className={btnSecondary}>Sütunları kaydet</PendingSubmit></div>}
              </form>
              {approver && st.template_name && <form action={lucaResetColumns}><ConfirmSubmit label="Varsayılan sütunlara dön" question="Yüklenen şablon eşleştirmesi silinsin mi?" className="text-xs font-semibold text-brand-700" /></form>}
            </section>

            <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
              <h2 className="font-bold">2. Luca hesap planı</h2>
              <p className="text-sm text-muted">Luca&apos;dan hesap planını Excel olarak alıp yükleyin (kod ve hesap adı sütunları yeterli). Aktarımdan önce her satırın Luca&apos;da tanımlı bir alt hesaba gittiği kontrol edilir.</p>
              <p className="text-sm">{st.plan_count ? <>Yüklü: <b>{st.plan_count}</b> hesap{st.plan_imported_at && ` · ${formatDate(st.plan_imported_at.slice(0, 10))}`} · <Link href="/muhasebe/luca/hesaplar" className="font-semibold text-brand-700">Luca&apos;da açılacak hesaplar (Excel)</Link></> : <span className="text-[#7A4F00]">Hesap planı yüklenmedi.</span>}</p>
              {st.plan_count > 0 && <p className="text-sm"><Link href="/muhasebe/luca/hesap-plani" className="font-semibold text-brand-700">Luca hesaplarını ERP&apos;de aç ve kategorileri bağla →</Link></p>}
              {approver && <form action={lucaUploadPlan} className="flex flex-wrap gap-2"><input type="file" name="file" accept=".xls,.xlsx,.csv" className="text-sm" required /><PendingSubmit className={btnPrimary}>Hesap planını yükle</PendingSubmit></form>}
            </section>

            <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
              <h2 className="font-bold">3. Hesap eşleştirmeleri · {maps?.length ?? 0}</h2>
              <p className="text-sm text-muted">ERP kodu Luca&apos;da farklıysa (ör. 770 → 770.01.001) burada eşleştirin. Eşleştirme yoksa aynı kod kullanılır.</p>
              {approver && <form action={lucaMapSet} className="flex flex-wrap gap-2"><input name="erp" placeholder="ERP kodu" required className={`${inputCls} h-10 w-40`} /><input name="luca" placeholder="Luca kodu" className={`${inputCls} h-10 w-48`} /><PendingSubmit className={btnSecondary}>Ekle / değiştir</PendingSubmit></form>}
              {(maps?.length ?? 0) > 0 && (
                <table className="w-full text-sm max-w-xl">
                  <thead><tr><th className={th}>ERP kodu</th><th className={th}>Luca kodu</th><th className={th}></th></tr></thead>
                  <tbody>{maps!.map((m) => <tr key={m.erp_code}><td className={`${td} num`}>{m.erp_code}</td><td className={`${td} num`}>{m.luca_code}</td><td className={td}>{approver && <form action={lucaMapSet}><input type="hidden" name="erp" value={m.erp_code} /><input type="hidden" name="luca" value="" /><PendingSubmit className="text-xs font-semibold text-bad">Kaldır</PendingSubmit></form>}</td></tr>)}</tbody>
                </table>
              )}
            </section>

            <form action={lucaSaveRules} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-4">
              <h2 className="font-bold">4. Aktarım kuralları</h2>
              <div className="flex flex-col gap-2">
                <b className="text-sm">Luca&apos;da ayrıca kesilen fişler (varsayılan olarak aktarılmaz, iki kez kayıt olmasın)</b>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  {PREFIXES.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`x_${k}`} defaultChecked={st.exclude_prefixes.includes(k)} disabled={!approver} />{l}</label>)}
                </div>
                <p className="text-xs text-muted">Bu fişler ERP&apos;de kalır (raporlar ve kontroller için); aktarım listesinde işaretsiz görünür, isterseniz tek tek seçebilirsiniz.</p>
              </div>
              <div className="flex flex-col gap-2">
                <b className="text-sm">Belge türü karşılıkları (e-defter)</b>
                <div className="grid sm:grid-cols-3 gap-2">
                  {Object.entries(DOC_TYPE).map(([k, l]) => <label key={k} className="text-sm flex flex-col gap-1">{l}<input name={`d_${k}`} defaultValue={st.doc_map[k] ?? ""} disabled={!approver} className={`${inputCls} h-9`} /></label>)}
                </div>
                <p className="text-xs text-muted">Luca&apos;daki belge türü kodlarıyla aynı yazın (Luca&apos;da Fiş Kes › Belge Türü listesinde görünen).</p>
              </div>
              {!st.columns.some((c) => c.field === "odeme_yontemi") && <input type="hidden" name="pay_map" value={Object.entries(st.pay_map).map(([k, v]) => `${k} = ${v}`).join("\n")} />}
              {st.columns.some((c) => c.field === "odeme_yontemi") && <label className="text-sm flex flex-col gap-1"><b>Ödeme yöntemi (hesap kodu = yöntem, her satıra bir tane)</b>
                <textarea name="pay_map" rows={6} defaultValue={Object.entries(st.pay_map).map(([k, v]) => `${k} = ${v}`).join("\n")} disabled={!approver} className="rounded-[10px] border border-[#D5DEE8] px-3 py-2 text-sm num" />
              </label>}
              {approver && <div><PendingSubmit className={btnPrimary}>Kuralları kaydet</PendingSubmit></div>}
            </form>
          </>
        )}
      </div>
    </>
  );
}
