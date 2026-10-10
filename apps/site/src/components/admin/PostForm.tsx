import Link from "next/link";
import { savePost } from "@/lib/admin-actions";
import { mediaUrl, type Post } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { UploadForm } from "./UploadForm";
import { AiSeoButton } from "./AiButtons";
import { I18nField, toLocalInput } from "./ui";

export const POST_CATEGORY_LABELS: Record<Post["category"], string> = { rehber: "Hekim rehberi", vaka: "Vaka hikâyesi", teknoloji: "Teknoloji", malzeme: "Malzeme", haber: "Haber" };

export function PostForm({ post }: { post?: Post }) {
  const img = mediaUrl(post?.image_path);
  return (
    <UploadForm
      action={savePost}
      folder="medya"
      submitLabel={post ? "Değişiklikleri kaydet" : "Yazıyı ekle"}
      footer={
        <>
          <Link href="/admin/blog" className="px-3 py-3 font-semibold text-slate hover:text-navy">Vazgeç</Link>
          {post && (
            <Link href={`/tr/blog/${post.slug}`} target="_blank" className="ml-auto px-3 py-3 text-sm font-semibold text-smile-ink hover:underline">Sitede gör ↗</Link>
          )}
        </>
      }
    >
      {post && <input type="hidden" name="id" value={post.id} />}
      <I18nField name="title" label="Başlık" value={post?.title} required />
      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Kategori
          <select name="category" defaultValue={post?.category ?? "rehber"} className="field font-normal">
            {Object.entries(POST_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Adres
          <span className="flex items-center rounded-lg border border-gypsum bg-porcelain pl-3 text-sm font-normal text-slate focus-within:border-navy">
            /blog/
            <input name="slug" defaultValue={post?.slug ?? ""} placeholder="başlıktan oluşur" pattern="[a-z0-9\-]*" className="w-full rounded-r-lg bg-white px-2 py-2 text-ink outline-none" />
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Yazar
          <input name="author" defaultValue={post?.author ?? ""} placeholder="ör. MB Dental CAD ekibi" className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy sm:col-span-2">
          Etiketler (virgülle)
          <input name="tags" defaultValue={post?.tags?.join(", ") ?? ""} placeholder="zirkonyum, dijital ölçü" className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Yayın zamanı
          <input type="datetime-local" name="publish_at" defaultValue={toLocalInput(post?.publish_at)} className="field font-normal" />
          <span className="text-xs font-normal text-slate">Boşsa hemen. İleri tarih = zamanlanmış yayın.</span>
        </label>
      </div>
      <I18nField name="summary" label="Özet" value={post?.summary} hint="Liste ve arama sonuçlarında görünen 1–2 cümle." />
      <I18nField name="body" label="Yazı" value={post?.body} multiline rows={18} hint="Paragrafları boş satırla ayırın. “## ” ara başlık, “> ” alıntı, “- ” madde listesi." />
      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="image">Kapak görseli</label>
        <p className="mb-3 text-xs text-slate">Önerilen: 1600×900. Paylaşımlarda da kullanılır.</p>
        {img && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="h-20 rounded-lg object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate"><input type="checkbox" name="remove_image" /> Kaldır</label>
          </div>
        )}
        <MediaField name="image" kind="image" />
      </div>
      <details className="rounded-xl border border-gypsum bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-navy">Arama motoru ayarları</summary>
        <div className="mt-4 grid gap-4">
          {!!process.env.ANTHROPIC_API_KEY && <AiSeoButton source={{ title: "title", summary: "summary", body: "body" }} />}
          <I18nField name="seo_title" label="SEO başlığı" value={post?.seo_title} hint="Boşsa başlık kullanılır." />
          <I18nField name="seo_description" label="SEO açıklaması" value={post?.seo_description} multiline rows={2} hint="Boşsa özet kullanılır." />
        </div>
      </details>
      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={post ? post.is_active : true} className="h-5 w-5" />
        Yayında
      </label>
    </UploadForm>
  );
}
