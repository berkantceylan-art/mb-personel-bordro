import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { WaybillDoc } from "../WaybillDoc";

export const dynamic = "force-dynamic";

/** Sevk irsaliyesi / günlük teslim listesi (A4) — müşterinin dilinde. ?fiyat=0 fiyatsız, ?dil=tr|en|fr */
export default async function WaybillPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fiyat?: string; dil?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: w } = await supabase.from("lab_waybills").select("id, lab_customers(doc_lang)").eq("id", id).maybeSingle();
  if (!w) notFound();
  const c = w.lab_customers as unknown as { doc_lang: string | null } | null;
  const lang = ["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil! : (c?.doc_lang ?? "tr");
  const price = sp.fiyat !== "0";
  const qs = (p: Record<string, string>) => `/yazdir/irsaliye/${id}?${new URLSearchParams({ ...(price ? {} : { fiyat: "0" }), dil: lang, ...p })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11.5px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/irsaliye/${id}`} className="font-semibold text-[#0A3D73]">← İrsaliye</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}</span>
        <Link href={`/yazdir/beyan?irsaliye=${id}`} className="text-sm font-semibold text-[#0A3D73]">Uygunluk beyanları</Link>
        <Link href={price ? qs({ fiyat: "0" }) : `/yazdir/irsaliye/${id}?dil=${lang}`} className="text-sm font-semibold text-[#0A3D73]">{price ? "Fiyatsız" : "Fiyatlı"}</Link>
      </div>
      <WaybillDoc id={id} companyId={s.companyId} lang={lang} price={price} />
    </main>
  );
}
