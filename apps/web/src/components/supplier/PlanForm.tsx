import { PendingSubmit } from "@/components/ConfirmSubmit";
import { savePayPlan } from "@/lib/supplier-portal-actions";
import { PAY_METHODS } from "@/lib/supplier-portal";

/** Ödeme planı formu (tedarikçi sayfası ve ödeme takvimi) */
export function PlanForm({ partyId, currency, parties }: { partyId?: string; currency?: string; parties?: { id: string; name: string }[] }) {
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <form action={savePayPlan} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3 text-sm">
      <h3 className="w-full font-display font-bold text-brand-800">Ödeme planla <span className="font-normal text-muted text-xs">— vadeden önce ve vade günü bildirim gelir</span></h3>
      {partyId ? <input type="hidden" name="party_id" value={partyId} /> : (
        <label className="flex flex-col gap-1">Tedarikçi<select name="party_id" required className="h-10 w-56 rounded-[10px] border border-[#D5DEE8] px-2"><option value="">Seçin</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      )}
      <label className="flex flex-col gap-1">Vade<input type="date" name="due_date" required defaultValue={today} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
      <label className="flex flex-col gap-1">Tutar<input name="amount" required inputMode="decimal" placeholder="0,00" className="h-10 w-32 rounded-[10px] border border-[#D5DEE8] px-2 text-right" /></label>
      <label className="flex flex-col gap-1">Para birimi<select name="currency" defaultValue={currency ?? "TRY"} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">{["TRY", "EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="flex flex-col gap-1">Yöntem<select name="method" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">{Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="flex flex-col gap-1">Kaç gün önce hatırlat<input name="remind_days" type="number" min={0} max={60} defaultValue={3} className="h-10 w-20 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
      <label className="flex flex-col gap-1 flex-1 min-w-[180px]">Not<input name="note" maxLength={300} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
      <label className="flex items-center gap-1 h-10"><input type="checkbox" name="notify_supplier" /> Tedarikçiye de hatırlat (e-posta / WhatsApp)</label>
      <label className="flex items-center gap-1 h-10"><input type="checkbox" name="hide_supplier" /> Portalda gösterme</label>
      <PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Planla</PendingSubmit>
    </form>
  );
}
