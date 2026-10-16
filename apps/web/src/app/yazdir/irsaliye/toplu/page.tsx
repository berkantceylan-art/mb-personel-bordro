import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { WaybillDoc } from "../WaybillDoc";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Günün tüm irsaliyelerini tek seferde yazdır: ?gun=YYYY-MM-DD&fiyat=0&dil=tr|en|fr (dil boşsa her müşteri kendi dilinde) */
export default async function WaybillsBulkPrint({ searchParams }: { searchParams: Promise<{ gun?: string; fiyat?: string; dil?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : today;
  const lang = ["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil! : null;
  const price = sp.fiyat !== "0";
  const supabase = await createClient();
  const { data } = await supabase.from("lab_waybills").select("id").eq("ship_date", day).neq("status", "cancelled").order("created_at");
  const ids = (data ?? []).map((w) => w.id as string);
  const qs = (p: Record<string, string | null>) => `/yazdir/irsaliye/toplu?${new URLSearchParams(Object.entries({ gun: day, fiyat: price ? null : "0", dil: lang, ...p }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11.5px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3 z-10">
        <Link href={`/isler/irsaliye?gun=${day}`} className="font-semibold text-[#0A3D73]">← Günlük irsaliyeler</Link>
        <PrintButton />
        <b className="text-sm">{ids.length} irsaliye</b>
        <span className="flex gap-1 text-sm">
          <Link href={qs({ dil: null })} className={`px-2.5 py-1 rounded-full border ${!lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>Müşterinin dili</Link>
          {(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}
        </span>
        <Link href={qs({ fiyat: price ? "0" : null })} className="text-sm font-semibold text-[#0A3D73]">{price ? "Fiyatsız" : "Fiyatlı"}</Link>
      </div>
      {ids.map((id, i) => <WaybillDoc key={id} id={id} companyId={s.companyId} lang={lang} price={price} breakAfter={i < ids.length - 1} />)}
      {!ids.length && <p className="text-center p-10 text-[14px]">Bu gün irsaliye yok.</p>}
    </main>
  );
}
