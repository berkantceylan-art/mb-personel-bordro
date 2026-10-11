import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ASSET_CATS } from "@/lib/barcode";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demirbaş QR etiketleri" };

/** Demirbaş QR etiketleri (A4'e 3×8 yazdırılır); telefonla okutunca demirbaş kartı açılır, sayımda okunur */
export default async function AssetLabels({ searchParams }: { searchParams: Promise<{ q?: string; loc?: string; cat?: string }> }) {
  const s = await getSession();
  if ((s.modules.assets ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const supabase = await createClient();
  let qb = supabase.from("assets").select("id, code, name, location, category").not("status", "in", "(RETIRED,LOST)").order("location").order("name").limit(600);
  if (sp.loc) qb = qb.ilike("location", `%${sp.loc}%`);
  if (sp.cat) qb = qb.eq("category", sp.cat);
  if (sp.q) qb = qb.or(`name.ilike.%${sp.q.replace(/[%,()]/g, " ")}%,code.ilike.%${sp.q.replace(/[%,()]/g, " ")}%`);
  const [{ data }, { data: co }] = await Promise.all([qb, supabase.from("companies").select("name").eq("id", s.companyId).maybeSingle()]);
  const rows = (data ?? []) as { id: string; code: string | null; name: string; location: string | null; category: string }[];
  const qrs = await Promise.all(rows.map((a) => QRCode.toString(`${origin}/demirbas/${a.id}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" })));
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Demirbaş QR etiketleri" subtitle={`${rows.length} etiket · A4 yapışkan etiket (3 × 8) için yazdırın`} actions={<PrintButton />} />
        <form className="flex flex-wrap gap-2 px-4 py-3 md:px-8">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Ad / kod" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
          <input name="loc" defaultValue={sp.loc ?? ""} placeholder="Konum" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
          <select name="cat" defaultValue={sp.cat ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-sm"><option value="">Tüm kategoriler</option>{Object.entries(ASSET_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Filtrele</button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 print:grid-cols-3 print:gap-0 print:p-0">
        {rows.map((a, i) => (
          <div key={a.id} className="flex h-[35mm] items-center gap-2 overflow-hidden rounded-lg border border-line bg-white p-2 print:rounded-none print:border-dashed print:break-inside-avoid">
            <span className="h-[28mm] w-[28mm] shrink-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrs[i]! }} />
            <span className="min-w-0 text-[11px] leading-tight">
              <b className="block truncate text-[12px]">{a.name}</b>
              <span className="block font-mono text-[13px] font-bold">{a.code ?? a.id.slice(0, 8)}</span>
              <span className="block truncate text-[#555]">{[ASSET_CATS[a.category], a.location].filter(Boolean).join(" · ")}</span>
              <span className="mt-1 block truncate text-[9px] text-[#777]">{co?.name ?? ""} · Demirbaştır</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
