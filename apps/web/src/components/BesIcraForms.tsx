"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useState } from "react";
import { saveBes, saveGarnishment } from "@/lib/bes-icra-actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type Emp = { id: string; name: string };

const Msg = ({ s }: { s: { ok: boolean; message: string } | null }) =>
  s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null;

export function BesForm({ employees }: { employees: Emp[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(saveBes);
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-5 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Personel
        <select name="employeeId" required className={input}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Giriş tarihi<input type="date" name="enrolled_on" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Oran (%)<input name="rate" defaultValue="3" inputMode="decimal" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Poliçe / sözleşme no<input name="policy_no" className={input} /></label>
      <div className="md:col-span-5 flex gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">BES kaydı ekle</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function GarnishmentForm({ employees }: { employees: Emp[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(saveGarnishment);
  const [kind, setKind] = useState("ENFORCEMENT");
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-4 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tür
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
          <option value="ENFORCEMENT">İcra (borç)</option>
          <option value="ALIMONY">Nafaka (öncelikli)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Personel
        <select name="employeeId" required className={input}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İcra dairesi<input name="office" required placeholder="İzmir 12. İcra Dairesi" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Dosya no<input name="file_no" required placeholder="2025/4471 E." className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Alacaklı<input name="creditor" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tebliğ tarihi<input type="date" name="served_at" required className={input} /></label>
      {kind === "ENFORCEMENT" ? (
        <label className="flex flex-col gap-1.5 text-sm text-muted">Toplam borç (TL)<input name="debt_amount" required inputMode="decimal" className={input} /></label>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm text-muted">Aylık nafaka (TL)<input name="monthly_amount" required inputMode="decimal" className={input} /></label>
      )}
      <label className="flex flex-col gap-1.5 text-sm text-muted">Ödeme IBAN (icra dairesi)<input name="payment_iban" className={input} /></label>
      <div className="md:col-span-4 flex gap-3 items-center flex-wrap">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Dosya ekle</button>
        <span className="text-xs text-muted">Nafaka her ay tam kesilir; icra dosyaları tebliğ sırasına göre resmi netin 1/4&apos;ünden karşılanır.</span>
        <Msg s={state} />
      </div>
    </form>
  );
}
