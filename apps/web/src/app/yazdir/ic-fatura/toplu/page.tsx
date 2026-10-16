import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { StatementDoc } from "../StatementDoc";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ayın kesilmiş tüm faturalarını tek seferde yazdır: ?ay=YYYY-MM&ozet=1&dil=tr|en|fr (dil boşsa her fatura kendi dilinde) */
export default async function StatementsBulkPrint({ searchParams }: { searchParams: Promise<{ ay?: string; ozet?: string; dil?: string; id?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const ym = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const from = `${ym}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const lang = ["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil! : null;
  const brief = sp.ozet === "1";
  const supabase = await createClient();
  const { data } = await supabase.from("lab_statements").select("id").eq("status", "issued").lte("period_from", to).gte("period_to", from).order("no");
  const only = (sp.id ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const ids = only.length ? only : (data ?? []).map((x) => x.id as string);
  const qs = (p: Record<string, string | null>) => `/yazdir/ic-fatura/toplu?${new URLSearchParams(Object.entries({ ay: ym, id: only.length ? only.join(",") : null, ozet: brief ? "1" : null, dil: lang, ...p }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3 z-10">
        <Link href={`/isler/aylik-fatura?ay=${ym}`} className="font-semibold text-[#0A3D73]">← Aylık faturalama</Link>
        <PrintButton />
        <b className="text-sm">{ids.length} fatura</b>
        <span className="flex gap-1 text-sm">
          <Link href={qs({ dil: null })} className={`px-2.5 py-1 rounded-full border ${!lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>Müşterinin dili</Link>
          {(["tr", "en", "fr"] as const).map((l) => <Link key={l} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${l === lang ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l.toUpperCase()}</Link>)}
        </span>
        <Link href={qs({ ozet: brief ? null : "1" })} className="text-sm font-semibold text-[#0A3D73]">{brief ? "Ayrıntılı" : "Yalnız irsaliye toplamları"}</Link>
      </div>
      {ids.map((id, i) => <StatementDoc key={id} id={id} companyId={s.companyId} lang={lang} brief={brief} breakAfter={i < ids.length - 1} />)}
      {!ids.length && <p className="text-center p-10 text-[14px]">Bu ay kesilmiş fatura yok.</p>}
    </main>
  );
}
