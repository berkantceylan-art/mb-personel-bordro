import { CUSTOMER_KIND, type Customer } from "@/lib/jobs";
import { saveCustomer } from "../actions";

const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-[15px] w-full";
const lbl = "flex flex-col gap-1 text-sm text-muted";

/** Hekim / hastane kartı formu (sunucu formu) */
export function CustomerForm({ c, accounts }: { c?: Customer; accounts: { id: string; name: string; linked: boolean }[] }) {
  return (
    <form action={saveCustomer} className="grid gap-4 md:grid-cols-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <label className={`${lbl} md:col-span-2`}>Ad / ünvan *<input name="name" required defaultValue={c?.name ?? ""} className={inp} /></label>
      <label className={lbl}>
        Tür
        <select name="kind" defaultValue={c?.kind ?? "doctor_tr"} className={inp}>
          {Object.entries(CUSTOMER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className={lbl}>
        Para birimi
        <select name="currency" defaultValue={c?.currency ?? "TRY"} className={inp}>
          <option value="TRY">TL</option><option value="EUR">€</option><option value="USD">$</option>
        </select>
      </label>
      <label className={lbl}>Telefon<input name="phone" defaultValue={c?.phone ?? ""} className={inp} /></label>
      <label className={lbl}>E-posta<input name="email" type="email" defaultValue={c?.email ?? ""} className={inp} /></label>
      <label className={lbl}>Ülke<input name="country" defaultValue={c?.country ?? "TR"} className={inp} /></label>
      <label className={lbl}>Şehir<input name="city" defaultValue={c?.city ?? ""} className={inp} /></label>
      <label className={`${lbl} md:col-span-2`}>Adres<input name="address" defaultValue={c?.address ?? ""} className={inp} /></label>
      <label className={lbl}>Vergi dairesi<input name="tax_office" defaultValue={c?.tax_office ?? ""} className={inp} /></label>
      <label className={lbl}>Vergi / TC no<input name="tax_no" defaultValue={c?.tax_no ?? ""} className={inp} /></label>
      <label className={lbl}>ÜTS kurum no <span className="font-normal text-muted">(implant parçası vb. verme bildirimi için)</span><input name="uts_kurum_no" inputMode="numeric" maxLength={20} defaultValue={(c as { uts_kurum_no?: string | null } | undefined)?.uts_kurum_no ?? ""} className={inp} /><input type="hidden" name="uts_was" value={(c as { uts_kurum_no?: string | null } | undefined)?.uts_kurum_no ? "1" : ""} /></label>
      <label className={lbl}>İskonto %<input name="discount_pct" inputMode="decimal" defaultValue={c?.discount_pct ? String(c.discount_pct) : ""} className={inp} /></label>
      <label className={`${lbl} md:col-span-2`}>
        Portal hesabı (varsa)
        <select name="portal_account_id" defaultValue={c?.portal_account_id ?? ""} className={inp}>
          <option value="">—</option>
          {accounts.filter((a) => !a.linked || a.id === c?.portal_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className={lbl}>
        Durum
        <select name="is_active" defaultValue={c?.is_active === false ? "off" : "on"} className={inp}>
          <option value="on">Aktif</option><option value="off">Pasif</option>
        </select>
      </label>
      <label className={`${lbl} md:col-span-4`}>Doktor ekle (virgülle ayırın)<input name="doctors" placeholder="Dr. Ayşe Yılmaz, Dr. Mehmet Kaya" className={inp} /></label>
      <label className={`${lbl} md:col-span-4`}>Not<textarea name="note" rows={2} defaultValue={c?.note ?? ""} className={`${inp} h-auto py-2`} /></label>
      <div className="md:col-span-4"><button className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">{c ? "Kaydet" : "Hekim / hastane ekle"}</button></div>
    </form>
  );
}
