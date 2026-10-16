import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { StatementDoc } from "../StatementDoc";

export const dynamic = "force-dynamic";

/** Ay sonu fatura (A4): dönemin irsaliyeleri ve işleri, müşterinin dilinde. ?dil=tr|en|fr ?ozet=1 (yalnız irsaliye toplamları) */
export default async function StatementPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dil?: string; ozet?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: st } = await supabase.from("lab_statements").select("id, lang, status").eq("id", id).maybeSingle();
  if (!st) notFound();
  const lang = ["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil! : st.lang;
  const brief = sp.ozet === "1";
  const qs = (p: Record<string, string>) => `/yazdir/ic-fatura/${id}?${new URLSearchParams({ dil: lang, ...(brief ? { ozet: "1" } : {}), ...p })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href="/isler/aylik-fatura" className="font-semibold text-[#0A3D73]">← Aylık faturalama</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}</span>
        <Link href={brief ? `/yazdir/ic-fatura/${id}?dil=${lang}` : qs({ ozet: "1" })} className="text-sm font-semibold text-[#0A3D73]">{brief ? "Ayrıntılı" : "Yalnız irsaliye toplamları"}</Link>
        {st.status === "cancelled" && <span className="text-sm font-bold text-[#B42318]">İPTAL EDİLDİ</span>}
      </div>
      <StatementDoc id={id} companyId={s.companyId} lang={lang} brief={brief} />
    </main>
  );
}
