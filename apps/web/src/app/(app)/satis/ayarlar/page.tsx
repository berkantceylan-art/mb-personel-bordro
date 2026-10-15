import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Field, Notice, btnPrimary, inputCls, page, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { saveInvoiceSettings } from "@/lib/invoice-actions";
import { loadCompany } from "@/lib/invoice-data";
import { einvCompanySettings } from "@/lib/einv-send-actions";
import { elogoConfigured, elogoPrefixes, withElogo } from "@/lib/elogo";

export const dynamic = "force-dynamic";

/** Şirket fatura bilgileri, seri önekleri, varsayılan laboratuvar KDV'si, entegratör */
export default async function InvoiceSettings() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1) redirect("/");
  const co = await loadCompany();
  const owner = s.role === "owner";
  const manager = (s.modules.sales ?? 0) >= 3;
  const configured = elogoConfigured();
  let prefixes: Array<{ prefix: string; counter: number; type: number }> | null = null;
  let prefixErr = "";
  if (configured) { try { prefixes = await withElogo((w, ss) => elogoPrefixes(w, ss)); } catch (e) { prefixErr = (e as Error).message; } }
  const f = (name: string, label: string, v: string | number | null | undefined, extra: { hint?: string; max?: number; cls?: string; ph?: string } = {}) => (
    <Field label={label} hint={extra.hint} className={extra.cls}><input name={name} defaultValue={v ?? ""} maxLength={extra.max} placeholder={extra.ph} disabled={!owner} className={inputCls} /></Field>
  );
  return (
    <>
      <PageHeader title="Fatura ayarları" subtitle="e-Fatura / e-Arşiv XML'inde gönderici olarak yazılan şirket bilgileri ve numara serileri" />
      <div className={page}>
        {!owner && <Notice>Bu bilgileri yalnız firma sahibi değiştirebilir.</Notice>}
        <form action={saveInvoiceSettings} className="flex flex-col gap-5 max-w-4xl">
          <section className="bg-white border border-line rounded-[14px] p-4 grid gap-4 md:grid-cols-2">
            <h2 className="md:col-span-2 font-semibold">Şirket</h2>
            {f("name", "Unvan", co?.name, { cls: "md:col-span-2", max: 200 })}
            {f("tax_no", "VKN / TCKN", co?.tax_no, { max: 11 })}
            {f("tax_office", "Vergi dairesi", co?.tax_office, { max: 80 })}
            {f("address", "Adres (cadde, sokak, no)", co?.address, { cls: "md:col-span-2", max: 400 })}
            {f("district", "İlçe", co?.district, { max: 80 })}
            {f("city", "İl", co?.city, { max: 80 })}
            {f("postal_code", "Posta kodu", co?.postal_code, { max: 10 })}
            {f("country", "Ülke", co?.country ?? "Türkiye", { max: 60 })}
            {f("phone", "Telefon", co?.phone, { max: 40 })}
            {f("email", "E-posta", co?.email, { max: 200 })}
            {f("website", "Web sitesi", co?.website, { max: 200, ph: "https://mbdentaire.com" })}
            {f("mersis_no", "MERSİS no", co?.mersis_no, { max: 20 })}
            {f("trade_registry_no", "Ticaret sicil no", co?.trade_registry_no, { max: 30 })}
          </section>
          <section className="bg-white border border-line rounded-[14px] p-4 grid gap-4 md:grid-cols-3">
            <h2 className="md:col-span-3 font-semibold">Numara ve vergi</h2>
            {f("inv_prefix_efatura", "e-Fatura seri öneki", co?.inv_prefix_efatura ?? "MBD", { hint: "3 harf/rakam", max: 3 })}
            {f("inv_prefix_earsiv", "e-Arşiv seri öneki", co?.inv_prefix_earsiv ?? "MBA", { hint: "3 harf/rakam", max: 3 })}
            {f("inv_lab_vat", "Protez / iş faturası KDV %", co?.inv_lab_vat ?? 10, { hint: "muhasebeciye teyit ettirin", max: 6 })}
            <p className="md:col-span-3 text-xs text-muted">Numara biçimi: önek + yıl + 9 hane (ör. {co?.inv_prefix_efatura ?? "MBD"}{new Date().getFullYear()}000000001). Entegratör kendi serisini veriyorsa önekleri entegratördeki seriyle aynı yapın.</p>
          </section>
          <section className="bg-white border border-line rounded-[14px] p-4 grid gap-4">
            <h2 className="font-semibold">e-Fatura entegratörü</h2>
            {f("einvoice_provider", "Entegratör adı", co?.einvoice_provider, { max: 60, ph: "ör. Uyumsoft, QNB eFinans, Logo, Paraşüt…" })}
            <Field label="Faturaların altına yazılacak not" hint="banka / IBAN, iade koşulları"><textarea name="inv_note" defaultValue={co?.inv_note ?? ""} rows={3} maxLength={1000} disabled={!owner} className={textareaCls} /></Field>
            <Notice tone="info">{configured ? "eLogo bağlı: faturalar fatura sayfasındaki “eLogo'ya gönder” ile ERP'den gönderilir; gönderim ayarları aşağıda." : "eLogo bağlı değil: XML'i indirip entegratör portalına yükleyin. Vercel'e ELOGO_USER ve ELOGO_PASS eklenince ERP'den gönderim açılır."}</Notice>
          </section>
          {owner && <div><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>}
        </form>

        <form action={einvCompanySettings} className="bg-white border border-line rounded-[14px] p-4 grid gap-4 md:grid-cols-3 max-w-4xl" id="e-belge">
          <h2 className="md:col-span-3 font-semibold">e-Belge gönderimi (eLogo)</h2>
          <Field label="Fatura numarasını kim versin">
            <select name="numbering" defaultValue={co?.einv_numbering ?? "erp"} disabled={!manager} className={inputCls}>
              <option value="erp">ERP (fatura kesilince, yukarıdaki öneklerle)</option>
              <option value="elogo">eLogo (gönderimde, aynı önekle)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" name="draft" defaultChecked={co?.einv_draft !== false} disabled={!manager} /> Varsayılan: eLogo taslaklarına gönder</label>
          <Field label="e-İrsaliye seri öneki" hint="3 harf/rakam"><input name="prefix_irsaliye" defaultValue={co?.inv_prefix_irsaliye ?? "MBI"} maxLength={3} disabled={!manager} className={inputCls} /></Field>
          <Field label="IBAN" hint="kamu faturasında zorunlu"><input name="iban" defaultValue={co?.einv_iban ?? ""} maxLength={34} placeholder="TR…" disabled={!manager} className={`${inputCls} font-mono`} /></Field>
          <Field label="İnternet satış web adresi" hint="e-Arşiv internet satışı"><input name="web" defaultValue={co?.einv_web ?? ""} maxLength={200} placeholder="https://…" disabled={!manager} className={inputCls} /></Field>
          <div />
          <Field label="e-Fatura tasarım kodu" hint="eLogo portalındaki tasarımın UUID'si (boş = varsayılan)"><input name="xslt_efatura" defaultValue={co?.einv_xslt_efatura ?? ""} maxLength={40} disabled={!manager} className={`${inputCls} font-mono text-xs`} /></Field>
          <Field label="e-Arşiv tasarım kodu"><input name="xslt_earsiv" defaultValue={co?.einv_xslt_earsiv ?? ""} maxLength={40} disabled={!manager} className={`${inputCls} font-mono text-xs`} /></Field>
          <Field label="e-İrsaliye tasarım kodu"><input name="xslt_irsaliye" defaultValue={co?.einv_xslt_irsaliye ?? ""} maxLength={40} disabled={!manager} className={`${inputCls} font-mono text-xs`} /></Field>
          <div className="md:col-span-3 text-xs text-muted flex flex-col gap-1">
            <span><b>Taslak modu:</b> ERP&apos;den gönderilen belge önce eLogo portalında Taslaklar ekranına düşer, siz onaylayınca GİB&apos;e gider. İlk faturaları böyle deneyin; sorun yoksa kutuyu kaldırıp doğrudan gönderin.</span>
            <span><b>Numara:</b> Faturayı hem ERP&apos;den hem eLogo portalından kesiyorsanız aynı öneki iki yerde kullanmayın (sıra karışır) ya da numarayı eLogo&apos;ya bırakın.</span>
          </div>
          {configured && (
            <div className="md:col-span-3 text-sm">
              <b>eLogo&apos;daki seriler:</b>{" "}
              {prefixErr ? <span className="text-bad">{prefixErr}</span> : prefixes?.length ? prefixes.map((x) => `${x.prefix} (son no ${x.counter})`).join(" · ") : "tanımlı seri yok"}
              {prefixes?.some((x) => x.prefix === co?.inv_prefix_efatura || x.prefix === co?.inv_prefix_earsiv) && co?.einv_numbering !== "elogo" && <p className="text-xs text-warn mt-1">ERP önekiniz eLogo&apos;da da kullanılıyor: portaldan da aynı önekle fatura kesiyorsanız numarayı eLogo&apos;ya bırakın.</p>}
            </div>
          )}
          {manager && <div className="md:col-span-3"><PendingSubmit className={btnPrimary}>e-Belge ayarlarını kaydet</PendingSubmit></div>}
        </form>
      </div>
    </>
  );
}
