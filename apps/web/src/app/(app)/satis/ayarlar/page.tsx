import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Field, Notice, btnPrimary, inputCls, page, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { saveInvoiceSettings } from "@/lib/invoice-actions";
import { loadCompany } from "@/lib/invoice-data";

export const dynamic = "force-dynamic";

/** Şirket fatura bilgileri, seri önekleri, varsayılan laboratuvar KDV'si, entegratör */
export default async function InvoiceSettings() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1) redirect("/");
  const co = await loadCompany();
  const owner = s.role === "owner";
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
            <Notice tone="info">Faturalar şimdilik UBL-TR XML olarak üretilir: Satış faturaları &gt; “Gönderime hazır” &gt; ZIP indir → entegratör portalına yükle. Entegratörün API bilgileri (kullanıcı adı / şifre ya da anahtar) Vercel ortam değişkeni olarak eklendiğinde gönderim ve gelen faturaları çekme otomatik hale getirilebilir.</Notice>
          </section>
          {owner && <div><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>}
        </form>
      </div>
    </>
  );
}
