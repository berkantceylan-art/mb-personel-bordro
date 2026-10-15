import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

/** Muhasebe çıktıları için ortak A4 çerçeve: üst araç çubuğu (ekranda), şirket başlığı, sayfa yönü */
export async function PrintShell({ title, sub, back, landscape, tools, children }: { title: string; sub?: string; back: string; landscape?: boolean; tools?: React.ReactNode; children: React.ReactNode }) {
  const s = await getSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("companies").select("name, address, tax_office, tax_no").eq("id", s.companyId).maybeSingle();
  const co = (c ?? {}) as { name?: string; address?: string | null; tax_office?: string | null; tax_no?: string | null };
  const now = new Date(Date.now() + 3 * 3600000);
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href={back} className="font-semibold text-[#0A3D73]">← Geri</Link>
        {tools}
        <div className="ml-auto"><PrintButton /></div>
      </div>
      <div className={`${landscape ? "max-w-[277mm]" : "max-w-[190mm]"} mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-3`}>
        <header className="flex justify-between gap-4 border-b-2 border-black pb-2">
          <div>
            <div className="text-[14px] font-bold uppercase">{co.name ?? ""}</div>
            <div className="text-[10px]">{[co.address, co.tax_no ? `VD: ${co.tax_office ?? ""} · VKN ${co.tax_no}` : null].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="text-right">
            <div className="text-[14px] font-bold">{title}</div>
            {sub && <div className="text-[10px]">{sub}</div>}
            <div className="text-[9px] text-[#555]">Yazdırma: {now.toISOString().slice(0, 16).replace("T", " ")}</div>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

export const pcell = "border border-[#9AA7B4] px-1.5 py-0.5";
export const pnum = `${pcell} text-right tabular-nums whitespace-nowrap`;
export const pdate = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "");
export const pmoney = (v: number | string | null | undefined) => (Number(v ?? 0) === 0 ? "" : (Number(v) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Ekranda dönem seçimi (yazıcıda gizli) */
export function PeriodTools({ from, to, extra }: { from: string; to: string; extra?: Record<string, string | null | undefined> }) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input type="date" name="bas" defaultValue={from} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Başlangıç" />
      <input type="date" name="bit" defaultValue={to} className="h-9 rounded border border-[#D5DEE8] px-2" aria-label="Bitiş" />
      <button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">Uygula</button>
    </form>
  );
}
