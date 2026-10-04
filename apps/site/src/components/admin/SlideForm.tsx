import Link from "next/link";
import { saveSlide } from "@/lib/admin-actions";
import { mediaUrl, type Slide } from "@/lib/cms";
import { I18nField, toLocalInput } from "./ui";

function MediaInput({ name, label, accept, current, hint }: { name: string; label: string; accept: string; current: string | null; hint: string }) {
  const url = mediaUrl(current);
  return (
    <div className="rounded-xl border border-gypsum bg-white p-4">
      <label className="block text-sm font-semibold text-navy" htmlFor={name}>
        {label}
      </label>
      <p className="mb-3 text-xs text-slate">{hint}</p>
      {url && (
        <div className="mb-3 flex items-center gap-3">
          {accept.startsWith("video") ? (
            <video src={url} className="h-20 rounded-lg" muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-20 rounded-lg object-cover" />
          )}
          <label className="flex items-center gap-2 text-sm text-slate">
            <input type="checkbox" name={`remove_${name}`} /> Kaldır
          </label>
        </div>
      )}
      <input id={name} type="file" name={name} accept={accept} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-navy file:px-4 file:py-2 file:text-white" />
    </div>
  );
}

export function SlideForm({ slide }: { slide?: Slide }) {
  return (
    <form action={saveSlide} className="grid max-w-3xl gap-5">
      {slide && <input type="hidden" name="id" value={slide.id} />}
      <I18nField name="title" label="Başlık" value={slide?.title} required />
      <I18nField name="subtitle" label="Alt başlık" value={slide?.subtitle} multiline hint="Kısa tutun: bir ya da iki cümle." />

      <MediaInput name="image" label="Görsel (masaüstü)" accept="image/*" current={slide?.image_path ?? null} hint="Önerilen: 1600×1200 ya da daha büyük, en fazla 50 MB. WebP ya da JPG." />
      <MediaInput name="image_mobile" label="Görsel (mobil, isteğe bağlı)" accept="image/*" current={slide?.image_mobile_path ?? null} hint="Boş bırakırsanız mobilde masaüstü görseli kullanılır." />
      <MediaInput name="video" label="Video (isteğe bağlı)" accept="video/mp4,video/webm" current={slide?.video_path ?? null} hint="MP4 ya da WebM, en fazla 50 MB." />

      <I18nField name="button_label" label="Buton yazısı" value={slide?.button_label} hint="Boş bırakılırsa buton gösterilmez." />
      <label className="grid gap-1 text-sm font-semibold text-navy">
        Buton bağlantısı
        <input name="button_href" defaultValue={slide?.button_href ?? ""} placeholder="/tr/vaka-gonder ya da https://…" className="field font-normal" />
      </label>

      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Yer
          <select name="placement" defaultValue={slide?.placement ?? "home"} className="field font-normal">
            <option value="home">Anasayfa</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Başlangıç
          <input type="datetime-local" name="starts_at" defaultValue={toLocalInput(slide?.starts_at)} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">
          Bitiş
          <input type="datetime-local" name="ends_at" defaultValue={toLocalInput(slide?.ends_at)} className="field font-normal" />
        </label>
        <p className="text-xs text-slate sm:col-span-3">Saatler İstanbul saatidir. Bitiş tarihi gelince slayt kendiliğinden yayından kalkar.</p>
      </div>

      <label className="flex items-center gap-3 text-sm font-semibold text-navy">
        <input type="checkbox" name="is_active" defaultChecked={slide ? slide.is_active : true} className="h-5 w-5" />
        Yayında
      </label>

      <div className="flex gap-3">
        <button type="submit" className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
          {slide ? "Değişiklikleri kaydet" : "Slaytı ekle"}
        </button>
        <Link href="/admin/slaytlar" className="px-3 py-3 font-semibold text-slate hover:text-navy">
          Vazgeç
        </Link>
      </div>
    </form>
  );
}
