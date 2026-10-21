import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { MOVE_KIND, ITEM_KIND, type Item } from "@/lib/stock";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const n3 = (v: number) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const tl = (k: number) => `${(Number(k) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const cur = (k: number | null, c: string | null) => (k == null ? "—" : `${(Number(k) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${c === "EUR" ? "€" : c === "USD" ? "$" : "₺"}`);
const day = (d: string) => d.slice(0, 10).split("-").reverse().join(".");

type Mv = { id: number; item_id: string; move_date: string; qty: number; unit_cost: number; kind: string; warehouse_id: string; lot_no: string | null; note: string | null; doc_type: string | null };

/** Stok kartı yazdır (A4): kart bilgileri, depo bazında stok, tarih aralığında hareketler ve yürüyen bakiye. ?ids=a,b&bas=2026-01-01&bit=2026-10-22 */
export default async function StockCardPrint({ searchParams }: { searchParams: Promise<{ ids?: string; bas?: string; bit?: string; hareket?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 100);
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const iso = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null);
  const to = iso(sp.bit) ?? today;
  const from = iso(sp.bas) ?? `${today.slice(0, 4)}-01-01`;
  const withMoves = sp.hareket !== "0";
  const sb = await createClient();
  const [{ data: items }, { data: whs }, { data: tots }, { data: co }] = await Promise.all([
    ids.length ? sb.from("stk_items").select("*").in("id", ids) : Promise.resolve({ data: [] }),
    sb.from("stk_warehouses").select("id, name"),
    ids.length ? sb.from("stk_item_totals").select("item_id, qty, avg_cost, value").in("item_id", ids) : Promise.resolve({ data: [] }),
    sb.from("companies").select("name").eq("id", s.companyId).maybeSingle(),
  ]);
  const list = ((items ?? []) as Item[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const wname = new Map(((whs ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  const tot = new Map(((tots ?? []) as { item_id: string; qty: number; avg_cost: number; value: number }[]).map((t) => [t.item_id, t]));
  // hareketler: aralık öncesi devir + aralık içi
  const moves: Mv[] = [];
  if (ids.length) {
    for (let k = 0; k < 100000; k += 1000) {
      const { data } = await sb.from("stk_moves").select("id, item_id, move_date, qty, unit_cost, kind, warehouse_id, lot_no, note, doc_type").in("item_id", ids).lte("move_date", to).order("move_date").order("id").range(k, k + 999);
      moves.push(...((data ?? []) as Mv[]));
      if (!data || data.length < 1000) break;
    }
  }
  const supIds = [...new Set(list.map((i) => (i as { supplier_party_id?: string | null }).supplier_party_id).filter(Boolean))] as string[];
  const { data: sups } = supIds.length ? await sb.from("fin_parties").select("id, name").in("id", supIds) : { data: [] };
  const supName = new Map(((sups ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const cell = "border border-[#9AA7B4] px-1.5 py-1";
  const qs = (p: Record<string, string>) => `/yazdir/stok-karti?${new URLSearchParams({ ids: ids.join(","), bas: from, bit: to, ...(withMoves ? {} : { hareket: "0" }), ...p })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 10mm; } .card + .card { break-before: page; }`}</style>
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href={ids.length === 1 ? `/stok/urunler/${ids[0]}` : "/stok/urunler"} className="font-semibold text-[#0A3D73]">← Stok</Link>
        <PrintButton />
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="ids" value={ids.join(",")} />
          <label>Başlangıç <input type="date" name="bas" defaultValue={from} className="h-8 border rounded px-1" /></label>
          <label>Bitiş <input type="date" name="bit" defaultValue={to} className="h-8 border rounded px-1" /></label>
          {!withMoves && <input type="hidden" name="hareket" value="0" />}
          <button className="h-8 px-3 rounded bg-[#0A3D73] text-white font-semibold">Uygula</button>
        </form>
        <Link href={withMoves ? qs({ hareket: "0" }) : `/yazdir/stok-karti?${new URLSearchParams({ ids: ids.join(","), bas: from, bit: to })}`} className="font-semibold text-[#0A3D73]">{withMoves ? "Hareketsiz (yalnız kart)" : "Hareketlerle"}</Link>
        <span className="text-muted">{list.length} kart</span>
      </div>
      {list.map((it) => {
        const t = tot.get(it.id);
        const mv = moves.filter((m) => m.item_id === it.id);
        const opening = mv.filter((m) => m.move_date < from).reduce((a, m) => a + Number(m.qty), 0);
        const inRange = mv.filter((m) => m.move_date >= from);
        const byWh = new Map<string, number>();
        for (const m of mv) byWh.set(m.warehouse_id, (byWh.get(m.warehouse_id) ?? 0) + Number(m.qty));
        let bal = opening;
        const ins = inRange.filter((m) => Number(m.qty) > 0).reduce((a, m) => a + Number(m.qty), 0);
        const outs = inRange.filter((m) => Number(m.qty) < 0).reduce((a, m) => a + Number(m.qty), 0);
        const x = it as Item & { supplier_party_id?: string | null; purchase_price?: number | null; purchase_currency?: string | null; shelf?: string | null; brand?: string | null };
        return (
          <section key={it.id} className="card mx-auto my-6 print:my-0 bg-white w-[210mm] max-w-full p-[10mm] print:p-0 shadow print:shadow-none">
            <div className="flex justify-between items-start border-b-2 border-black pb-2 mb-3">
              <div><p className="text-base font-bold">{co?.name ?? "MB Dental"}</p><p>STOK KARTI</p></div>
              <div className="text-right"><p className="text-lg font-bold">{it.code}</p><p>Yazdırma: {day(today)}</p></div>
            </div>
            <table className="w-full border-collapse mb-3">
              <tbody>
                <tr><td className={`${cell} font-semibold w-[22%]`}>Ürün / malzeme</td><td className={cell} colSpan={3}><b className="text-[13px]">{it.name}</b></td></tr>
                <tr><td className={`${cell} font-semibold`}>Tür</td><td className={cell}>{ITEM_KIND[it.kind] ?? it.kind}</td><td className={`${cell} font-semibold w-[18%]`}>Birim</td><td className={cell}>{it.unit}</td></tr>
                <tr><td className={`${cell} font-semibold`}>Barkod</td><td className={cell}>{it.barcode ?? "—"}</td><td className={`${cell} font-semibold`}>Marka / raf</td><td className={cell}>{[x.brand, x.shelf].filter(Boolean).join(" · ") || "—"}</td></tr>
                <tr><td className={`${cell} font-semibold`}>Tedarikçi</td><td className={cell}>{x.supplier_party_id ? supName.get(x.supplier_party_id) ?? "—" : "—"}</td><td className={`${cell} font-semibold`}>Alış fiyatı</td><td className={cell}>{cur(x.purchase_price ?? null, x.purchase_currency ?? "TRY")}</td></tr>
                <tr><td className={`${cell} font-semibold`}>Toplam stok</td><td className={cell}><b>{n3(Number(t?.qty ?? 0))} {it.unit}</b>{it.min_qty != null ? ` (asgari ${n3(Number(it.min_qty))})` : ""}</td><td className={`${cell} font-semibold`}>Ort. maliyet / değer</td><td className={cell}>{tl(Number(t?.avg_cost ?? 0))} · {tl(Number(t?.value ?? 0))}</td></tr>
              </tbody>
            </table>
            {byWh.size > 0 && (
              <p className="mb-3"><b>Depolar:</b> {[...byWh.entries()].filter(([, q]) => q !== 0).map(([w, q]) => `${wname.get(w) ?? "Depo"}: ${n3(q)} ${it.unit}`).join(" · ") || "stok yok"}</p>
            )}
            {withMoves && (
              <>
                <p className="mb-1"><b>Hareketler {day(from)} – {day(to)}</b> · devir {n3(opening)} · giriş {n3(ins)} · çıkış {n3(-outs)} · kalan {n3(opening + ins + outs)} {it.unit}</p>
                <table className="w-full border-collapse">
                  <thead><tr className="bg-black/5"><th className={cell}>Tarih</th><th className={cell}>Hareket</th><th className={cell}>Depo</th><th className={cell}>Açıklama</th><th className={`${cell} text-right`}>Giriş</th><th className={`${cell} text-right`}>Çıkış</th><th className={`${cell} text-right`}>Bakiye</th><th className={`${cell} text-right`}>Birim maliyet</th></tr></thead>
                  <tbody>
                    <tr><td className={cell}>{day(from)}</td><td className={cell} colSpan={5}>Devir</td><td className={`${cell} text-right font-semibold`}>{n3(opening)}</td><td className={cell} /></tr>
                    {inRange.map((m) => { bal += Number(m.qty); return (
                      <tr key={m.id}>
                        <td className={cell}>{day(m.move_date)}</td>
                        <td className={cell}>{MOVE_KIND[m.kind]?.[0] ?? m.kind}</td>
                        <td className={cell}>{wname.get(m.warehouse_id) ?? ""}</td>
                        <td className={cell}>{[m.lot_no ? `Lot ${m.lot_no}` : "", m.note ?? ""].filter(Boolean).join(" · ")}</td>
                        <td className={`${cell} text-right`}>{Number(m.qty) > 0 ? n3(m.qty) : ""}</td>
                        <td className={`${cell} text-right`}>{Number(m.qty) < 0 ? n3(-m.qty) : ""}</td>
                        <td className={`${cell} text-right font-semibold`}>{n3(bal)}</td>
                        <td className={`${cell} text-right`}>{m.unit_cost ? tl(m.unit_cost) : ""}</td>
                      </tr>); })}
                    {inRange.length === 0 && <tr><td className={`${cell} text-center`} colSpan={8}>Bu aralıkta hareket yok.</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </section>
        );
      })}
      {list.length === 0 && <p className="p-8 text-center">Kart seçilmedi.</p>}
    </main>
  );
}
