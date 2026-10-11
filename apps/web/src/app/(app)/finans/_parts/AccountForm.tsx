import { saveAccount } from "@/lib/fin-actions";
import { ACCOUNT_KIND, CURRENCIES, fmt, type Account } from "@/lib/fin";
import { Field, btnPrimary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Hesap aç / düzenle: türe göre alanlar */
export function AccountForm({ kind, account, employees = [] }: { kind: string; account?: Account; employees?: { id: string; name: string }[] }) {
  const a = account;
  const liability = ["credit_card", "loan"].includes(kind);
  const open = a ? Math.abs(Number(a.opening_balance)) / 100 : "";
  return (
    <form action={saveAccount} className="grid gap-4 md:grid-cols-3">
      <input type="hidden" name="kind" value={kind} />
      {a && <input type="hidden" name="id" value={a.id} />}
      <Field label="Hesap adı" className="md:col-span-2"><input name="name" required maxLength={120} defaultValue={a?.name ?? ""} placeholder={ACCOUNT_KIND[kind]?.label} className={inputCls} /></Field>
      <Field label="Para birimi">
        <select name="currency" defaultValue={a?.currency ?? "TRY"} className={selectCls} disabled={!!a}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {a && <input type="hidden" name="currency" value={a.currency} />}
      </Field>
      {["bank", "pos", "credit_card", "loan"].includes(kind) && <Field label="Banka"><input name="bank_name" maxLength={80} defaultValue={a?.bank_name ?? ""} className={inputCls} /></Field>}
      {["bank", "pos"].includes(kind) && (
        <>
          <Field label="Şube"><input name="branch" maxLength={80} defaultValue={a?.branch ?? ""} className={inputCls} /></Field>
          <Field label="IBAN"><input name="iban" maxLength={40} defaultValue={a?.iban ?? ""} placeholder="TR00 0000 …" className={`${inputCls} num`} /></Field>
          <Field label="Hesap no"><input name="account_no" maxLength={40} defaultValue={a?.account_no ?? ""} className={inputCls} /></Field>
        </>
      )}
      {kind === "credit_card" && (
        <>
          <Field label="Kartın son 4 hanesi"><input name="card_last4" maxLength={4} inputMode="numeric" defaultValue={a?.card_last4 ?? ""} className={inputCls} /></Field>
          <Field label="Kart limiti"><input name="card_limit" inputMode="decimal" defaultValue={a?.card_limit ? Number(a.card_limit) / 100 : ""} className={inputCls} /></Field>
          <Field label="Hesap kesim günü"><input name="statement_day" type="number" min={1} max={31} defaultValue={a?.statement_day ?? ""} className={inputCls} /></Field>
          <Field label="Son ödeme günü"><input name="due_day" type="number" min={1} max={31} defaultValue={a?.due_day ?? ""} className={inputCls} /></Field>
        </>
      )}
      {kind === "partner" && (
        <>
          <Field label="Ortak adı"><input name="holder_name" maxLength={120} defaultValue={a?.holder_name ?? ""} className={inputCls} /></Field>
          <Field label="Hisse oranı (%)"><input name="share_pct" inputMode="decimal" defaultValue={a?.share_pct ?? ""} className={inputCls} /></Field>
        </>
      )}
      {kind === "advance" && (
        <>
          <Field label="Personel">
            <select name="holder_employee_id" defaultValue={a?.holder_employee_id ?? ""} className={selectCls}>
              <option value="">— personel dışı —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Kişi adı" hint="personel değilse"><input name="holder_name" maxLength={120} defaultValue={a?.holder_name ?? ""} className={inputCls} /></Field>
        </>
      )}
      <Field label={liability ? "Açılış borcu" : "Açılış bakiyesi"} hint={liability ? "o tarihteki borç" : "eksi olabilir"}>
        <input name="opening_amount" inputMode="decimal" defaultValue={open ? String(open).replace(".", ",") : ""} placeholder="0,00" className={inputCls} />
        {a && <span className="text-xs font-normal text-muted">Şu an: {fmt(a.opening_balance, a.currency)}</span>}
      </Field>
      <Field label="Açılış tarihi"><input type="date" name="opening_date" defaultValue={a?.opening_date ?? ""} className={inputCls} /></Field>
      {a && (
        <Field label="Durum">
          <select name="is_active" defaultValue={a.is_active ? "on" : "off"} className={selectCls}>
            <option value="on">Kullanımda</option>
            <option value="off">Kapalı</option>
          </select>
        </Field>
      )}
      <Field label="Not" className="md:col-span-3"><textarea name="note" rows={2} maxLength={1000} defaultValue={a?.note ?? ""} className={textareaCls} /></Field>
      <div className="md:col-span-3"><PendingSubmit className={btnPrimary}>{a ? "Kaydet" : "Hesabı aç"}</PendingSubmit></div>
    </form>
  );
}
