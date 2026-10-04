"use client";
import { useActionForm } from "@/lib/use-action-form";
import { saveEmployee } from "./employee-actions";

export type EmployeeFormValues = Record<string, string | number | null | undefined>;

type Field = {
  name: string;
  label: string;
  type?: "text" | "date" | "number" | "email" | "tel" | "select" | "textarea";
  options?: string[];
  required?: boolean;
  placeholder?: string;
  wide?: boolean;
};

const SECTIONS: Array<{ title: string; fields: Field[] }> = [
  {
    title: "Kimlik bilgileri",
    fields: [
      { name: "national_id", label: "TC kimlik no", placeholder: "11 hane" },
      { name: "sgk_no", label: "SGK sicil no" },
      { name: "birth_date", label: "Doğum tarihi", type: "date" },
      { name: "birth_place", label: "Doğum yeri" },
      { name: "gender", label: "Cinsiyet", type: "select", options: ["", "Kadın", "Erkek"] },
      { name: "nationality", label: "Uyruk" },
      { name: "father_name", label: "Baba adı" },
      { name: "mother_name", label: "Anne adı" },
      { name: "marital_status", label: "Medeni durum", type: "select", options: ["", "Bekâr", "Evli", "Boşanmış", "Dul"] },
      { name: "children_count", label: "Çocuk sayısı", type: "number" },
      { name: "blood_type", label: "Kan grubu", type: "select", options: ["", "0 Rh+", "0 Rh−", "A Rh+", "A Rh−", "B Rh+", "B Rh−", "AB Rh+", "AB Rh−"] },
      { name: "military_status", label: "Askerlik durumu", type: "select", options: ["", "Yaptı", "Muaf", "Tecilli", "Yapmadı", "—"] },
    ],
  },
  {
    title: "İletişim ve adres",
    fields: [
      { name: "phone", label: "Cep telefonu", type: "tel" },
      { name: "phone2", label: "İkinci telefon", type: "tel" },
      { name: "email", label: "E-posta", type: "email" },
      { name: "city", label: "İl" },
      { name: "district", label: "İlçe" },
      { name: "address", label: "Açık adres", type: "textarea", wide: true },
      { name: "emergency_contact_name", label: "Acil durumda aranacak kişi" },
      { name: "emergency_contact_relation", label: "Yakınlığı" },
      { name: "emergency_contact_phone", label: "Acil durum telefonu", type: "tel" },
    ],
  },
  {
    title: "Öğrenim",
    fields: [
      { name: "education_level", label: "Öğrenim durumu", type: "select", options: ["", "İlkokul", "Ortaokul", "Lise", "Meslek lisesi", "Ön lisans", "Lisans", "Yüksek lisans", "Doktora"] },
      { name: "school", label: "Okul" },
      { name: "school_department", label: "Bölüm" },
      { name: "graduation_year", label: "Mezuniyet yılı", type: "number" },
      { name: "diploma_no", label: "Diploma no" },
    ],
  },
  {
    title: "Ehliyet",
    fields: [
      { name: "license_class", label: "Ehliyet sınıfı", type: "select", options: ["", "Yok", "A1", "A2", "A", "B", "BE", "C", "CE", "D", "D1"] },
      { name: "license_no", label: "Ehliyet no" },
      { name: "license_date", label: "Veriliş tarihi", type: "date" },
    ],
  },
  {
    title: "Banka",
    fields: [
      { name: "bank_name", label: "Banka" },
      { name: "iban", label: "IBAN", placeholder: "TR00 0000 0000 0000 0000 0000 00" },
      { name: "iban_holder", label: "Hesap sahibi" },
    ],
  },
];

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-ink bg-white w-full";

function FieldInput({ f, v }: { f: Field; v: EmployeeFormValues }) {
  const val = v[f.name] ?? "";
  if (f.type === "select")
    return (
      <select name={f.name} defaultValue={String(val)} className={input}>
        {f.options!.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    );
  if (f.type === "textarea") return <textarea name={f.name} defaultValue={String(val)} rows={2} className={`${input} h-auto py-2`} />;
  return <input type={f.type ?? "text"} name={f.name} defaultValue={String(val)} required={f.required} placeholder={f.placeholder} className={input} />;
}

export function EmployeeForm({
  values,
  branches,
  departments,
  isNew,
}: {
  values: EmployeeFormValues;
  branches: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  isNew: boolean;
}) {
  const { state, pending, formProps: actionProps } = useActionForm(saveEmployee);
  return (
    <form {...actionProps} className="flex flex-col gap-5">
      {values.id && <input type="hidden" name="id" value={String(values.id)} />}
      <fieldset className="bg-white border border-line rounded-2xl p-5 grid gap-4 md:grid-cols-3">
        <legend className="font-display font-semibold text-brand-800 px-1">Görev bilgileri</legend>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Ad *<input name="first_name" required defaultValue={String(values.first_name ?? "")} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Soyad *<input name="last_name" required defaultValue={String(values.last_name ?? "")} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">PDKS / kart no<input name="card_no" defaultValue={String(values.card_no ?? "")} placeholder="ör. 35084" className={`${input} num`} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Şube *
          <select name="branch_id" required defaultValue={String(values.branch_id ?? branches[0]?.id ?? "")} className={input}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Bölüm
          <select name="department_id" defaultValue={String(values.department_id ?? "")} className={input}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">veya yeni bölüm<input name="new_department" placeholder="Yeni bölüm adı" className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Görevi / ünvanı<input name="position_title" defaultValue={String(values.position_title ?? "")} className={input} /></label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">İşe giriş tarihi *<input type="date" name="hire_date" required defaultValue={String(values.hire_date ?? "")} className={input} /></label>
      </fieldset>

      {isNew && (
        <fieldset className="bg-white border border-line rounded-2xl p-5 grid gap-4 md:grid-cols-3">
          <legend className="font-display font-semibold text-brand-800 px-1">Ücret</legend>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Aylık toplam net ücret<input name="total_net" inputMode="decimal" placeholder="ör. 65.000" className={`${input} num`} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Sigorta
            <select name="insurance_type" className={input}><option value="MIN_WAGE">Asgari ücretten</option><option value="FIXED_NET">Belirli net üzerinden</option></select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Resmi net (belirli net ise)<input name="fixed_official_net" inputMode="decimal" placeholder="ör. 30.000" className={`${input} num`} /></label>
          <label className="flex gap-2.5 items-center text-sm"><input type="checkbox" name="bes" className="w-5 h-5" />Otomatik katılım BES (%3)</label>
        </fieldset>
      )}

      {SECTIONS.map((sec) => (
        <fieldset key={sec.title} className="bg-white border border-line rounded-2xl p-5 grid gap-4 md:grid-cols-3">
          <legend className="font-display font-semibold text-brand-800 px-1">{sec.title}</legend>
          {sec.fields.map((f) => (
            <label key={f.name} className={`flex flex-col gap-1.5 text-sm text-muted ${f.wide ? "md:col-span-3" : ""}`}>
              {f.label}
              <FieldInput f={f} v={values} />
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="bg-white border border-line rounded-2xl p-5">
        <legend className="font-display font-semibold text-brand-800 px-1">Notlar</legend>
        <textarea name="notes" rows={3} defaultValue={String(values.notes ?? "")} className={`${input} h-auto py-2`} />
      </fieldset>

      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <div className="sticky bottom-0 bg-ground py-3">
        <button disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">
          {pending ? "Kaydediliyor…" : isNew ? "Personeli kaydet" : "Değişiklikleri kaydet"}
        </button>
      </div>
    </form>
  );
}
