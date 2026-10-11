import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { today } from "@/lib/fin";
import { DIRECTION, type Direction } from "@/lib/invoice";
import { loadInvoiceForm, loadInvoiceInitial } from "@/lib/invoice-data";
import { InvoiceForm, type InitialInvoice } from "./InvoiceForm";
import { PhotoInvoice } from "./PhotoInvoice";

/** Yeni / taslak fatura sayfası (satış ve alış ortak) */
export async function NewInvoice({ direction, initial, title, fromId, asReturn, ocrNote }: { direction: Direction; initial?: InitialInvoice; title?: string; fromId?: string; asReturn?: boolean; ocrNote?: { ok: boolean; note: string } }) {
  const s = await getSession();
  const D = DIRECTION[direction];
  if ((s.modules[D.module] ?? 0) < 2) redirect(D.base);
  const [f, from] = await Promise.all([loadInvoiceForm(direction), fromId && /^[0-9a-f-]{36}$/i.test(fromId) ? loadInvoiceInitial(fromId, asReturn ? "return" : "copy") : Promise.resolve(null)]);
  if (from && from.direction === direction) initial = { ...initial, ...from };
  return (
    <>
      <PageHeader title={title ?? `Yeni ${D.label.toLocaleLowerCase("tr")} faturası`} subtitle={direction === "sale" ? "Ürettiğiniz protezler, ticari mal ya da hizmet satışı. Kesilen fatura e-Fatura / e-Arşiv XML'i olarak indirilir." : "Firmalardan alınan malzeme, hammadde, sarf, hizmet. e-Faturayı XML'den aktarmak daha hızlıdır."}
        actions={<Link href={`${D.base}/faturalar`} className="text-sm font-semibold text-brand-700">← {D.plural}</Link>} />
      <div className={page}>
        {direction === "purchase" && !ocrNote && <PhotoInvoice userId={s.userId} />}
        {ocrNote && <Notice tone={ocrNote.ok ? "ok" : "bad"}>{ocrNote.note}</Notice>}
        {direction === "purchase" && <Notice tone="info">e-Fatura XML / ZIP dosyanız varsa <Link href="/alis/ice-aktar" className="font-semibold underline">e-Fatura içe aktar</Link> ile tedarikçi, kalemler ve tutarlar otomatik gelir.</Notice>}
        {!f.company?.tax_no && direction === "sale" && <Notice>Şirketin VKN ve adres bilgisi eksik: e-Fatura XML&apos;i için <Link href="/satis/ayarlar" className="font-semibold underline">Fatura ayarları</Link>ndan girin.</Notice>}
        <InvoiceForm direction={direction} parties={f.parties} items={f.items} products={f.products} warehouses={f.warehouses} categories={f.categories} rates={f.rates} today={today()} labVat={f.company?.inv_lab_vat ?? 10} initial={initial} />
      </div>
    </>
  );
}
