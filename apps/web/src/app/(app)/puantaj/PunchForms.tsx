"use client";
import { useActionForm } from "@/lib/use-action-form";
import { PaySideSelect } from "@/components/PaySideSelect";
import { addManualPunch, applyMissingDays, importPunches } from "./actions";

export function ImportPunchForm() {
  const { state, pending, formProps: actionProps } = useActionForm(importPunches);
  return (
    <form {...actionProps} className="bg-white border border-line rounded-2xl p-6 flex flex-col gap-4 max-w-2xl">
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        PDKS cihaz dosyası (.txt)
        <input type="file" name="file" accept=".txt,.csv,.dat" required className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 py-2.5 text-ink" />
      </label>
      <p className="text-xs text-muted">Biçim: <code>cihaz,kartNo,yön,YYYY/AA/GG,SS:DD:ss</code> · cihaz 002 = giriş, 001 = çıkış. Aynı dosyayı tekrar yüklemek kayıtları çoğaltmaz.</p>
      {state && (
        <div role="status" className={`text-sm rounded-lg px-3 py-2 flex flex-col gap-1 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>
          <p className="font-semibold">{state.message}</p>
          {state.anomalies ? <p>{state.anomalies} eksik giriş/çıkış var — puantaj ekranındaki anomali listesinden düzeltin.</p> : null}
          {state.unknown && state.unknown.length > 0 && (
            <p className="text-warn">Personele bağlı olmayan kartlar: {state.unknown.map((u) => `${u.cardNo} (${u.count})`).join(", ")} — personel profilinde PDKS numarasını girip dosyayı tekrar yükleyin.</p>
          )}
          {state.errors && state.errors.length > 0 && <p className="text-bad">{state.errors.join(" · ")}</p>}
        </div>
      )}
      <button disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold self-start disabled:opacity-60">{pending ? "Yükleniyor…" : "Yükle"}</button>
    </form>
  );
}

export function ManualPunchForm({ employeeId, date }: { employeeId: string; date: string }) {
  const { state, pending, formProps: actionProps } = useActionForm(addManualPunch);
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";
  return (
    <form {...actionProps} className="flex flex-wrap gap-3 items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yön
        <select name="direction" className={input}><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih<input type="date" name="date" defaultValue={date} required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Saat<input type="time" name="time" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted flex-1 min-w-48">Gerekçe *<input name="reason" required placeholder="ör. Kart okutmayı unuttu" className={input} /></label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Ekle</button>
      {state && <p role="status" className="w-full text-sm text-brand-700">{state.message}</p>}
    </form>
  );
}

export function MissingDaysButton({ period }: { period: string }) {
  const { state, pending, formProps: actionProps } = useActionForm(applyMissingDays);
  return (
    <form {...actionProps} className="flex flex-col gap-2 items-start">
      <input type="hidden" name="period" value={period} />
      <div className="flex gap-2 items-end flex-wrap">
        <PaySideSelect label="Eksik gün nereden kesilsin" />
        <button disabled={pending} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-60">
          {pending ? "Yazılıyor…" : "Eksik günleri hakedişe yansıt"}
        </button>
      </div>
      {state && <p role="status" className={`text-sm rounded-lg px-3 py-1.5 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
    </form>
  );
}
