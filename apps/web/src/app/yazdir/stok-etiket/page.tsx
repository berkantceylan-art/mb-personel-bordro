import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Raf / kutu etiketi (A4, 3 sütun): QR içinde barkod ya da stok kodu bulunur; sayımda ve transferde telefonla okutulur. ?ids=a,b&adet=2 */
export default async function StockLabels({ searchParams }: { searchParams: Promise<{ ids?: string; adet?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 200);
  const copies = Math.min(20, Math.max(1, Number(sp.adet) || 1));
  const supabase = await createClient();
  const { data } = ids.length ? await supabase.from("stk_items").select("id, code, barcode, name, unit, shelf, brand").in("id", ids) : { data: [] };
  type R = { id: string; code: string; barcode: string | null; name: string; unit: string; shelf: string | null; brand: string | null };
  const rows = ((data ?? []) as R[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const labels = await Promise.all(rows.map(async (r) => ({ ...r, svg: await QRCode.toString(r.barcode || r.code, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) })));
  const all = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.id}-${i}` })));
  const back = ids.length === 1 ? `/stok/urunler/${ids[0]}` : "/stok/urunler";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-black">
      <style>{`@page { size: A4; margin: 8mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={back} className="font-semibold text-[#0A3D73]">← Geri</Link>
        <PrintButton />
        <span className="text-sm text-[#5A6B7D]">{rows.length} kart × {copies} adet</span>
        <span className="ml-auto flex gap-2 text-sm">
          {[1, 2, 3, 6].map((n) => <Link key={n} href={`/yazdir/stok-etiket?ids=${ids.join(",")}&adet=${n}`} className={`px-2.5 py-1 rounded-full border ${n === copies ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{n} adet</Link>)}
        </span>
      </div>
      {all.length === 0 && <p className="p-8 text-center">Etiket için kart seçilmedi.</p>}
      <div className="mx-auto my-6 print:m-0 bg-white w-[194mm] grid grid-cols-3 gap-[2mm] p-[2mm] print:p-0">
        {all.map((l) => (
          <div key={l.key} className="h-[36mm] border border-[#9AA7B4] rounded-[2mm] p-[2.5mm] flex gap-[2.5mm] items-center break-inside-avoid overflow-hidden">
            <div className="w-[28mm] h-[28mm] shrink-0 [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="min-w-0 flex flex-col gap-[1mm] text-[9pt] leading-tight">
              <b className="text-[10pt] line-clamp-3">{l.name}</b>
              {l.brand && <span className="text-[8pt]">{l.brand}</span>}
              <span className="font-mono text-[8pt]">{l.code}</span>
              {l.barcode && <span className="font-mono text-[7pt] break-all">{l.barcode}</span>}
              <span className="text-[8pt]">{l.unit}{l.shelf ? ` · Raf ${l.shelf}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
