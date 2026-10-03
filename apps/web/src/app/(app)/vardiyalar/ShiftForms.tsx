"use client";
import { useActionState } from "react";
import { assignDefaultShift, saveShift } from "./actions";
import type { ShiftRow } from "@/lib/timekeeping";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const COLORS = ["#E7F1FB", "#1E3550", "#E0F5FB", "#F1ECFA", "#E6F4EC", "#FFF4E0", "#FCE7F3"];
const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";

export function ShiftForm({ shift, employees }: { shift?: ShiftRow; employees: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(saveShift, null);
  const wd = new Set(shift?.weekdays ?? [1, 2, 3, 4, 5, 6]);
  return (
    <form action={action} className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-4">
      {shift && <input type="hidden" name="id" value={shift.id} />}
      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Vardiya adı *<input name="name" required defaultValue={shift?.name} placeholder="ör. Gündüz" className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Kısa kod *<input name="code" required maxLength={4} defaultValue={shift?.code} placeholder="G" className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Renk
          <select name="color" defaultValue={shift?.color ?? COLORS[0]} className={input}>
            {COLORS.map((c, i) => <option key={c} value={c}>{["Mavi", "Lacivert", "Camgöbeği", "Mor", "Yeşil", "Turuncu", "Pembe"][i]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Başlangıç *<input type="time" name="start_time" required defaultValue={shift?.start_time?.slice(0, 5) ?? "08:30"} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş *<input type="time" name="end_time" required defaultValue={shift?.end_time?.slice(0, 5) ?? "18:00"} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Mola (dk)<input type="number" name="break_minutes" min={0} defaultValue={shift?.break_minutes ?? 60} className={input} /></label>
        <label className="flex gap-2.5 items-center text-sm self-end h-11"><input type="checkbox" name="break_paid" defaultChecked={shift?.break_paid} className="w-5 h-5" />Mola ücretli</label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Geç kalma toleransı (dk)<input type="number" name="late_tolerance_min" min={0} defaultValue={shift?.late_tolerance_min ?? 10} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Erken çıkma toleransı (dk)<input type="number" name="early_leave_tolerance_min" min={0} defaultValue={shift?.early_leave_tolerance_min ?? 10} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Fazla mesai eşiği (dk)<input type="number" name="overtime_threshold_min" min={0} defaultValue={shift?.overtime_threshold_min ?? 30} className={input} /></label>
        <label className="flex gap-2.5 items-center text-sm self-end h-11"><input type="checkbox" name="crosses_midnight" defaultChecked={shift?.crosses_midnight} className="w-5 h-5" />Gece yarısını geçer</label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-muted mb-1">Çalışılan günler (diğerleri hafta tatili)</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-[#D5DEE8] text-sm cursor-pointer has-[:checked]:bg-brand-700 has-[:checked]:text-white has-[:checked]:border-brand-700">
              <input type="checkbox" name="weekdays" value={i + 1} defaultChecked={wd.has(i + 1)} className="sr-only" />{d}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4 md:grid-cols-3 border-t border-line pt-4">
        <legend className="text-sm font-semibold text-brand-800">Özel vardiya (isteğe bağlı)</legend>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Sadece bu personel için
          <select name="employee_id" defaultValue={shift?.employee_id ?? ""} className={input}>
            <option value="">— Genel vardiya —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Geçerli başlangıç<input type="date" name="valid_from" className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Geçerli bitiş<input type="date" name="valid_to" className={input} /></label>
      </fieldset>
      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold self-start disabled:opacity-60">{pending ? "Kaydediliyor…" : shift ? "Vardiyayı güncelle" : "Vardiyayı ekle"}</button>
    </form>
  );
}

export function DefaultShiftForm({ shifts, departments }: { shifts: ShiftRow[]; departments: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(assignDefaultShift, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => (
          <label key={d.id} className="text-[13px] px-3 py-1.5 rounded-full bg-[#EEF2F6] text-[#33414F] cursor-pointer has-[:checked]:bg-brand-700 has-[:checked]:text-white">
            <input type="checkbox" name="department_id" value={d.id} className="sr-only" />{d.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1.5 text-sm text-muted">Vardiya
          <select name="shift_id" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white">
            {shifts.filter((s) => !s.employee_id && s.active).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})</option>)}
          </select>
        </label>
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Seçili bölümlere ata</button>
      </div>
      <p className="text-xs text-muted">Bölüm seçmezseniz tüm aktif personele atanır. Haftalık plandaki tek tek atamalar varsayılanın önüne geçer.</p>
      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-ok-bg text-ok">{state.message}</p>}
    </form>
  );
}
