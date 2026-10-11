import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ASSET_CATEGORY } from "@/lib/ozluk-docs";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** Demirbaş QR etiketi (A4, 4 sütun): okutunca demirbaş kartı açılır */
export default async function AssetLabels({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const s = await getSession();
  if ((s.modules.assets ?? 0) < 1 && !["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const ids = ((await searchParams).ids ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 200);
  const supabase = await createClient();
  const { data } = ids.length ? await supabase.from("assets").select("id, code, name, category, serial_no, location").in("id", ids) : { data: [] };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const { data: co } = await supabase.from("companies").select("name").order("created_at").limit(1).maybeSingle();
  const rows = await Promise.all(((data ?? []) as { id: string; code: string | null; name: string; category: string; serial_no: string | null; location: string | null }[])
    .map(async (a) => ({ ...a, svg: await QRCode.toString(`${origin}/demirbas/${a.id}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) })));
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-black">
      <style>{`@page { size: A4; margin: 8mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex items-center gap-3">
        <Link href="/demirbas" className="font-semibold text-[#0A3D73]">← Demirbaş</Link>
        <PrintButton />
        <span className="text-sm text-[#5A6B7D]">{rows.length} etiket</span>
      </div>
      <div className="mx-auto my-6 print:m-0 bg-white w-[194mm] grid grid-cols-4 gap-[2mm] p-[2mm] print:p-0">
        {rows.map((a) => (
          <div key={a.id} className="h-[30mm] border border-[#9AA7B4] rounded-[2mm] p-[2mm] flex gap-[2mm] items-center break-inside-avoid overflow-hidden">
            <div className="w-[24mm] h-[24mm] shrink-0 [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: a.svg }} />
            <div className="min-w-0 flex flex-col text-[7.5pt] leading-tight gap-[0.5mm]">
              <span className="text-[6.5pt] uppercase text-[#5A6B7D] truncate">{co?.name ?? "Demirbaş"}</span>
              <b className="text-[8.5pt] line-clamp-2">{a.name}</b>
              <span className="font-mono">{a.code ?? ""}</span>
              <span className="truncate">{ASSET_CATEGORY[a.category] ?? ""}{a.serial_no ? ` · ${a.serial_no}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
