import Link from "next/link";
import { saveAnnouncement } from "@/lib/admin-actions";
import { mediaUrl, type Announcement } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { I18nField, toLocalInput } from "./ui";

const KINDS: { value: Announcement["kind"]; label: string; note: string }[] = [
  { value: "banner", label: "Üst bant", note: "Sayfanın en üstünde ince şerit. Aynı anda en yüksek öncelikli olan görünür." },
  { value: "news", label: "Haber", note: "Anasayfadaki Duyurular listesinde görünür." },
  { value: "popup", label: "Açılır pencere", note: "Ziyaretçiye bir kez gösterilir (portal ile birlikte devreye girecek)." },
];

export function AnnouncementForm({ item }: { item?: Announcement }) {
  const img = mediaUrl(item?.image_path);
  return (
    <UploadForm
      action={saveAnnouncement}
      folder="duyurular"
      submitLabel={item ? "Değişiklikleri kaydet" : "Duyuruyu ekle"}
      footer={
        <Link href="/admin/duyurular" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {item && <input type="hidden" name="id" value={item.id} />}

      <fieldset className="rounded-xl border border-gypsum bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-navy">Tür</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label key={k.value} className="flex cursor-pointer gap-3 rounded-lg border border-gypsum p-3 has-[:checked]:border-navy has-[:checked]:bg-porcelain">
              <input type="radio" name="kind" value={k.value} defaultChecked={(item?.kind ?? "banner") === k.value} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-navy">{k.label}</span>
                <span className="block text-xs text-slate">{k.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <I18nField name="title" label="Başlık" value={item?.title} required />
      <I18nField name="body" label="Metin" value={item?.body} multiline />

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="image">
          Görsel (isteğe bağlı)
        </label>
        {img && (
          <div className="my-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-20 rounded-lg object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" name="remove_image" /> Kaldır
            </label>
          </div>
        )}
        <div className="mt-2">
          <MediaField name="image" kind="image" />
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Bağlantı
          <input name="link_href" defaultValue={item?.link_href ?? ""} placeholder="/tr#teslimat ya da https://…" className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Kime görünsün
          <select name="audience" defaultValue={item?.audience ?? "public"} className="field font-normal">
            <option value="public">Sitedeki herkes</option>
            <option value="portal">Yalnız portal kullanıcıları (hekim, klinik, aracı)</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Başlangıç
          <input type="datetime-local" name="starts_at" defaultValue={toLocalInput(item?.starts_at)} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Bitiş
          <input type="datetime-local" name="ends_at" defaultValue={toLocalInput(item?.ends_at)} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Öncelik
          <input type="number" name="priority" defaultValue={item?.priority ?? 0} className="field font-normal" />
        </label>
        <p className="self-end text-xs text-slate">Yüksek öncelik önce gösterilir. Saatler İstanbul saatidir.</p>
      </div>

      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={item ? item.is_active : true} className="h-5 w-5" />
        Yayında
      </label>

    </UploadForm>
  );
}
