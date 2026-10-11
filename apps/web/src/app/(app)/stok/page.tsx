import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, Notice, page } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadItems, loadStock, loadWarehouses } from "@/lib/stock-data";
import { MOVE_KIND, qty } from "@/lib/stock";
import { fmt, today } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Stok özeti: değer, asgari stok altı, son kullanması yaklaşan lotlar, son hareketler */
export default async function StockHome() {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1) redirect("/");
  const [{ rows: items, error }, warehouses, stock] = await Promise.all([loadItems(), loadWarehouses(), loadStock()]);
  const supabase = await createClient();
  const { data: moves } = await supabase.from("stk_moves").select("id, move_date, qty, kind, item_id, warehouse_id, note").order("id", { ascending: false }).limit(12);
  const active = items.filter((i) => i.is_active && i.kind !== "service");
  const low = active.filter((i) => i.min_qty !== null && i.qty < Number(i.min_qty));
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const expiring = stock.filter((r) => r.expiry_date && r.expiry_date <= in30 && r.qty > 0).sort((a, b) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""));
  const value = active.reduce((a, i) => a + Math.max(0, i.value), 0);
  const iname = new Map(items.map((i) => [i.id, i]));
  const wname = new Map(warehouses.map((w) => [w.id, w.name]));
  const t = today();
  return (
    <>
      <PageHeader title="Stok" subtitle={`${active.length} kart · ${warehouses.length} depo`} actions={(s.modules.stock ?? 0) >= 2 ? <Link href="/stok/urunler#yeni" className="text-sm font-semibold text-brand-700">+ Yeni kart</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Stok değeri" value={fmt(value)} sub="ortalama maliyetle" />
          <KPI label="Asgari stok altı" value={low.length} tone={low.length ? "bad" : undefined} href="/stok/urunler?durum=az" />
          <KPI label="SKT 30 gün içinde" value={expiring.length} tone={expiring.length ? "bad" : undefined} />
          <KPI label="Eksi stok" value={active.filter((i) => i.qty < 0).length} href="/stok/urunler?durum=eksi" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Sipariş verilmesi gerekenler">
            <ul className="divide-y divide-[#EEF2F6]">
              {low.slice(0, 12).map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-2 text-sm">
                  <Link href={`/stok/urunler/${i.id}`} className="truncate text-brand-700">{i.name}</Link>
                  <span className="num whitespace-nowrap text-bad">{qty(i.qty)} / {qty(i.min_qty)} {i.unit}</span>
                </li>
              ))}
              {low.length === 0 && <li className="py-4 text-sm text-muted">Asgari stok altında kalem yok.</li>}
            </ul>
          </Card>
          <Card title="Son kullanma tarihi yaklaşanlar">
            <ul className="divide-y divide-[#EEF2F6]">
              {expiring.slice(0, 12).map((r, n) => (
                <li key={n} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="truncate"><Link href={`/stok/urunler/${r.item_id}`} className="text-brand-700">{iname.get(r.item_id)?.name}</Link> <span className="text-xs text-muted">lot {r.lot_no ?? "—"} · {wname.get(r.warehouse_id)}</span></span>
                  <span className={`num whitespace-nowrap ${r.expiry_date! < t ? "text-bad font-semibold" : "text-warn"}`}>{formatDate(r.expiry_date!)} · {qty(r.qty)}</span>
                </li>
              ))}
              {expiring.length === 0 && <li className="py-4 text-sm text-muted">Yaklaşan son kullanma yok.</li>}
            </ul>
          </Card>
          <Card title="Son hareketler" action={<Link href="/stok/hareketler" className="text-sm font-semibold text-brand-700">Tümü</Link>}>
            <ul className="divide-y divide-[#EEF2F6]">
              {(moves ?? []).map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="truncate"><span className="text-xs text-muted">{formatDate(m.move_date)} · {MOVE_KIND[m.kind]?.[0]}</span> {iname.get(m.item_id)?.name}</span>
                  <span className={`num whitespace-nowrap ${Number(m.qty) < 0 ? "text-bad" : "text-ok"}`}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)}</span>
                </li>
              ))}
              {(moves ?? []).length === 0 && <li className="py-4 text-sm text-muted">Hareket yok.</li>}
            </ul>
          </Card>
          <Card title="Depolar" action={<Link href="/stok/depolar" className="text-sm font-semibold text-brand-700">Yönet</Link>}>
            <ul className="divide-y divide-[#EEF2F6]">
              {warehouses.map((w) => {
                const val = stock.filter((r) => r.warehouse_id === w.id).reduce((a, r) => a + r.qty * (iname.get(r.item_id)?.avg_cost ?? 0), 0);
                return (
                  <li key={w.id} className="flex justify-between gap-3 py-2 text-sm">
                    <Link href={`/stok/depolar/${w.id}`} className="text-brand-700">{w.name}{w.is_default && <span className="ml-1.5 text-xs text-muted">varsayılan</span>}</Link>
                    <span className="num">{fmt(Math.round(val))}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
