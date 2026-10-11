import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Money, Notice, Table, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateOk } from "@/lib/fin";
import { loadWarehouses } from "@/lib/stock-data";
import { MOVE_KIND, qty } from "@/lib/stock";

export const dynamic = "force-dynamic";

type SP = { depo?: string; tur?: string; ara?: string; bas?: string; bit?: string };

/** Stok hareket defteri: tüm giriş-çıkışlar, filtreli */
export default async function MovesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const warehouses = await loadWarehouses();
  let itemIds: string[] | null = null;
  const term = (sp.ara ?? "").trim().slice(0, 60);
  if (term) {
    const safe = term.replace(/[%,()]/g, " ");
    const { data: found } = await supabase.from("stk_items").select("id").or(`name.ilike.%${safe}%,code.ilike.%${safe}%,barcode.eq.${safe}`).limit(200);
    itemIds = (found ?? []).map((r) => r.id as string);
  }
  let q = supabase.from("stk_moves").select("id, move_date, qty, unit_cost, lot_no, expiry_date, kind, doc_type, doc_id, job_id, note, warehouse_id, stk_items(id, code, name, unit), fin_parties(name)").order("move_date", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (sp.depo) q = q.eq("warehouse_id", sp.depo);
  if (sp.tur && MOVE_KIND[sp.tur]) q = q.eq("kind", sp.tur);
  if (dateOk(sp.bas)) q = q.gte("move_date", sp.bas!);
  if (dateOk(sp.bit)) q = q.lte("move_date", sp.bit!);
  if (itemIds) q = q.in("item_id", itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  type Row = { id: number; move_date: string; qty: number; unit_cost: number; lot_no: string | null; expiry_date: string | null; kind: string; doc_type: string | null; doc_id: string | null; job_id: string | null; note: string | null; warehouse_id: string; stk_items: { id: string; code: string; name: string; unit: string } | null; fin_parties: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const wh = new Map(warehouses.map((w) => [w.id, w.name]));
  const docHref = (r: Row) => r.doc_type === "transfer" && r.doc_id ? `/stok/transfer/${r.doc_id}` : r.doc_type === "count" && r.doc_id ? `/stok/sayim/${r.doc_id}` : r.job_id ? `/isler/${r.job_id}` : null;

  return (
    <>
      <PageHeader title="Stok hareketleri" subtitle="Son 500 hareket; filtreyle daraltın." />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        <form className="grid gap-2 grid-cols-2 md:grid-cols-6 items-end">
          <input name="ara" defaultValue={term} placeholder="Malzeme adı / kod / barkod" className={`${inputCls} col-span-2`} />
          <select name="depo" defaultValue={sp.depo ?? ""} className={selectCls}>
            <option value="">Tüm depolar</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select name="tur" defaultValue={sp.tur ?? ""} className={selectCls}>
            <option value="">Tüm türler</option>
            {Object.entries(MOVE_KIND).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input type="date" name="bas" defaultValue={sp.bas ?? ""} aria-label="Başlangıç" className={inputCls} />
          <div className="flex gap-2"><input type="date" name="bit" defaultValue={sp.bit ?? ""} aria-label="Bitiş" className={inputCls} /><button className={btnSecondary}>Süz</button></div>
        </form>
        <Table head={["Tarih", "Malzeme", "Depo", "Tür", "Lot / SKT", "Miktar", "Birim maliyet", "Tutar", "Belge / not"]} min={1080}>
          {rows.map((r) => {
            const q2 = Number(r.qty);
            const href = docHref(r);
            return (
              <tr key={r.id}>
                <td className={td}>{formatDate(r.move_date)}</td>
                <td className={td}>{r.stk_items && <Link href={`/stok/urunler/${r.stk_items.id}`} className="font-semibold text-brand-700">{r.stk_items.name}</Link>}<span className="block text-xs text-muted num">{r.stk_items?.code}</span></td>
                <td className={td}>{wh.get(r.warehouse_id) ?? ""}</td>
                <td className={td}><Chip tone={MOVE_KIND[r.kind]?.[1]}>{MOVE_KIND[r.kind]?.[0] ?? r.kind}</Chip></td>
                <td className={`${td} num text-xs`}>{r.lot_no ?? ""}{r.expiry_date ? ` · ${formatDate(r.expiry_date)}` : ""}</td>
                <td className={`${tdNum} ${q2 < 0 ? "text-bad" : "text-ok"}`}>{q2 > 0 ? "+" : ""}{qty(q2)} {r.stk_items?.unit}</td>
                <td className={tdNum}><Money v={r.unit_cost} /></td>
                <td className={tdNum}><Money v={Math.round(q2 * Number(r.unit_cost))} /></td>
                <td className={td}>
                  {href ? <Link href={href} className="text-brand-700 font-semibold">Belgeye git</Link> : null}
                  {r.fin_parties && <span className="block text-xs">{r.fin_parties.name}</span>}
                  {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={9} />}
        </Table>
      </div>
    </>
  );
}
