import { Card } from "@/components/ui";
import { Field, Money, Table, btnPrimary, inputCls, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { loadAccounts, loadCategories } from "@/lib/fin-data";
import { cardPay, cardSpend } from "@/lib/fin2-actions";
import { AccountsView } from "../_parts/AccountsView";

export const dynamic = "force-dynamic";

/** Şirket kredi kartları: limit, taksitli harcama, ekstre tahmini, borç ödeme */
export default async function CardsPage() {
  const s = await getSession();
  const lvl = Math.max(s.modules.finance ?? 0, s.modules.expenses ?? 0);
  const supabase = await createClient();
  const [{ rows: cards }, { rows: banks }, cats, { data: parties }, { data: inst }] = await Promise.all([
    loadAccounts(["credit_card"]),
    loadAccounts(["bank", "cash"]),
    loadCategories(["expense"]),
    supabase.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
    supabase.from("fin_card_installments").select("account_id, statement_date, amount, no, of_count, fin_txns!inner(description, voided_at)").is("fin_txns.voided_at", null).gte("statement_date", today().slice(0, 8) + "01").order("statement_date").limit(5000),
  ]);
  const active = cards.filter((c) => c.is_active);
  type I = { account_id: string; statement_date: string; amount: number; no: number; of_count: number; fin_txns: { description: string | null } };
  const rows = (inst ?? []) as unknown as I[];
  const months = [...new Set(rows.map((r) => r.statement_date))].sort().slice(0, 6);
  const cell = (acc: string, m: string) => rows.filter((r) => r.account_id === acc && r.statement_date === m).reduce((t, r) => t + Number(r.amount), 0);

  return (
    <AccountsView kinds={["credit_card"]} newKind="credit_card" title="Kredi kartları" subtitle="Kart limiti, taksitli harcamalar ve gelecek ekstre tahmini">
      {active.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {active.map((c) => {
            const debt = Math.max(0, -c.balance);
            const limit = Number(c.card_limit ?? 0);
            const pct = limit ? Math.min(100, Math.round((debt / limit) * 100)) : 0;
            return (
              <div key={c.id} className="rounded-[16px] p-4 text-white bg-gradient-to-br from-brand-800 to-brand-600 flex flex-col gap-2 shadow-sm">
                <div className="flex justify-between text-sm"><b>{c.name}</b><span className="opacity-80">{c.bank_name ?? ""}</span></div>
                <span className="font-mono tracking-widest opacity-90">•••• •••• •••• {c.card_last4 ?? "····"}</span>
                <span className="text-xs opacity-80">Borç</span>
                <span className="font-display text-2xl font-bold">{fmt(debt, c.currency)}</span>
                {limit > 0 && (
                  <>
                    <div className="h-1.5 rounded-full bg-white/25"><div className={`h-full rounded-full ${pct > 85 ? "bg-red-300" : "bg-white"}`} style={{ width: `${pct}%` }} /></div>
                    <span className="text-xs opacity-80">Kullanılabilir {fmt(Math.max(0, limit - debt), c.currency)} / {fmt(limit, c.currency)}</span>
                  </>
                )}
                <span className="text-xs opacity-80">Kesim {c.statement_day ?? "—"} · son ödeme {c.due_day ?? "—"}</span>
              </div>
            );
          })}
        </div>
      )}

      {months.length > 0 && (
        <Table head={["Kart", ...months.map((m) => `${formatDate(m).slice(3)} ekstresi`)]} min={640}>
          {active.map((c) => (
            <tr key={c.id}>
              <td className={td}>{c.name}</td>
              {months.map((m) => <td key={m} className={tdNum}><Money v={cell(c.id, m)} cur={c.currency} /></td>)}
            </tr>
          ))}
        </Table>
      )}

      {lvl >= 2 && active.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Kartla harcama (taksitli)">
            <form action={cardSpend} className="grid gap-3 sm:grid-cols-2">
              <Field label="Kart"><select name="account_id" required className={selectCls}>{active.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}</select></Field>
              <Field label="Tutar (KDV dahil)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
              <Field label="Taksit"><select name="installments" className={selectCls}>{[1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 18, 24].map((n) => <option key={n} value={n}>{n === 1 ? "Tek çekim" : `${n} taksit`}</option>)}</select></Field>
              <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
              <Field label="Ne için?">
                <select name="target" className={selectCls}><option value="category">Masraf (gider hesabı)</option><option value="party">Cariye ödeme (tedarikçi)</option></select>
              </Field>
              <Field label="Gider hesabı / KDV">
                <div className="flex gap-2">
                  <select name="category_id" className={`${selectCls} flex-1`}><option value="">Diğer giderler</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <select name="vat_rate" className={`${selectCls} w-20`}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select>
                </div>
              </Field>
              <Field label="Cari" hint="cariye ödeme seçildiyse" className="sm:col-span-2">
                <select name="party_id" className={selectCls}><option value="">—</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </Field>
              <Field label="Açıklama"><input name="description" maxLength={300} className={inputCls} /></Field>
              <Field label="Belge no"><input name="doc_no" maxLength={60} className={inputCls} /></Field>
              <div className="sm:col-span-2"><PendingSubmit className={btnPrimary}>Harcamayı kaydet</PendingSubmit></div>
            </form>
          </Card>
          {(s.modules.finance ?? 0) >= 2 && (
            <Card title="Kart borcu öde">
              <form action={cardPay} className="grid gap-3 sm:grid-cols-2">
                <Field label="Kart"><select name="card_id" required className={selectCls}>{active.map((c) => <option key={c.id} value={c.id}>{c.name} · borç {fmt(Math.max(0, -c.balance), c.currency)}</option>)}</select></Field>
                <Field label="Ödeyen hesap"><select name="account_id" required className={selectCls}>{banks.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency}) · {fmt(b.balance, b.currency)}</option>)}</select></Field>
                <Field label="Tutar"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
                <div className="sm:col-span-2"><PendingSubmit className={btnPrimary}>Ödemeyi kaydet</PendingSubmit></div>
              </form>
            </Card>
          )}
        </div>
      )}
    </AccountsView>
  );
}
