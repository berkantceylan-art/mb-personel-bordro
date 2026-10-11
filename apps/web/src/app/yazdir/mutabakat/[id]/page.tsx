import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { SITE_URL } from "@/lib/handoff";
import { RECON, reconDate, reconLang, reconMoney } from "@/lib/recon-text";

export const dynamic = "force-dynamic";

/** Mutabakat mektubu (A4), carinin belge dilinde. ?dil=tr|en|fr */
export default async function ReconPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dil?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: r } = await supabase.from("fin_reconciliations").select("*, fin_parties(name, address, city, country, tax_office, tax_no, lab_customers(doc_lang))").eq("id", id).maybeSingle();
  if (!r) notFound();
  const p = r.fin_parties as { name: string; address: string | null; city: string | null; country: string | null; tax_office: string | null; tax_no: string | null; lab_customers: { doc_lang: string | null } | null } | null;
  const lang = reconLang(sp.dil ?? p?.lab_customers?.doc_lang);
  const t = RECON[lang];
  const { data: co } = await supabase.from("companies").select("name, address, phone, tax_office, tax_no").eq("id", s.companyId).maybeSingle();
  const bal = Number(r.balance);
  const link = `${SITE_URL}/${lang}/mutabakat/${r.token}`;
  const box = "border border-black p-3";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A4; margin: 15mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href="/finans/mutabakat" className="font-semibold text-[#0A3D73]">← Mutabakat</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={`/yazdir/mutabakat/${id}?dil=${l}`} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}</span>
      </div>
      <div className="max-w-[180mm] mx-auto bg-white my-6 print:my-0 p-8 print:p-0 flex flex-col gap-5">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex gap-3 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-12 h-12 object-contain" />
            <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[80mm]">{co?.address ?? ""}{co?.phone ? ` · ${co.phone}` : ""}</div>{co?.tax_no && <div className="text-[10px]">{co.tax_office ?? ""} {co.tax_no}</div>}</div>
          </div>
          <div className="text-right"><div className="text-[17px] font-bold">{t.title}</div><div>{reconDate(r.as_of, lang)}</div></div>
        </header>
        <div><b>{p?.name}</b>{p?.address && <div>{p.address}{p.city ? `, ${p.city}` : ""}</div>}{p?.tax_no && <div>{p.tax_office ?? ""} {p.tax_no}</div>}</div>
        <p>{t.intro(co?.name ?? "MB DENTAL", reconDate(r.as_of, lang))}</p>
        <div className={`${box} flex justify-between items-center text-[14px]`}><span>{bal > 0 ? t.owe_us : bal < 0 ? t.we_owe : t.zero}</span><b className="text-[18px]">{reconMoney(bal, r.currency, lang)}</b></div>
        <p>{t.ask}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className={box}>☐ {t.confirm}</div>
          <div className={box}>☐ {t.dispute} — {t.their}: ....................</div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div><div className="border-t border-black pt-1">{co?.name}</div></div>
          <div><div className="border-t border-black pt-1">{p?.name} · {t.name}</div></div>
        </div>
        <p className="text-[10px]">{t.footer}</p>
        <p className="text-[10px] break-all">Online: {link}</p>
      </div>
    </main>
  );
}
