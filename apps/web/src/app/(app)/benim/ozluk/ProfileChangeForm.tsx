"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { requestProfileChange } from "./actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type F = { name: string; label: string; type?: "text" | "date" | "number" | "select"; options?: string[] };
const FIELDS: Array<[string, F[]]> = [
  ["İletişim", [
    { name: "phone", label: "Telefon" }, { name: "phone2", label: "İkinci telefon" }, { name: "email", label: "E-posta" },
    { name: "address", label: "Adres" }, { name: "district", label: "İlçe" }, { name: "city", label: "İl" },
    { name: "emergency_contact_name", label: "Acil durumda aranacak kişi" }, { name: "emergency_contact_relation", label: "Yakınlık" }, { name: "emergency_contact_phone", label: "Telefonu" },
  ]],
  ["Kişisel", [
    { name: "marital_status", label: "Medeni durum", type: "select", options: ["", "Bekâr", "Evli", "Boşanmış", "Dul"] }, { name: "children_count", label: "Çocuk sayısı", type: "number" },
    { name: "blood_type", label: "Kan grubu", type: "select", options: ["", "0 Rh+", "0 Rh−", "A Rh+", "A Rh−", "B Rh+", "B Rh−", "AB Rh+", "AB Rh−"] },
    { name: "military_status", label: "Askerlik", type: "select", options: ["", "Yaptı", "Muaf", "Tecilli", "Yapmadı", "—"] },
  ]],
  ["Öğrenim ve ehliyet", [
    { name: "education_level", label: "Öğrenim", type: "select", options: ["", "İlkokul", "Ortaokul", "Lise", "Meslek lisesi", "Ön lisans", "Lisans", "Yüksek lisans", "Doktora"] }, { name: "school", label: "Okul" }, { name: "school_department", label: "Bölüm" }, { name: "graduation_year", label: "Mezuniyet yılı", type: "number" },
    { name: "license_class", label: "Ehliyet sınıfı", type: "select", options: ["", "Yok", "A1", "A2", "A", "B", "BE", "C", "CE", "D", "D1"] }, { name: "license_no", label: "Ehliyet no" }, { name: "license_date", label: "Veriliş tarihi", type: "date" },
  ]],
  ["Banka", [{ name: "bank_name", label: "Banka" }, { name: "iban", label: "IBAN" }, { name: "iban_holder", label: "Hesap sahibi (farklıysa)" }]],
];

export function ProfileChangeForm({ values, pending: hasPending }: { values: Record<string, string>; pending: boolean }) {
  const { state, pending, formProps: actionProps } = useActionForm(requestProfileChange);
  const [open, setOpen] = useState(false);
  if (hasPending) return <p className="text-sm rounded-lg bg-[#FFF4E0] text-[#8A5A00] p-3">Bekleyen bir değişiklik talebiniz var. İK karar verince yenisini gönderebilirsiniz.</p>;
  if (state?.ok) return <p className="text-sm rounded-lg bg-ok-bg text-ok p-3">{state.message}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Bilgilerimi güncellemek istiyorum</button>;
  return (
    <form {...actionProps} className="flex flex-col gap-4">
      <p className="text-xs text-muted">Sadece değiştirmek istediğiniz alanları düzenleyin. Talep İK onayından sonra uygulanır. Ad, TC kimlik ve doğum tarihi gibi kimlik bilgileri için İK&apos;ya başvurun.</p>
      {FIELDS.map(([title, fields]) => (
        <fieldset key={title} className="grid gap-3 sm:grid-cols-2">
          <legend className="font-semibold text-brand-800 mb-1">{title}</legend>
          {fields.map((fd) => (
            <label key={fd.name} className="flex flex-col gap-1 text-sm text-muted">
              {fd.label}
              {fd.type === "select" ? (
                <select name={fd.name} defaultValue={values[fd.name] ?? ""} className={input}>{fd.options!.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select>
              ) : (
                <input name={fd.name} type={fd.type ?? "text"} defaultValue={values[fd.name] ?? ""} className={input} />
              )}
            </label>
          ))}
        </fieldset>
      ))}
      <label className="flex flex-col gap-1 text-sm text-muted">Not (isteğe bağlı)<input name="note" placeholder="ör. taşındım" className={input} /></label>
      <div className="flex flex-wrap gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{pending ? "Gönderiliyor…" : "Onaya gönder"}</button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-sm font-semibold text-muted">Vazgeç</button>
        {state && !state.ok && <span role="status" className="text-sm rounded-lg px-3 py-1.5 bg-bad-bg text-bad">{state.message}</span>}
      </div>
    </form>
  );
}
