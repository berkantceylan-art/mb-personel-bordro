"use client";
import { useActionForm } from "@/lib/use-action-form";
import { addManualOvertime, createLeave } from "@/lib/leave-ot-actions";
import { PaySideSelect } from "./PaySideSelect";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";

export function LeaveForm({ employees, types, defaultEmployee }: { employees: Array<{ id: string; name: string }>; types: Array<{ id: string; name: string }>; defaultEmployee?: string }) {
  const { state, pending, formProps: actionProps } = useActionForm(createLeave);
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-3">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Personel *
        <select name="employeeId" required defaultValue={defaultEmployee ?? ""} className={input}>
          <option value="">Seçin</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İzin türü *
        <select name="typeId" required className={input}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Açıklama<input name="note" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Başlangıç *<input type="date" name="start" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş<input type="date" name="end" className={input} /></label>
      <div className="flex flex-col gap-2 justify-end text-sm">
        <label className="flex gap-2 items-center"><input type="checkbox" name="half_day" className="w-5 h-5" />Yarım gün</label>
        <label className="flex gap-2 items-center"><input type="checkbox" name="approve" defaultChecked className="w-5 h-5" />Hemen onayla</label>
      </div>
      <div className="md:col-span-3 flex flex-wrap gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">İzin kaydet</button>
        <span className="text-xs text-muted">Yıllık ve mazeret izinlerinde pazar ve resmi tatiller sayılmaz; rapor takvim günüyle sayılır.</span>
        {state && <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</span>}
      </div>
    </form>
  );
}

export function ManualOvertimeForm({ employees }: { employees: Array<{ id: string; name: string }> }) {
  const { state, pending, formProps: actionProps } = useActionForm(addManualOvertime);
  return (
    <form {...actionProps} className="flex flex-wrap gap-3 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted min-w-56">Personel
        <select name="employeeId" required className={input}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih<input type="date" name="date" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted w-28">Saat<input name="hours" required inputMode="decimal" placeholder="2,5" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Oran
        <select name="rate" className={input}><option value="1.5">%50 fazla mesai</option><option value="1">Resmi tatil (maaşa ek ×1)</option><option value="2">Resmi tatil (maaşa ek ×2)</option></select>
      </label>
      <PaySideSelect />
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Ekle</button>
      {state && <span role="status" className="text-sm text-ok">{state.message}</span>}
    </form>
  );
}
