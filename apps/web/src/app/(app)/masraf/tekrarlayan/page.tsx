import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, Money, Table, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CURRENCIES, today } from "@/lib/fin";
import { loadCategories } from "@/lib/fin-data";
import { saveRecurring, toggleRecurring } from "@/lib/expense-actions";

export const dynamic = "force-dynamic";

/** Tekrarlayan masraflar: her ay belirtilen günde onay kuyruğuna düşer */
export default async function RecurringPage() {
  const s = await getSession();
  const lvl = s.modules.expenses ?? 0;
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const [{ data }, cats, { data: accs }, { data: parties }] = await Promise.all([
    supabase.from("exp_recurring").select("*, fin_categories(name), fin_accounts(name), fin_parties(name)").order("day_of_month"),
    loadCategories(["expense"]),
    supabase.from("fin_accounts").select("id, name, currency").in("kind", ["cash", "bank", "credit_card"]).eq("is_active", true).order("name"),
    supabase.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
  ]);
  type R = { id: string; name: string; amount: number; currency: string; vat_rate: number; day_of_month: number; is_active: boolean; last_period: string | null; start_date: string; end_date: string | null; fin_categories: { name: string } | null; fin_accounts: { name: string } | null; fin_parties: { name: string } | null };
  const rows = (data ?? []) as unknown as R[];
  return (
    <>
      <PageHeader title="Tekrarlayan masraflar" subtitle="Kira, aidat, internet, yazılım aboneliği… Her ay seçilen günde onay kuyruğuna gelir; onaylayınca finansa işlenir." actions={<Link href="/masraf" className="text-sm font-semibold text-brand-700">← Masraflar</Link>} />
      <div className={page}>
        <Table head={["Gün", "Masraf", "Tür", "Ödeme", "Tutar", "Son oluşturulan", "Durum"]} min={860}>
          {rows.map((r) => (
            <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
              <td className={`${td} num`}>Her ayın {r.day_of_month}&apos;i</td>
              <td className={td}><b>{r.name}</b><span className="block text-xs text-muted">{formatDate(r.start_date)}{r.end_date ? ` – ${formatDate(r.end_date)}` : " ·  süresiz"}</span></td>
              <td className={td}>{r.fin_categories?.name ?? "—"}</td>
              <td className={td}>{r.fin_accounts?.name ?? (r.fin_parties ? `Cariye borç: ${r.fin_parties.name}` : "—")}</td>
              <td className={tdNum}><Money v={r.amount} cur={r.currency} strong /> <span className="text-xs text-muted">%{Number(r.vat_rate)}</span></td>
              <td className={td}>{r.last_period ? formatDate(r.last_period).slice(3) : "—"}</td>
              <td className={td}>
                {lvl >= 2 ? (
                  <form action={toggleRecurring} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="on" value={r.is_active ? "0" : "1"} />
                    <Chip tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Aktif" : "Durdu"}</Chip>
                    <PendingSubmit className="text-xs font-semibold text-brand-700">{r.is_active ? "Durdur" : "Başlat"}</PendingSubmit>
                  </form>
                ) : <Chip tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Aktif" : "Durdu"}</Chip>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} text="Tanımlı tekrarlayan masraf yok." />}
        </Table>
        {lvl >= 2 && (
          <Card title="Yeni tekrarlayan masraf">
            <form action={saveRecurring} className="grid gap-3 md:grid-cols-4">
              <Field label="Ad" className="md:col-span-2"><input name="name" required maxLength={120} placeholder="ör. Atölye kirası" className={inputCls} /></Field>
              <Field label="Gider hesabı"><select name="category_id" className={selectCls}><option value="">Diğer</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Her ayın günü"><input name="day_of_month" type="number" min={1} max={28} defaultValue={1} className={inputCls} /></Field>
              <Field label="Tutar (KDV dahil)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
              <Field label="Para birimi"><select name="currency" className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="KDV"><select name="vat_rate" className={selectCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
              <Field label="Ödenecek hesap"><select name="account_id" className={selectCls}><option value="">—</option>{(accs ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
              <Field label="ya da cari (borç)" className="md:col-span-2"><select name="party_id" className={selectCls}><option value="">—</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Başlangıç"><input type="date" name="start_date" defaultValue={today()} className={inputCls} /></Field>
              <Field label="Bitiş" hint="boş = süresiz"><input type="date" name="end_date" className={inputCls} /></Field>
              <div className="md:col-span-4"><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
