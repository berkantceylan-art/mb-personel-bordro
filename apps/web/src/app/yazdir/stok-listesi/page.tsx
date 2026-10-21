import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { loadItems } from "@/lib/stock-data";
import { ITEM_KIND } from "@/lib/stock";

export const dynamic = "force-dynamic";
const n3 = (v: number) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const tl = (k: number) => (Number(k) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Stok listesi yazdır (A4 yatay): kart ekranındaki filtrelerle; sayım için boş "Sayılan" sütunu. ?q=&tur=&kat=&durum=&sayim=1 */
export default async function StockListPrint({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string; kat?: string; durum?: string; sayim?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const sb = await createClient();
  const [{ rows }, { data: co }, { data: cats }] = await Promise.all([loadItems(), sb.from("companies").select("name").eq("id", s.companyId).maybeSingle(), sb.from("stk_categories").select("id, name")]);
  const catName = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const shown = rows.filter((i) =>
    (!sp.tur || i.kind === sp.tur) && (!sp.kat || i.category_id === sp.kat) &&
    (sp.durum !== "az" || (i.min_qty !== null && i.qty < Number(i.min_qty))) && (sp.durum !== "eksi" || i.qty < 0) && (sp.durum !== "pasif" ? i.is_active : !i.is_active) &&
    (!q || `${i.name} ${i.code} ${i.barcode ?? ""} ${i.brand ?? ""}`.toLocaleLowerCase("tr").includes(q))).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const count = sp.sayim === "1";
  const cell = "border border-[#9AA7B4] px-1.5 py-1";
  const base = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "sayim") as [string, string][]);
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10).split("-").reverse().join(".");
  const value = shown.reduce((a, i) => a + Number((i as { value?: number }).value ?? 0), 0);
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[10.5px] text-black">
      <style>{`@page { size: A4 landscape; margin: 9mm; } thead { display: table-header-group; } tr { break-inside: avoid; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/stok/urunler${base.toString() ? `?${base}` : ""}`} className="font-semibold text-[#0A3D73]">← Kartlar</Link>
        <PrintButton />
        <Link href={`/yazdir/stok-listesi?${new URLSearchParams([...base.entries(), ...(count ? [] : [["sayim", "1"]])])}`} className="font-semibold text-[#0A3D73]">{count ? "Normal liste" : "Sayım formu (boş sütunlu)"}</Link>
        <span>{shown.length} kart</span>
      </div>
      <div className="mx-auto my-6 print:my-0 bg-white w-[297mm] max-w-full p-[9mm] print:p-0 shadow print:shadow-none">
        <div className="flex justify-between border-b-2 border-black pb-1 mb-2">
          <p className="text-base font-bold">{co?.name ?? "MB Dental"} · {count ? "STOK SAYIM FORMU" : "STOK LİSTESİ"}</p>
          <p>{today} · {shown.length} kart{count ? "" : ` · stok değeri ${tl(value)} ₺`}</p>
        </div>
        <table className="w-full border-collapse">
          <thead><tr className="bg-black/5">
            <th className={cell}>#</th><th className={cell}>Kod</th><th className={cell}>Ürün / malzeme</th><th className={cell}>Tür / kategori</th><th className={cell}>Birim</th>
            <th className={`${cell} text-right`}>Stok</th>{count ? <><th className={`${cell} w-[22mm]`}>Sayılan</th><th className={`${cell} w-[30mm]`}>Not</th></> : <><th className={`${cell} text-right`}>Asgari</th><th className={`${cell} text-right`}>Ort. maliyet ₺</th><th className={`${cell} text-right`}>Değer ₺</th></>}
          </tr></thead>
          <tbody>
            {shown.map((i, k) => (
              <tr key={i.id}>
                <td className={cell}>{k + 1}</td><td className={cell}>{i.code}</td><td className={cell}>{i.name}</td>
                <td className={cell}>{ITEM_KIND[i.kind] ?? i.kind}{i.category_id ? ` · ${catName.get(i.category_id) ?? ""}` : ""}</td><td className={cell}>{i.unit}</td>
                <td className={`${cell} text-right font-semibold`}>{n3(i.qty)}</td>
                {count ? <><td className={cell} /><td className={cell} /></> : <><td className={`${cell} text-right`}>{i.min_qty != null ? n3(Number(i.min_qty)) : ""}</td><td className={`${cell} text-right`}>{tl(Number((i as { avg_cost?: number }).avg_cost ?? 0))}</td><td className={`${cell} text-right`}>{tl(Number((i as { value?: number }).value ?? 0))}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
