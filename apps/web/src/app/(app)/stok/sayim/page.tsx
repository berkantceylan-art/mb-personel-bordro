import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Notice, Table, btnPrimary, inputCls, page, selectCls, td } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { startCount } from "@/lib/stock-actions";
import { loadCategories, loadWarehouses } from "@/lib/stock-data";
import { COUNT_STATUS } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Stok sayımları: yeni sayım başlat (kör sayım seçeneği), geçmiş sayımlar */
export default async function CountsPage() {
  const s = await getSession();
  const level = s.modules.stock ?? 0;
  if (level < 1) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, warehouses, categories] = await Promise.all([
    supabase.from("stk_counts").select("id, no, count_date, status, blind, note, closed_at, stk_warehouses(name), stk_categories(name), stk_count_lines(id, counted)").order("created_at", { ascending: false }).limit(200),
    loadWarehouses(),
    loadCategories(),
  ]);
  type Row = { id: string; no: number; count_date: string; status: string; blind: boolean; note: string | null; closed_at: string | null; stk_warehouses: { name: string } | null; stk_categories: { name: string } | null; stk_count_lines: { id: string; counted: number | null }[] };
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Stok sayımı" subtitle="Depo sayımı başlatın, telefonla barkod okutarak sayın, farkları tek tuşla stoğa işleyin." />
      <div className={page}>
        {error && <Notice tone="bad">Stok tabloları yok: Supabase&apos;de 20261203000000_stock.sql çalıştırın.</Notice>}
        {level >= 2 && (
          <form action={startCount} className="bg-white border border-line rounded-[14px] p-4 grid gap-4 md:grid-cols-4 items-end">
            <Field label="Depo">
              <select name="warehouse_id" required className={selectCls}>
                {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Kategori" hint="boş = tümü">
              <select name="category_id" className={selectCls}>
                <option value="">Tüm kategoriler</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Not"><input name="note" maxLength={500} placeholder="Yıl sonu sayımı…" className={inputCls} /></Field>
            <PendingSubmit className={btnPrimary}>Sayımı başlat</PendingSubmit>
            <div className="md:col-span-4 flex flex-wrap gap-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="blind" /> Kör sayım (sayan kişi sistemdeki miktarı görmez)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="all_items" /> Stoğu sıfır görünen kartları da listeye ekle</label>
            </div>
          </form>
        )}
        <Table head={["No", "Tarih", "Depo", "Kategori", "Sayılan", "Durum", "Not"]} min={760}>
          {rows.map((r) => {
            const counted = r.stk_count_lines.filter((l) => l.counted !== null).length;
            return (
              <tr key={r.id}>
                <td className={td}><Link href={`/stok/sayim/${r.id}`} className="font-semibold text-brand-700">#{r.no}</Link></td>
                <td className={td}>{formatDate(r.count_date)}</td>
                <td className={td}>{r.stk_warehouses?.name}</td>
                <td className={td}>{r.stk_categories?.name ?? "Tümü"}</td>
                <td className={`${td} num`}>{counted} / {r.stk_count_lines.length}</td>
                <td className={td}><Chip tone={COUNT_STATUS[r.status]?.[1]}>{COUNT_STATUS[r.status]?.[0]}</Chip>{r.blind && <span className="ml-1.5"><Chip>kör</Chip></span>}</td>
                <td className={td}>{r.note ?? ""}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={7} text="Henüz sayım yapılmadı." />}
        </Table>
      </div>
    </>
  );
}
