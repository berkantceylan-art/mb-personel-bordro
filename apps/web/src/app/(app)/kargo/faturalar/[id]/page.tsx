import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FLAG_LABEL, PREMIUM, flagItems, loadCarrierItems } from "@/lib/carrier-check";
import { setCarrierInvoiceStatus, toggleDispute } from "@/lib/carrier-actions";

export const dynamic = "force-dynamic";

const tl = (k: number) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const day = (d: string | null) => (d ? d.split("-").reverse().join(".") : "—");

/** Kargo faturası: konşimento satırları, ek ücretler, uyarılar, itiraz */
export default async function CarrierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sb = await createClient();
  const { data: inv } = await sb.from("carrier_invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const items = await flagItems((await loadCarrierItems("2000-01-01", id)).data);
  items.sort((a, b) => (a.ship_date ?? "").localeCompare(b.ship_date ?? ""));
  const td = "py-2 px-2 border-t border-[#EEF2F6] align-top";
  const th = "py-2 px-2 font-semibold text-left text-xs text-muted";
  return (
    <>
      <PageHeader title={`${String(inv.carrier).toUpperCase()} ${inv.invoice_no}`} subtitle={`${day(inv.invoice_date)}${inv.due_date ? ` · son ödeme ${day(inv.due_date)}` : ""}${inv.bill_type ? ` · ${inv.bill_type}` : ""} · ${tl(Number(inv.total))}`} actions={<Link href={`/kargo/faturalar/${inv.carrier}`} className="text-sm font-semibold text-brand-700">← {String(inv.carrier).toUpperCase()} faturaları</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-4 max-w-[1320px]">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{items.length} gönderi · satır toplamı <b>{tl(items.reduce((a, i) => a + i.total, 0))}</b>{inv.eur_total ? ` · ${(Number(inv.eur_total) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} € (kur ${inv.eur_rate})` : ""}</span>
          {inv.carrier === "ups" && items.length === 0 && <span className="text-warn">Gönderi ayrıntısı yok: faturadaki &quot;E-Fatura Ayrıntıları&quot; bağlantısından Fatura Detay Excel&apos;ini indirip yükleyin.</span>}
          <span className="ml-auto flex gap-2">
            {(["open", "checked", "disputed"] as const).map((st) => (
              <form key={st} action={setCarrierInvoiceStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={st} />
                <button className={`h-9 px-3 rounded-lg border font-semibold ${inv.status === st ? "bg-brand-700 text-white border-brand-700" : "border-[#D5DEE8] bg-white text-brand-700"}`}>{st === "open" ? "Açık" : st === "checked" ? "Kontrol edildi" : "İtiraz"}</button>
              </form>
            ))}
          </span>
        </div>
        <section className="rounded-[16px] border border-line bg-white p-2 overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead><tr><th className={th}>Tarih</th><th className={th}>Konşimento</th><th className={th}>Alıcı / hekim</th><th className={th}>Varış</th><th className={`${th} text-right`}>Kg</th><th className={`${th} text-right`}>Taşıma</th><th className={th}>Ek ücretler</th><th className={`${th} text-right`}>Toplam</th><th className={th}>Uyarı / itiraz</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={i.disputed ? "bg-[#FFF6F5]" : ""}>
                  <td className={td}>{day(i.ship_date)}</td>
                  <td className={`${td} font-mono text-xs`}>{i.shipment_id ? <Link href={`/kargo/${i.shipment_id}`} className="text-brand-700">{i.awb}</Link> : i.awb}{i.product ? <span className="block text-muted">ürün {i.product}</span> : null}</td>
                  <td className={td}>{i.lab_customers?.name ? <b>{i.lab_customers.name}</b> : null}<span className="block text-xs text-muted">{[i.recipient_company, i.recipient].filter((x, k, a) => x && a.indexOf(x) === k).join(" · ")}</span></td>
                  <td className={td}>{i.dest_country ?? "—"}{i.dest ? <span className="text-xs text-muted"> {i.dest}</span> : null}</td>
                  <td className={`${td} text-right num`}>{i.weight ?? "—"}{i.weight_basis ? <span className="text-xs text-muted"> {i.weight_basis}</span> : null}</td>
                  <td className={`${td} text-right num`}>{tl(i.base_amount)}</td>
                  <td className={`${td} text-xs`}>{i.extras.map((x, k) => <span key={k} className={`block ${PREMIUM.test(x.name) ? "text-bad font-semibold" : ""}`}>{x.name}: {tl(x.amount)}</span>)}</td>
                  <td className={`${td} text-right num font-semibold`}>{tl(i.total)}</td>
                  <td className={`${td} text-xs`}>
                    {i.flags.length > 0 && <span className="block text-warn mb-1">{i.flags.map((f) => FLAG_LABEL[f]).join(" · ")}</span>}
                    <form action={toggleDispute} className="flex gap-1"><input type="hidden" name="id" value={i.id} />
                      <input name="note" defaultValue={i.note ?? ""} placeholder="itiraz notu" className="h-8 w-36 rounded border border-[#D5DEE8] px-1.5" />
                      <button className={`h-8 px-2 rounded border font-semibold ${i.disputed ? "border-bad text-bad" : "border-[#D5DEE8] text-brand-700"}`}>{i.disputed ? "İtirazı kaldır" : "İtiraz"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
