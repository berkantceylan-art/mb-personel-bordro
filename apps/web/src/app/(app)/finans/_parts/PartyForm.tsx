import { saveParty } from "@/lib/fin-actions";
import { CURRENCIES, PARTY_KIND, type Party } from "@/lib/fin";
import { Field, btnPrimary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Cari kart formu: tedarikçi / müşteri; para birimi ve açılış (eski) bakiye */
export function PartyForm({ party, defaultKind = "supplier" }: { party?: Party; defaultKind?: string }) {
  const p = party;
  const open = p ? Math.abs(Number(p.opening_balance)) / 100 : 0;
  const lab = !!p?.lab_customer_id;
  return (
    <form action={saveParty} className="grid gap-4 md:grid-cols-4">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Ünvan / ad soyad" className="md:col-span-2"><input name="name" required maxLength={200} defaultValue={p?.name ?? ""} className={inputCls} /></Field>
      <Field label="Cari türü">
        <select name="kind" defaultValue={p?.kind ?? defaultKind} className={selectCls}>
          {Object.entries(PARTY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Kişi / şirket">
        <select name="person_type" defaultValue={p?.person_type ?? "company"} className={selectCls}>
          <option value="company">Şirket (VKN)</option>
          <option value="person">Şahıs (TCKN)</option>
        </select>
      </Field>
      <Field label="Para birimi" hint="cari bu para biriminde izlenir">
        <select name="currency" defaultValue={p?.currency ?? "TRY"} className={selectCls}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Vergi dairesi"><input name="tax_office" maxLength={80} defaultValue={p?.tax_office ?? ""} className={inputCls} /></Field>
      <Field label="VKN / TCKN"><input name="tax_no" maxLength={11} inputMode="numeric" defaultValue={p?.tax_no ?? ""} className={`${inputCls} num`} /></Field>
      <Field label="Cari kodu" hint="isteğe bağlı"><input name="code" maxLength={30} defaultValue={p?.code ?? ""} className={inputCls} /></Field>

      <fieldset className="md:col-span-4 grid gap-4 md:grid-cols-4 rounded-[12px] border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-brand-800">Eski bakiye (açılış)</legend>
        <Field label="Tutar"><input name="opening_amount" inputMode="decimal" defaultValue={open ? String(open).replace(".", ",") : ""} placeholder="0,00" className={inputCls} /></Field>
        <Field label="Yönü">
          <select name="opening_side" defaultValue={p && p.opening_balance < 0 ? "payable" : "receivable"} className={selectCls}>
            <option value="receivable">Bize borçlu (alacağımız)</option>
            <option value="payable">Biz borçluyuz (borcumuz)</option>
          </select>
        </Field>
        <Field label="Bakiye tarihi"><input type="date" name="opening_date" defaultValue={p?.opening_date ?? ""} className={inputCls} /></Field>
        <p className="text-xs text-muted self-end">Önceki programdaki son bakiyeyi girin; ekstre bu tutarla başlar.</p>
      </fieldset>

      <Field label="Telefon"><input name="phone" type="tel" maxLength={40} defaultValue={p?.phone ?? ""} className={inputCls} /></Field>
      <Field label="E-posta"><input name="email" type="email" maxLength={200} defaultValue={p?.email ?? ""} className={inputCls} /></Field>
      <Field label="Yetkili kişi"><input name="contact_name" maxLength={120} defaultValue={p?.contact_name ?? ""} className={inputCls} /></Field>
      <Field label="Web sitesi"><input name="website" maxLength={200} defaultValue={p?.website ?? ""} className={inputCls} /></Field>
      <Field label="Adres" className="md:col-span-2"><input name="address" maxLength={400} defaultValue={p?.address ?? ""} className={inputCls} /></Field>
      <Field label="İlçe"><input name="district" maxLength={80} defaultValue={p?.district ?? ""} className={inputCls} /></Field>
      <Field label="Şehir"><input name="city" maxLength={80} defaultValue={p?.city ?? ""} className={inputCls} /></Field>
      <Field label="Ülke"><input name="country" maxLength={60} defaultValue={p?.country ?? "TR"} className={inputCls} /></Field>
      <Field label="IBAN"><input name="iban" maxLength={40} defaultValue={p?.iban ?? ""} className={`${inputCls} num`} /></Field>
      <Field label="Vade (gün)"><input name="payment_term_days" type="number" min={0} max={365} defaultValue={p?.payment_term_days ?? 0} className={inputCls} /></Field>
      <Field label="Risk / kredi limiti"><input name="credit_limit" inputMode="decimal" defaultValue={p?.credit_limit ? Number(p.credit_limit) / 100 : ""} className={inputCls} /></Field>
      <Field label="E-fatura etiketi" hint="posta kutusu"><input name="einvoice_alias" maxLength={120} defaultValue={p?.einvoice_alias ?? ""} placeholder="urn:mail:defaultpk@…" className={inputCls} /></Field>
      <div className="flex flex-col gap-2 justify-end text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_einvoice" defaultChecked={p?.is_einvoice} /> E-fatura mükellefi</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="credit_sales" defaultChecked={p?.credit_sales} /> Veresiye defterinde göster</label>
      </div>
      {p && (
        <Field label="Durum">
          <select name="is_active" defaultValue={p.is_active ? "on" : "off"} className={selectCls}>
            <option value="on">Aktif</option>
            <option value="off">Pasif</option>
          </select>
        </Field>
      )}
      <Field label="Not" className="md:col-span-4"><textarea name="note" rows={2} maxLength={2000} defaultValue={p?.note ?? ""} className={textareaCls} /></Field>
      {lab && <p className="md:col-span-4 text-xs text-muted">Bu cari bir hekim / hastane kartına bağlı: ad, telefon ve vergi bilgileri hekim kartıyla eşitlenir; işler ekstrede borç olarak görünür.</p>}
      <div className="md:col-span-4"><PendingSubmit className={btnPrimary}>{p ? "Kaydet" : "Cari kartı aç"}</PendingSubmit></div>
    </form>
  );
}
