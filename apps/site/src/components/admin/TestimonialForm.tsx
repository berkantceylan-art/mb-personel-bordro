import Link from "next/link";
import { saveTestimonial } from "@/lib/admin-actions";
import { mediaUrl, type Testimonial } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { I18nField } from "./ui";

export function TestimonialForm({ item }: { item?: Testimonial }) {
  const img = mediaUrl(item?.photo_path);
  return (
    <UploadForm action={saveTestimonial} folder="medya" submitLabel={item ? "Kaydet" : "Görüşü ekle"} footer={<Link href="/admin/gorusler" className="px-3 py-3 font-semibold text-slate hover:text-navy">Vazgeç</Link>}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <p className="rounded-xl bg-warn-bg p-4 text-sm text-warn">Yalnız gerçek ve yayın izni alınmış görüşleri ekleyin. Hekimin söylediğini değiştirmeyin; çeviri ekleyebilirsiniz. İzin kutusu işaretlenmeden görüş yayınlanmaz.</p>
      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">Ad soyad *<input name="name" required defaultValue={item?.name ?? ""} placeholder="Dr. Ayşe Yılmaz" className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Ünvan / klinik<input name="role" defaultValue={item?.role ?? ""} placeholder="Diş hekimi · Gülüş Kliniği" className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Şehir<input name="city" defaultValue={item?.city ?? ""} className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Ülke<input name="country" defaultValue={item?.country ?? ""} className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Puan (isteğe bağlı)
          <select name="rating" defaultValue={item?.rating ? String(item.rating) : ""} className="field font-normal">
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Kaynak (iç not)<input name="source" defaultValue={item?.source ?? ""} placeholder="ör. 12.10.2026 e-postası, Google yorumu" className="field font-normal" /></label>
      </div>
      <I18nField name="quote" label="Görüş" value={item?.quote} multiline rows={4} required />
      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="photo">Fotoğraf (isteğe bağlı, izinli)</label>
        {img && (
          <div className="my-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-16 w-16 rounded-full object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate"><input type="checkbox" name="remove_photo" /> Kaldır</label>
          </div>
        )}
        <MediaField name="photo" kind="image" />
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="consent" defaultChecked={item?.consent ?? false} className="h-5 w-5" />
        Hekimden yayın izni alındı
      </label>
      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={item ? item.is_active : false} className="h-5 w-5" />
        Yayında
      </label>
    </UploadForm>
  );
}
