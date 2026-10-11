import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Money, Table, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveCategory } from "@/lib/fin-actions";
import { CATEGORY_KIND, today } from "@/lib/fin";
import { loadCategories } from "@/lib/fin-data";

export const dynamic = "force-dynamic";

/** Gelir / gider hesapları ve bu ay / bu yıl toplamları (TL) */
export default async function CategoriesPage() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const cats = await loadCategories();
  const supabase = await createClient();
  const year = today().slice(0, 4);
  const month = today().slice(0, 7);
  const { data: moves } = await supabase.from("fin_moves").select("category_id, amount_try, move_date, fin_txns!inner(voided_at)").not("category_id", "is", null).gte("move_date", `${year}-01-01`).is("fin_txns.voided_at", null).limit(20000);
  const sums = new Map<string, { m: number; y: number }>();
  for (const r of moves ?? []) {
    const k = r.category_id as string;
    const cur = sums.get(k) ?? { m: 0, y: 0 };
    cur.y += Number(r.amount_try);
    if ((r.move_date as string).startsWith(month)) cur.m += Number(r.amount_try);
    sums.set(k, cur);
  }
  // gelir alacak (−) tarafında birikir: gösterirken işaret çevrilir
  const val = (kind: string, v: number) => (kind === "income" || kind === "vat_out" || kind === "equity" ? -v : v);
  const income = cats.filter((c) => c.kind === "income").reduce((a, c) => a + val("income", sums.get(c.id)?.y ?? 0), 0);
  const expense = cats.filter((c) => c.kind === "expense").reduce((a, c) => a + (sums.get(c.id)?.y ?? 0), 0);
  return (
    <>
      <PageHeader title="Gelir / gider hesapları" subtitle={`${year} yılı · TL karşılığı`} />
      <div className={page}>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-line rounded-[14px] p-4"><p className="text-xs text-muted">Gelir</p><p className="font-display text-xl font-bold"><Money v={income} /></p></div>
          <div className="bg-white border border-line rounded-[14px] p-4"><p className="text-xs text-muted">Gider</p><p className="font-display text-xl font-bold"><Money v={expense} /></p></div>
          <div className="bg-white border border-line rounded-[14px] p-4"><p className="text-xs text-muted">Fark</p><p className="font-display text-xl font-bold"><Money v={income - expense} /></p></div>
        </div>
        <Table head={["Hesap", "Tür", "Bu ay", "Bu yıl"]} min={620}>
          {cats.map((c) => (
            <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
              <td className={td}>{c.name}{c.is_system && <span className="ml-2 text-[11px] text-muted">sistem</span>}</td>
              <td className={td}><Chip tone={c.kind === "income" ? "green" : c.kind === "expense" ? "red" : "gray"}>{CATEGORY_KIND[c.kind]}</Chip></td>
              <td className={tdNum}><Money v={val(c.kind, sums.get(c.id)?.m ?? 0)} /></td>
              <td className={tdNum}><Money v={val(c.kind, sums.get(c.id)?.y ?? 0)} /></td>
            </tr>
          ))}
          {cats.length === 0 && <EmptyRow cols={4} text="Kategori yok: 20261202000000_finance_core.sql çalıştırın." />}
        </Table>
        {(s.modules.finance ?? 0) >= 3 && (
          <Card title="Yeni gelir / gider hesabı">
            <form action={saveCategory} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] items-end">
              <Field label="Ad"><input name="name" required maxLength={120} className={inputCls} /></Field>
              <Field label="Tür"><select name="kind" className={selectCls}><option value="expense">Gider</option><option value="income">Gelir</option></select></Field>
              <PendingSubmit className={btnPrimary}>Ekle</PendingSubmit>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
