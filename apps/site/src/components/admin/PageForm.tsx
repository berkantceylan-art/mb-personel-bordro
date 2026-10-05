import Link from "next/link";
import { savePage } from "@/lib/admin-actions";
import { mediaUrl, type SitePage } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { AiSeoButton } from "./AiButtons";
import { I18nField } from "./ui";

export const PAGE_GROUP_LABELS: Record<SitePage["group"], string> = { kurumsal: "Kurumsal", teknoloji: "Teknoloji", kalite: "Kalite", diger: "Diğer" };

export function PageForm({ page }: { page?: SitePage }) {
  const img = mediaUrl(page?.image_path);
  const gallery = page?.gallery ?? [];
  return (
    <UploadForm
      action={savePage}
      folder="medya"
      submitLabel={page ? "Değişiklikleri kaydet" : "Sayfayı ekle"}
      footer={
        <>
          <Link href="/admin/sayfalar" className="px-3 py-3 font-semibold text-slate hover:text-navy">
            Vazgeç
          </Link>
          {page && (
            <Link href={`/tr/${page.slug}`} target="_blank" className="ml-auto px-3 py-3 text-sm font-semibold text-smile-ink hover:underline">
              Sitede gör ↗
            </Link>
          )}
        </>
      }
    >
      {page && <input type="hidden" name="id" value={page.id} />}
      <I18nField name="title" label="Sayfa başlığı" value={page?.title} required />

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Grup
          <select name="group" defaultValue={page?.group ?? "kurumsal"} className="field font-normal">
            {Object.entries(PAGE_GROUP_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-slate">Teknoloji ve Kalite sayfaları anasayfadaki ilgili bölümden de bağlanır.</span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Adres
          <span className="flex items-center rounded-lg border border-gypsum bg-porcelain pl-3 text-sm font-normal text-slate focus-within:border-navy">
            /tr/
            <input name="slug" defaultValue={page?.slug ?? ""} placeholder="ör. hakkimizda" pattern="[a-z0-9\-]*" className="w-full rounded-r-lg bg-white px-2 py-2 text-ink outline-none" />
          </span>
          <span className="text-xs font-normal text-slate">Boş bırakırsanız başlıktan oluşturulur. Değiştirirseniz eski bağlantılar çalışmaz.</span>
        </label>
      </div>

      <I18nField name="summary" label="Kısa açıklama" value={page?.summary} hint="Başlığın altında ve arama sonuçlarında görünen tek cümle." />
      <I18nField
        name="body"
        label="Sayfa metni"
        value={page?.body}
        multiline
        rows={14}
        hint="Paragrafları boş satırla ayırın. “## ” ara başlık, “> ” alıntı, “- ” ile başlayan satırlar madde listesi olur."
      />

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="image">
          Üst görsel (isteğe bağlı)
        </label>
        <p className="mb-3 text-xs text-slate">Başlığın yanında görünür. Önerilen: 1600×1200.</p>
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
          Galeri (isteğe bağlı)
        </label>
        <p className="mb-3 text-xs text-slate">Metnin altında görünür; en fazla 24 görsel.</p>
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

      <details className="rounded-xl border border-gypsum bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-navy">Arama motoru ayarları (isteğe bağlı)</summary>
        <div className="mt-4 grid gap-4">
          {!!process.env.ANTHROPIC_API_KEY && <AiSeoButton source={{ title: "title", summary: "summary", body: "body" }} />}
          <I18nField name="seo_title" label="Sayfa başlığı" value={page?.seo_title} hint="Boşsa sayfa başlığı kullanılır." />
          <I18nField name="seo_description" label="Açıklama" value={page?.seo_description} multiline rows={2} hint="Boşsa kısa açıklama kullanılır." />
        </div>
      </details>

      <div className="grid gap-3">
        <label className="flex items-center gap-3 text-sm font-semibold text-navy">
          <input type="checkbox" name="show_in_footer" defaultChecked={page ? page.show_in_footer : true} className="h-5 w-5" />
          Alt bilgide (sayfa sonunda) bağlantısı görünsün
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold text-navy">
          <input type="checkbox" name="is_active" defaultChecked={page ? page.is_active : true} className="h-5 w-5" />
          Yayında
        </label>
      </div>
    </UploadForm>
  );
}
