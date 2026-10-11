import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { qty } from "@/lib/stock";
import { loadCompany } from "@/lib/invoice-data";
import { PROFILES, type InvLine, type Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

/** Fatura çıktısı (A4). e-Fatura / e-Arşiv için bilgi amaçlı görünüm; resmi PDF entegratörden de alınabilir. */
export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, { data: lines }, co] = await Promise.all([
    supabase.from("inv_invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("inv_lines").select("*").eq("invoice_id", id).order("sort"),
    loadCompany(),
  ]);
  if (!data) notFound();
  const inv = data as Invoice;
  if ((s.modules[inv.direction === "sale" ? "sales" : "purchases"] ?? 0) < 1 && (s.modules.finance ?? 0) < 1) redirect("/");
  const ls = (lines ?? []) as InvLine[];
  const sale = inv.direction === "sale";
  const seller = sale ? { name: co?.name ?? "", tax: co?.tax_no, office: co?.tax_office, addr: [co?.address, co?.district, co?.city].filter(Boolean).join(", "), phone: co?.phone, email: co?.email, web: co?.website, mersis: co?.mersis_no }
    : { name: inv.party_name ?? "", tax: inv.party_tax_no, office: inv.party_tax_office, addr: [inv.party_address, inv.party_district, inv.party_city].filter(Boolean).join(", "), phone: null, email: inv.party_email, web: null, mersis: null };
  const buyer = sale ? { name: inv.party_name ?? "", tax: inv.party_tax_no, office: inv.party_tax_office, addr: [inv.party_address, inv.party_district, inv.party_city].filter(Boolean).join(", "), email: inv.party_email }
    : { name: co?.name ?? "", tax: co?.tax_no, office: co?.tax_office, addr: [co?.address, co?.district, co?.city].filter(Boolean).join(", "), email: co?.email };
  const byRate = new Map<number, { base: number; vat: number }>();
  for (const l of ls) { const b = byRate.get(Number(l.vat_rate)) ?? { base: 0, vat: 0 }; byRate.set(Number(l.vat_rate), { base: b.base + Number(l.net), vat: b.vat + Number(l.vat) }); }
  const qrData = JSON.stringify({
    vkntckn: seller.tax ?? "", avkntckn: buyer.tax ?? "11111111111", senaryo: inv.profile, tip: inv.type === "return" ? "IADE" : Number(inv.withholding_total) ? "TEVKIFAT" : "SATIS",
    tarih: inv.invoice_date, no: inv.doc_no ?? "", ettn: inv.ettn, parabirimi: inv.currency, malhizmettoplam: (Number(inv.gross_total) / 100).toFixed(2),
    ...Object.fromEntries([...byRate.entries()].flatMap(([r, b]) => [[`kdvmatrah(${r})`, (b.base / 100).toFixed(2)], [`hesaplanankdv(${r})`, (b.vat / 100).toFixed(2)]])),
    vergidahil: ((Number(inv.subtotal) + Number(inv.vat_total)) / 100).toFixed(2), odenecek: (Number(inv.total) / 100).toFixed(2),
  });
  const qr = await QRCode.toString(qrData, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const title = inv.type === "return" ? "İADE FATURASI" : inv.profile === "EARSIVFATURA" ? "e-ARŞİV FATURA" : inv.profile === "KAGIT" ? "FATURA" : "e-FATURA";
  const preview = sale && inv.profile !== "KAGIT" && !["sent", "accepted"].includes(inv.einvoice_status);
  const cell = "border border-[#9AA7B4] px-2 py-1";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/fatura/${inv.id}`} className="font-semibold text-[#0A3D73]">← Faturaya dön</Link>
        <PrintButton />
        {sale && <a href={`/api/fatura/${inv.id}/xml`} className="text-sm font-semibold text-[#0A3D73]">XML indir</a>}
      </div>
      <div className="mx-auto my-6 print:m-0 bg-white w-[190mm] min-h-[270mm] p-[8mm] print:p-0 flex flex-col gap-4">
        {preview && <p className="text-center text-[10px] font-semibold text-[#9A6700] border border-[#E7C66A] bg-[#FFF8E1] py-1 print:bg-white">Bilgi amaçlı görünüm — e-Fatura / e-Arşiv entegratör üzerinden gönderildiğinde resmîleşir.</p>}
        <header className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
          <div className="flex flex-col gap-0.5">
            <b className="text-[13px]">{seller.name}</b>
            <span>{seller.addr}</span>
            {seller.phone && <span>Tel: {seller.phone}</span>}
            {seller.email && <span>E-posta: {seller.email}</span>}
            {seller.web && <span>{seller.web}</span>}
            <span>Vergi dairesi: {seller.office ?? "—"} · {String(seller.tax ?? "").length === 11 ? "TCKN" : "VKN"}: {seller.tax ?? "—"}</span>
            {seller.mersis && <span>MERSİS: {seller.mersis}</span>}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="w-[30mm] h-[30mm] [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <b className="text-[14px] tracking-wide">{title}</b>
          </div>
          <table className="justify-self-end border-collapse">
            <tbody>
              {[["Senaryo", PROFILES[inv.profile] ?? inv.profile], ["Fatura tipi", inv.type === "return" ? "İADE" : Number(inv.withholding_total) ? "TEVKİFAT" : "SATIŞ"], ["Fatura no", inv.doc_no ?? `Taslak #${inv.no}`],
                ["Fatura tarihi", formatDate(inv.invoice_date)], ...(inv.due_date ? [["Vade", formatDate(inv.due_date)]] : []), ["ETTN", inv.ettn], ...(inv.currency !== "TRY" ? [["Döviz kuru", `1 ${inv.currency} = ${Number(inv.rate).toLocaleString("tr-TR")} ₺`]] : [])].map(([k, v]) => (
                <tr key={k}><td className={`${cell} font-semibold bg-[#F1F4F8]`}>{k}</td><td className={`${cell} ${k === "ETTN" ? "text-[9px]" : ""}`}>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </header>
        <section className="border border-[#9AA7B4] p-2 flex flex-col gap-0.5 max-w-[60%]">
          <span className="text-[9px] uppercase text-[#5A6B7D]">Sayın</span>
          <b className="text-[12px]">{buyer.name}</b>
          <span>{buyer.addr}</span>
          {buyer.email && <span>E-posta: {buyer.email}</span>}
          <span>Vergi dairesi: {buyer.office ?? "—"} · {String(buyer.tax ?? "").length === 11 ? "TCKN" : "VKN"}: {buyer.tax ?? "11111111111"}</span>
        </section>
        <table className="w-full border-collapse">
          <thead className="bg-[#F1F4F8]"><tr>{["Sıra", "Mal / hizmet", "Miktar", "Birim fiyat", "İsk. %", "İsk. tutarı", "KDV %", "KDV tutarı", "Mal / hizmet tutarı"].map((h) => <th key={h} className={`${cell} text-left`}>{h}</th>)}</tr></thead>
          <tbody>
            {ls.map((l) => (
              <tr key={l.id}>
                <td className={cell}>{l.sort}</td>
                <td className={cell}>{l.name}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{qty(l.qty)} {l.unit}</td>
                <td className={`${cell} text-right`}>{Number(l.unit_price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                <td className={`${cell} text-right`}>{Number(l.discount_pct) ? Number(l.discount_pct).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : ""}</td>
                <td className={`${cell} text-right`}>{Number(l.discount) ? fmt(l.discount, inv.currency) : ""}</td>
                <td className={`${cell} text-right`}>{Number(l.vat_rate)}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{fmt(l.vat, inv.currency)}</td>
                <td className={`${cell} text-right whitespace-nowrap`}>{fmt(l.net, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end">
          <table className="border-collapse min-w-[80mm]">
            <tbody>
              {[["Mal / hizmet toplamı", fmt(inv.gross_total, inv.currency)], ["Toplam iskonto", fmt(inv.discount_total, inv.currency)],
                ...[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([r, b]) => [`Hesaplanan KDV (%${r})`, fmt(b.vat, inv.currency)]),
                ...(Number(inv.withholding_total) ? [["KDV tevkifatı", fmt(inv.withholding_total, inv.currency)]] : []),
                ["Vergiler dahil toplam", fmt(Number(inv.subtotal) + Number(inv.vat_total), inv.currency)], ["Ödenecek tutar", fmt(inv.total, inv.currency)],
                ...(inv.currency !== "TRY" ? [["Ödenecek (TL karşılığı)", fmt(Math.round(Number(inv.total) * Number(inv.rate)), "TRY")]] : [])].map(([k, v], i, a) => (
                <tr key={k} className={i === a.length - 1 || k === "Ödenecek tutar" ? "font-bold text-[12px]" : ""}><td className={`${cell} bg-[#F1F4F8]`}>{k}</td><td className={`${cell} text-right whitespace-nowrap`}>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="border border-[#9AA7B4] p-2 flex flex-col gap-1">
          <span><b>Yalnız:</b> {inWords(Number(inv.total), inv.currency)}</span>
          {inv.note && <span><b>Not:</b> {inv.note}</span>}
          {co?.inv_note && sale && <span>{co.inv_note}</span>}
        </footer>
      </div>
    </main>
  );
}

/** Tutarı yazıyla: 1250,50 TL → "BinİkiYüzElliTürkLirasıElliKuruş" (fatura geleneği) */
function inWords(minor: number, cur: string): string {
  const ones = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
  const tens = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];
  const three = (n: number) => `${n >= 100 ? (Math.floor(n / 100) === 1 ? "" : ones[Math.floor(n / 100)]) + "Yüz" : ""}${tens[Math.floor((n % 100) / 10)]}${ones[n % 10]}`;
  const words = (n: number): string => {
    if (n === 0) return "Sıfır";
    const groups = ["", "Bin", "Milyon", "Milyar"];
    let out = "", i = 0;
    while (n > 0) {
      const g = n % 1000;
      if (g) out = (i === 1 && g === 1 ? "" : three(g)) + groups[i] + out;
      n = Math.floor(n / 1000); i++;
    }
    return out;
  };
  const whole = Math.floor(Math.abs(minor) / 100), frac = Math.abs(minor) % 100;
  const name = { TRY: ["TürkLirası", "Kuruş"], EUR: ["Euro", "Sent"], USD: ["ABDDoları", "Sent"], GBP: ["Sterlin", "Peni"], CHF: ["İsviçreFrangı", "Rappen"] }[cur] ?? [cur, ""];
  return `${words(whole)}${name[0]}${frac ? words(frac) + name[1] : ""}`;
}
