import Link from "next/link";
import { saveFaq } from "@/lib/admin-actions";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABELS, type Faq } from "@/lib/cms";
import { UploadForm } from "./UploadForm";
import { I18nField } from "./ui";

export function FaqForm({ faq }: { faq?: Faq }) {
  return (
    <UploadForm
      action={saveFaq}
      folder="medya"
      submitLabel={faq ? "Değişiklikleri kaydet" : "Soruyu ekle"}
      footer={
        <Link href="/admin/sss" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {faq && <input type="hidden" name="id" value={faq.id} />}
      <I18nField name="question" label="Soru" value={faq?.question} required />
      <I18nField name="answer" label="Cevap" value={faq?.answer} multiline rows={4} required hint="Kısa ve net yazın. Google'da soru-cevap olarak görünebilir." />
      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Konu
          <select name="category" defaultValue={faq?.category ?? "genel"} className="field font-normal">
            {FAQ_CATEGORIES.map((k) => (
              <option key={k} value={k}>
                {FAQ_CATEGORY_LABELS[k].tr}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-3 self-end pb-2 text-sm font-semibold text-navy">
          <input type="checkbox" name="is_active" defaultChecked={faq?.is_active ?? true} className="h-5 w-5 accent-navy" />
          Sitede yayında
        </label>
      </div>
    </UploadForm>
  );
}
