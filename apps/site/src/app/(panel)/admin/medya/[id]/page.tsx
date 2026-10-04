import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { CopyButton } from "@/components/admin/CopyButton";
import { UploadForm } from "@/components/admin/UploadForm";
import { Flash, I18nField, PageHead, formatTr } from "@/components/admin/ui";
import { deleteMedia, updateMedia } from "@/lib/admin-actions";
import { mediaUrl } from "@/lib/cms";
import { formatSize, mediaKind, mediaName, type MediaItem } from "@/lib/media";
import { mediaUsage } from "@/lib/media-server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dosya" };

export default async function MediaDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { id } = await params;
  const { hata } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_media").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as MediaItem;
  const url = mediaUrl(m.path) ?? "";
  const kind = mediaKind(m.mime, m.path);
  const uses = (await mediaUsage()).get(m.path) ?? [];

  return (
    <>
      <PageHead title={m.title || mediaName(m.path)} />
      <Flash hata={hata} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <div className="overflow-hidden rounded-2xl border border-gypsum bg-[repeating-conic-gradient(#e3e9ef_0_25%,#f3f6f9_0_50%)] bg-[length:20px_20px]">
            {kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={m.title ?? ""} className="mx-auto max-h-[32rem] w-auto object-contain" />
            )}
            {kind === "video" && <video src={url} controls playsInline className="mx-auto max-h-[32rem] w-full bg-ink" />}
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-gypsum bg-white p-5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate">Tür</dt>
              <dd className="font-semibold">{m.mime ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate">Boyut</dt>
              <dd className="font-semibold">{formatSize(m.size)}</dd>
            </div>
            <div>
              <dt className="text-slate">Ölçü</dt>
              <dd className="font-semibold">{m.width && m.height ? `${m.width}×${m.height}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate">Yüklendi</dt>
              <dd className="font-semibold">{formatTr(m.created_at)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={url} />
            <a href={url} target="_blank" rel="noreferrer" className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
              Yeni sekmede aç ↗
            </a>
          </div>
        </div>

        <div className="grid content-start gap-6">
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display text-lg font-semibold text-navy">Kullanıldığı yerler</h2>
            {uses.length === 0 ? (
              <p className="mt-2 text-sm text-slate">Bu dosya şu an hiçbir yerde kullanılmıyor.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gypsum text-sm">
                {uses.map((u, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-slate">{u.type}</span>
                    <Link href={u.href} className="font-semibold text-navy hover:underline">
                      {u.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <UploadForm
            action={updateMedia}
            folder="medya"
            submitLabel="Bilgileri kaydet"
            footer={
              <Link href="/admin/medya" className="px-3 py-3 font-semibold text-slate hover:text-navy">
                Kütüphaneye dön
              </Link>
            }
          >
            <input type="hidden" name="id" value={m.id} />
            <label className="grid gap-1 text-sm font-semibold text-navy">
              Ad
              <input name="title" defaultValue={m.title ?? ""} className="field font-normal" />
              <span className="text-xs font-normal text-slate">Yalnız kütüphanede aramak için.</span>
            </label>
            <I18nField
              name="alt"
              label="Açıklama (alt metin)"
              value={m.alt}
              hint="Görseli göremeyenler ve arama motorları için kısa açıklama, ör. “Frezelenmiş zirkon köprü”."
            />
          </UploadForm>

          <form action={deleteMedia} className="rounded-2xl border border-gypsum bg-white p-5">
            <input type="hidden" name="id" value={m.id} />
            <h2 className="display text-lg font-semibold text-navy">Dosyayı sil</h2>
            <p className="mt-1 text-sm text-slate">
              {uses.length > 0 ? "Kullanılan dosya silinemez. Önce yukarıdaki yerlerden kaldırın." : "Dosya depodan kalıcı olarak silinir. Geri alınamaz."}
            </p>
            {uses.length === 0 && (
              <ConfirmButton
                message="Dosya kalıcı olarak silinecek. Devam edilsin mi?"
                className="mt-3 rounded-full border border-bad px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-bg"
              >
                Kalıcı sil
              </ConfirmButton>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
