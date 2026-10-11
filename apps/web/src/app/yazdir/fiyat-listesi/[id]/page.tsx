import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { docDate, docMoney } from "@/lib/waybill";

export const dynamic = "force-dynamic";

const T = {
  tr: { title: "FİYAT LİSTESİ", for: "Müşteri", product: "Ürün / iş", price: "Birim fiyat", special: "size özel", valid: "Geçerlilik", date: "Tarih", disc: "Genel iskonto", note: "Koşullar", term: "Ödeme vadesi", days: "gün" },
  en: { title: "PRICE LIST", for: "Customer", product: "Product / work", price: "Unit price", special: "your price", valid: "Valid", date: "Date", disc: "General discount", note: "Terms", term: "Payment term", days: "days" },
  fr: { title: "LISTE DE PRIX", for: "Client", product: "Produit / travail", price: "Prix unitaire", special: "votre prix", valid: "Validité", date: "Date", disc: "Remise générale", note: "Conditions", term: "Délai de paiement", days: "jours" },
};

/** Müşteriye özel fiyat listesi (A4): liste fiyatı, iskonto ve özel fiyatlarla — müşterinin dilinde. ?dil= */
export default async function PriceList({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dil?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: c } = await supabase.from("lab_customers").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const lang = (["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil : c.doc_lang ?? "tr") as "tr" | "en" | "fr";
  const t = T[lang];
  const [{ data: prods }, { data: specials }, { data: co }] = await Promise.all([
    supabase.from("lab_products").select("id, name, material, price_try, price_eur, sort").eq("is_active", true).order("sort").order("name"),
    supabase.from("lab_customer_prices").select("product_id, price_try, price_eur").eq("customer_id", id),
    supabase.from("companies").select("name, address, phone, email").eq("id", s.companyId).maybeSingle(),
  ]);
  const sp2 = new Map((specials ?? []).map((x) => [x.product_id as string, x]));
  const eur = c.currency === "EUR";
  const disc = Number(c.discount_pct ?? 0);
  const rows = (prods ?? []).map((p) => {
    const sx = sp2.get(p.id as string);
    const special = eur ? sx?.price_eur : sx?.price_try;
    const list = (eur ? p.price_eur : p.price_try) as number | null;
    const price = special ?? (list != null ? Math.round(list * (100 - disc) / 100) : null);
    return { id: p.id as string, name: p.name as string, material: p.material as string | null, price, special: special != null };
  }).filter((r) => r.price != null);
  const cell = "border border-[#9AA7B4] px-2 py-1";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11.5px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/hekimler/${id}`} className="font-semibold text-[#0A3D73]">← Müşteri kartı</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={`/yazdir/fiyat-listesi/${id}?dil=${l}`} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}</span>
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-4">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-12 h-12 object-contain" />
            <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[80mm]">{co?.address ?? ""}</div><div className="text-[10px]">{[co?.phone, co?.email].filter(Boolean).join(" · ")}</div></div>
          </div>
          <div className="text-right"><div className="text-[17px] font-bold">{t.title}</div><div><b>{t.date}:</b> {docDate(today, lang)}</div>{(c.contract_start || c.contract_end) && <div><b>{t.valid}:</b> {c.contract_start ? docDate(c.contract_start, lang) : ""} – {c.contract_end ? docDate(c.contract_end, lang) : ""}</div>}</div>
        </header>
        <section><div className="text-[10px] uppercase tracking-wider text-[#666]">{t.for}</div><div className="text-[14px] font-bold">{c.name}</div>{disc > 0 && <div>{t.disc}: %{disc}</div>}<div>{t.term}: {c.payment_term_days ?? 30} {t.days}</div></section>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left`}>{t.product}</th><th className={`${cell} text-right w-36`}>{t.price}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className={cell}>{r.name}{r.material ? <span className="text-[10px] text-[#555]"> · {r.material}</span> : null}</td><td className={`${cell} text-right font-semibold`}>{docMoney(r.price, c.currency, lang)}{r.special && <div className="text-[9px] font-normal text-[#0A3D73]">{t.special}</div>}</td></tr>)}</tbody>
        </table>
        {c.contract_note && <p><b>{t.note}:</b> {c.contract_note}</p>}
      </div>
    </main>
  );
}
