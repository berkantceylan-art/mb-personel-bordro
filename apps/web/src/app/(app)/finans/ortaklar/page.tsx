import { Card } from "@/components/ui";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { fmt, today } from "@/lib/fin";
import { loadAccounts, loadCategories } from "@/lib/fin-data";
import { partnerOp } from "@/lib/fin2-actions";
import { AccountsView } from "../_parts/AccountsView";

export const dynamic = "force-dynamic";

/** Şirket ortak hesapları: ortaktan para girişi, ortağa çıkış, ortağın şirket adına ödediği masraflar */
export default async function PartnersPage() {
  const s = await getSession();
  const [{ rows: partners }, { rows: cash }, cats] = await Promise.all([loadAccounts(["partner"]), loadAccounts(["cash", "bank"]), loadCategories(["expense"])]);
  const active = partners.filter((p) => p.is_active);
  const lvl = s.modules.finance ?? 0;
  const pOpts = active.map((p) => <option key={p.id} value={p.id}>{p.name}{p.share_pct ? ` (%${p.share_pct})` : ""} · {p.balance < 0 ? `şirket borçlu ${fmt(-p.balance, p.currency)}` : p.balance > 0 ? `ortak borçlu ${fmt(p.balance, p.currency)}` : "0"}</option>);
  const cOpts = cash.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>);
  return (
    <AccountsView kinds={["partner"]} newKind="partner" title="Ortak hesapları" subtitle="Eksi bakiye: şirket ortağa borçlu · artı bakiye: ortak şirkete borçlu">
      {active.length === 0 && <Notice>Önce aşağıdan ortak hesabı açın (ad, hisse oranı).</Notice>}
      {active.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {active.map((p) => (
            <div key={p.id} className="bg-white border border-line rounded-[14px] p-4">
              <div className="flex justify-between"><b>{p.name}</b>{p.share_pct ? <span className="text-sm text-muted">%{p.share_pct} hisse</span> : null}</div>
              <span className={`block font-display text-2xl font-bold mt-1 ${p.balance < 0 ? "text-bad" : p.balance > 0 ? "text-ok" : ""}`}>{fmt(Math.abs(p.balance), p.currency)}</span>
              <span className="text-xs text-muted">{p.balance < 0 ? "Şirketin ortağa borcu" : p.balance > 0 ? "Ortağın şirkete borcu" : "Hesap kapalı"}</span>
            </div>
          ))}
        </div>
      )}
      {lvl >= 2 && active.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {([["in", "Ortaktan şirkete para"], ["out", "Şirketten ortağa para"]] as const).map(([op, title]) => (
            <Card key={op} title={title}>
              <form action={partnerOp} className="flex flex-col gap-3">
                <input type="hidden" name="op" value={op} />
                <Field label="Ortak"><select name="partner_id" required className={selectCls}>{pOpts}</select></Field>
                <Field label="Kasa / banka"><select name="account_id" required className={selectCls}>{cOpts}</select></Field>
                <Field label="Tutar"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
                <Field label="Açıklama"><input name="description" maxLength={300} placeholder={op === "in" ? "Sermaye / borç" : "Kâr payı / geri ödeme / çekiş"} className={inputCls} /></Field>
                <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
              </form>
            </Card>
          ))}
          <Card title="Ortak şirket masrafını ödedi">
            <form action={partnerOp} className="flex flex-col gap-3">
              <input type="hidden" name="op" value="expense" />
              <Field label="Ortak"><select name="partner_id" required className={selectCls}>{pOpts}</select></Field>
              <Field label="Gider hesabı"><select name="category_id" required className={selectCls}><option value="">Seçin</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Field label="Tutar (KDV dahil)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                <Field label="KDV"><select name="vat_rate" className={selectCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
              </div>
              <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
              <Field label="Açıklama"><input name="description" maxLength={300} className={inputCls} /></Field>
              <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
            </form>
          </Card>
        </div>
      )}
    </AccountsView>
  );
}
