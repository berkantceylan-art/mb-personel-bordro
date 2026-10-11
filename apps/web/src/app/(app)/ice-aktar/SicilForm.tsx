"use client";
import { useActionForm } from "@/lib/use-action-form";
import { importSicil } from "./sicil-actions";

/** Muhasebe programından alınan personel sicil listesi: kimlik, doğum, adres, telefon, işe giriş, meslek kodu */
export function SicilForm() {
  const { state, pending, formProps } = useActionForm(importSicil);
  return (
    <form {...formProps} className="bg-white border border-line rounded-2xl p-6 flex flex-col gap-4 max-w-2xl">
      <div>
        <h2 className="font-display text-lg font-bold">Personel sicil listesi</h2>
        <p className="text-sm text-muted mt-1">
          Muhasebe programından alınan sicil listesi (Adı, Soyadı, TC Kimlik No, Doğum Tarihi, İşe Giriş Tarihi, Adres, Telefon, Meslek Kodu…).
          Personel önce TC kimlik no, yoksa ad soyad ile eşleşir; olmayanlar yeni açılır. Boş hücreler mevcut bilgileri silmez, ücret sütunu aktarılmaz.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Sicil listesi (.xlsx)
        <input type="file" name="file" accept=".xlsx" required className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 py-2.5 text-ink" />
      </label>
      {state && (
        <div role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : state.preview ? "bg-[#EEF4FB] text-ink" : "bg-warn-bg text-warn"}`}>
          <p className="font-semibold">{state.message}</p>
          {state.details && state.details.length > 0 && (
            <ul className="list-disc pl-5 mt-1 max-h-64 overflow-auto">{state.details.slice(0, 80).map((d) => <li key={d}>{d}</li>)}</ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button name="mode" value="preview" disabled={pending} className="h-12 rounded-[10px] border border-brand-700 text-brand-700 font-semibold disabled:opacity-60 px-6">
          {pending ? "Okunuyor…" : "Önizle"}
        </button>
        <button name="mode" value="apply" disabled={pending} className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60 px-6">
          {pending ? "Aktarılıyor…" : "Aktar"}
        </button>
      </div>
    </form>
  );
}
