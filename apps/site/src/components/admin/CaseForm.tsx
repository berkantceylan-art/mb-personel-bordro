import Link from "next/link";
import { saveCase } from "@/lib/admin-actions";
import { mediaUrl, type CaseItem } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { I18nField } from "./ui";

function Single({ name, label, hint, path }: { name: string; label: string; hint: string; path: string | null | undefined }) {
  const url = mediaUrl(path);
  return (
    <div className="rounded-xl border border-gypsum bg-white p-4">
      <label className="block text-sm font-semibold text-navy" htmlFor={name}>
        {label}
      </label>
      <p className="mb-3 text-xs text-slate">{hint}</p>
      {url && (
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-20 rounded-lg object-cover" />
          <label className="flex items-center gap-2 text-sm text-slate">
            <input type="checkbox" name={`remove_${name}`} /> Kaldır
          </label>
        </div>
      )}
      <MediaField name={name} kind="image" />
    </div>
  );
}

export function CaseForm({ item, products }: { item?: CaseItem; products: { slug: string; name: string }[] }) {
  const gallery = item?.gallery ?? [];
  return (
    <UploadForm
      action={saveCase}
      folder="medya"
      submitLabel={item ? "Değişiklikleri kaydet" : "Vakayı ekle"}
      footer={
        <Link href="/admin/vakalar" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <I18nField name="title" label="Başlık" value={item?.title} required hint="Ör. “Üst ön bölge, full anatomik zirkon köprü”." />
      <I18nField name="description" label="Açıklama (isteğe bağlı)" value={item?.description} multiline rows={3} />

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Ürün
          <select name="product_slug" defaultValue={item?.product_slug ?? ""} className="field font-normal">
            <option value="">— Seçilmedi —</option>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-slate">Seçerseniz vaka o ürünün sayfasında da görünür.</span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Dişler (isteğe bağlı)
          <input name="teeth" defaultValue={item?.teeth ?? ""} placeholder="ör. 13–23" maxLength={80} className="field font-normal" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Single name="before" label="Öncesi" hint="Model ya da başlangıç durumu. Sonrası ile aynı açıdan çekilmesi karşılaştırmayı güzelleştirir." path={item?.before_path} />
        <Single name="after" label="Sonrası" hint="Bitmiş iş. Yalnız bu doluysa tek görsel olarak gösterilir." path={item?.after_path} />
      </div>
      <p className="-mt-2 text-xs text-slate">Hasta yüzü görünen fotoğraflar için hastanın yazılı onayı olduğundan emin olun.</p>

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="gallery">
          Ek görseller (isteğe bağlı)
        </label>
        {gallery.length > 0 && (
          <ul className="my-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
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
        <div className="mt-3">
          <MediaField name="gallery" kind="image" multiple />
        </div>
      </div>

      <div className="grid gap-3">
        <label className="flex items-center gap-3 text-sm font-semibold text-navy">
          <input type="checkbox" name="featured" defaultChecked={item?.featured ?? false} className="h-5 w-5" />
          Anasayfada öne çıkar
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold text-navy">
          <input type="checkbox" name="is_active" defaultChecked={item ? item.is_active : true} className="h-5 w-5" />
          Yayında
        </label>
      </div>
    </UploadForm>
  );
}
