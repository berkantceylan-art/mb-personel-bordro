import Link from "next/link";
import { saveProduct } from "@/lib/admin-actions";
import { PRODUCT_CATEGORIES, mediaUrl, type Product } from "@/lib/cms";
import { PRODUCT_UI } from "@/lib/i18n";
import { UploadForm } from "./UploadForm";
import { I18nField } from "./ui";

const fileCls = "block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-navy file:px-4 file:py-2 file:text-white";

export function ProductForm({ product }: { product?: Product }) {
  const img = mediaUrl(product?.image_path);
  const gallery = product?.gallery ?? [];
  return (
    <UploadForm
      action={saveProduct}
      folder="urunler"
      submitLabel={product ? "Değişiklikleri kaydet" : "Ürünü ekle"}
      footer={
        <>
          <Link href="/admin/urunler" className="px-3 py-3 font-semibold text-slate hover:text-navy">
            Vazgeç
          </Link>
          {product && (
            <Link href={`/tr/urunler/${product.slug}`} target="_blank" className="ml-auto px-3 py-3 text-sm font-semibold text-smile-ink hover:underline">
              Sitede gör ↗
            </Link>
          )}
        </>
      }
    >
      {product && <input type="hidden" name="id" value={product.id} />}

      <I18nField name="name" label="Ürün adı" value={product?.name} required />

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Grup
          <select name="category" defaultValue={product?.category ?? "sabit"} className="field font-normal">
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PRODUCT_UI.tr.categories[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Adres
          <span className="flex items-center rounded-lg border border-gypsum bg-porcelain pl-3 text-sm font-normal text-slate focus-within:border-navy">
            /urunler/
            <input name="slug" defaultValue={product?.slug ?? ""} placeholder="ör. zirkonyum" pattern="[a-z0-9\-]*" className="w-full rounded-r-lg bg-white px-2 py-2 text-ink outline-none" />
          </span>
          <span className="text-xs font-normal text-slate">Boş bırakırsanız Türkçe addan oluşturulur. Değiştirirseniz eski bağlantılar çalışmaz.</span>
        </label>
      </div>

      <I18nField name="summary" label="Kısa açıklama" value={product?.summary} hint="Listelerde ve arama sonuçlarında görünen tek cümle." />

      <I18nField
        name="body"
        label="Sayfa metni"
        value={product?.body}
        multiline
        rows={12}
        hint="Paragrafları boş bir satırla ayırın. Ara başlık için satırı “## ” ile, alıntı için “> ” ile başlatın."
      />

      <I18nField name="highlights" label="Öne çıkanlar" value={product?.highlights} multiline hint="Her satıra bir madde. Boş bırakılırsa gösterilmez." />

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="image">
          Ana görsel
        </label>
        <p className="mb-3 text-xs text-slate">Ürün sayfasının üstünde ve listelerde. Önerilen: 1600×1200 ya da daha büyük.</p>
        {img && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-20 rounded-lg object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" name="remove_image" /> Kaldır
            </label>
          </div>
        )}
        <input id="image" type="file" name="image" accept="image/*" className={fileCls} />
      </div>

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="gallery">
          Galeri
        </label>
        <p className="mb-3 text-xs text-slate">Birden fazla görsel seçebilirsiniz; en fazla 24. Kaldırmak istediklerinizi işaretleyin.</p>
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
        <input id="gallery" type="file" name="gallery" accept="image/*" multiple className={fileCls} />
      </div>

      <details className="rounded-xl border border-gypsum bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-navy">Arama motoru ayarları (isteğe bağlı)</summary>
        <div className="mt-4 grid gap-4">
          <I18nField name="seo_title" label="Sayfa başlığı" value={product?.seo_title} hint="Boşsa ürün adı kullanılır." />
          <I18nField name="seo_description" label="Açıklama" value={product?.seo_description} multiline rows={2} hint="Boşsa kısa açıklama kullanılır. 150–160 karakter idealdir." />
        </div>
      </details>

      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={product ? product.is_active : true} className="h-5 w-5" />
        Yayında
      </label>
    </UploadForm>
  );
}
