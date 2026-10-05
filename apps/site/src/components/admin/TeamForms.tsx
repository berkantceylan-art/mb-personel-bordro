import Link from "next/link";
import { saveDepartment, saveTeamMember } from "@/lib/admin-actions";
import { mediaUrl, type Department, type TeamMember } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { I18nField } from "./ui";

export function DepartmentForm({ dep }: { dep?: Department }) {
  const img = mediaUrl(dep?.image_path);
  const gallery = dep?.gallery ?? [];
  return (
    <UploadForm
      action={saveDepartment}
      folder="medya"
      submitLabel={dep ? "Değişiklikleri kaydet" : "Departmanı ekle"}
      footer={
        <Link href="/admin/departmanlar" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {dep && <input type="hidden" name="id" value={dep.id} />}
      <I18nField name="name" label="Departman adı" value={dep?.name} required />
      <I18nField name="description" label="Kısa açıklama" value={dep?.description} multiline rows={3} hint="Departmanın ne yaptığını 1–2 cümleyle anlatın." />
      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="image">
          Kapak fotoğrafı
        </label>
        <p className="mb-3 text-xs text-slate">Departman kartında görünür. Önerilen: yatay, 1600×1000.</p>
        {img && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-20 rounded-lg object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" name="remove_image" /> Kaldır
            </label>
          </div>
        )}
        <MediaField name="image" kind="image" />
      </div>
      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="gallery">
          Fotoğraf galerisi (isteğe bağlı)
        </label>
        <p className="mb-3 text-xs text-slate">Departmanın çalışma ortamı, cihazlar; en fazla 24 görsel. Sitede kapağa tıklayınca açılır.</p>
        {gallery.length > 0 && (
          <ul className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {gallery.map((p) => (
              <li key={p} className="grid gap-1">
                <input type="hidden" name="gallery_keep" value={p} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(p) ?? ""} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <label className="flex items-center gap-1.5 text-xs text-slate">
                  <input type="checkbox" name="remove_gallery" value={p} /> Kaldır
                </label>
              </li>
            ))}
          </ul>
        )}
        <MediaField name="gallery" kind="image" multiple />
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={dep ? dep.is_active : true} className="h-5 w-5" />
        Yayında
      </label>
    </UploadForm>
  );
}

export function TeamMemberForm({ member, departments }: { member?: TeamMember; departments: Department[] }) {
  const img = mediaUrl(member?.photo_path);
  return (
    <UploadForm
      action={saveTeamMember}
      folder="medya"
      submitLabel={member ? "Değişiklikleri kaydet" : "Çalışanı ekle"}
      footer={
        <Link href="/admin/ekip" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Ad soyad <span className="sr-only">(zorunlu)</span>
          <input name="name" required maxLength={120} defaultValue={member?.name ?? ""} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Departman
          <select name="department_id" defaultValue={member?.department_id ?? ""} className="field font-normal">
            <option value="">— Departmansız —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {t(d.name, "tr")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy sm:col-span-2">
          LinkedIn (isteğe bağlı)
          <input name="linkedin" defaultValue={member?.linkedin ?? ""} placeholder="https://linkedin.com/in/…" className="field font-normal" />
        </label>
      </div>
      <I18nField name="role" label="Görevi / unvanı" value={member?.role} hint="Ör. “Diş protez teknisyeni”, “CAD tasarım sorumlusu”." />
      <I18nField name="bio" label="Kısa tanıtım (isteğe bağlı)" value={member?.bio} multiline rows={2} />
      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="photo">
          Fotoğraf
        </label>
        <p className="mb-3 text-xs text-slate">Kare ya da dikey portre (ör. 800×1000). Çalışanın onayıyla yayınlayın.</p>
        {img && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-20 w-16 rounded-lg object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" name="remove_photo" /> Kaldır
            </label>
          </div>
        )}
        <MediaField name="photo" kind="image" />
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={member ? member.is_active : true} className="h-5 w-5" />
        Sitede görünsün
      </label>
    </UploadForm>
  );
}
