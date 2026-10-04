import Link from "next/link";
import { saveStory } from "@/lib/admin-actions";
import { mediaUrl, type Story } from "@/lib/cms";
import { MediaField } from "./MediaField";
import { StoryFramesEditor } from "./StoryFramesEditor";
import { UploadForm } from "./UploadForm";
import { I18nField, toLocalInput } from "./ui";

export function StoryForm({ story }: { story?: Story }) {
  const cover = mediaUrl(story?.cover_path);
  return (
    <UploadForm
      action={saveStory}
      folder="medya"
      submitLabel={story ? "Değişiklikleri kaydet" : "Hikâyeyi ekle"}
      footer={
        <Link href="/admin/hikayeler" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      }
    >
      {story && <input type="hidden" name="id" value={story.id} />}
      <I18nField name="title" label="Başlık" value={story?.title} required hint="Yuvarlak kapağın altında görünür; kısa tutun (ör. “Laboratuvar”, “Yeni CNC”)." />

      <StoryFramesEditor initial={story?.frames ?? []} />

      <div className="rounded-xl border border-gypsum bg-white p-4">
        <label className="block text-sm font-semibold text-navy" htmlFor="cover">
          Kapak (isteğe bağlı)
        </label>
        <p className="mb-3 text-xs text-slate">Yuvarlak içinde görünen kare görsel. Boş bırakırsanız ilk kare kullanılır.</p>
        {cover && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" className="h-16 w-16 rounded-full object-cover" />
            <label className="flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" name="remove_cover" /> Kaldır
            </label>
          </div>
        )}
        <MediaField name="cover" kind="image" />
      </div>

      <I18nField name="link_label" label="Bağlantı yazısı (isteğe bağlı)" value={story?.link_label} hint="Hikâyenin altında düğme olarak görünür, ör. “Vaka gönder”." />
      <label className="grid gap-1 text-sm font-semibold text-navy">
        Bağlantı adresi
        <input name="link_href" defaultValue={story?.link_href ?? ""} placeholder="/tr/urunler/zirkonyum ya da https://…" className="field font-normal" />
      </label>

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Başlangıç
          <input type="datetime-local" name="starts_at" defaultValue={toLocalInput(story?.starts_at)} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Bitiş
          <input type="datetime-local" name="ends_at" defaultValue={toLocalInput(story?.ends_at)} className="field font-normal" />
        </label>
        <p className="text-xs text-slate sm:col-span-2">Saatler İstanbul saatidir. Boş bırakırsanız hikâye süresiz yayında kalır.</p>
      </div>

      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={story ? story.is_active : true} className="h-5 w-5" />
        Yayında
      </label>
    </UploadForm>
  );
}
