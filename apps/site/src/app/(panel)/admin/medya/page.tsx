import Link from "next/link";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { Flash, PageHead } from "@/components/admin/ui";
import { mediaUrl } from "@/lib/cms";
import { formatSize, mediaKind, mediaName, type MediaItem } from "@/lib/media";
import { mediaUsage } from "@/lib/media-server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Medya kütüphanesi" };

const PAGE = 60;
const TABS: [string, string][] = [
  ["", "Tümü"],
  ["gorsel", "Görseller"],
  ["video", "Videolar"],
  ["bos", "Kullanılmayanlar"],
];

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ tur?: string; q?: string; sayfa?: string; ok?: string; hata?: string }> }) {
  const { tur = "", q = "", sayfa = "1", ok, hata } = await searchParams;
  const page = Math.max(1, Number.parseInt(sayfa, 10) || 1);
  const supabase = await createClient();
  const [{ data }, usage] = await Promise.all([supabase.from("cms_media").select("*").order("created_at", { ascending: false }), mediaUsage()]);
  const all = (data ?? []) as MediaItem[];
  const term = q.trim().toLocaleLowerCase("tr");
  const filtered = all.filter((m) => {
    const kind = mediaKind(m.mime, m.path);
    if (tur === "gorsel" && kind !== "image") return false;
    if (tur === "video" && kind !== "video") return false;
    if (tur === "bos" && usage.has(m.path)) return false;
    if (term && !`${m.title ?? ""} ${m.path}`.toLocaleLowerCase("tr").includes(term)) return false;
    return true;
  });
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const qs = (p: Record<string, string>) => {
    const s = new URLSearchParams({ ...(tur ? { tur } : {}), ...(q ? { q } : {}), ...p });
    const str = s.toString();
    return str ? `/admin/medya?${str}` : "/admin/medya";
  };

  return (
    <>
      <PageHead title="Medya kütüphanesi" lead="Sitede kullanılan tüm görsel ve videolar. Formlarda “Kütüphaneden seç” ile buradan seçebilirsiniz." action={{ href: "/admin/medya/otomatik", label: "Görselleri içeriklere yerleştir" }} />
      <Flash ok={ok} hata={hata} />
      <MediaUploader />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filtre" className="flex flex-wrap gap-2 text-sm">
          {TABS.map(([k, label]) => (
            <Link
              key={k}
              href={k ? `/admin/medya?tur=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}` : q ? `/admin/medya?q=${encodeURIComponent(q)}` : "/admin/medya"}
              aria-current={tur === k ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 ${tur === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/admin/medya" className="flex gap-2">
          {tur && <input type="hidden" name="tur" value={tur} />}
          <label className="sr-only" htmlFor="q">
            Ara
          </label>
          <input id="q" name="q" defaultValue={q} placeholder="Dosya adı ara" className="field w-56" />
          <button type="submit" className="rounded-full border border-gypsum bg-white px-4 text-sm font-semibold text-navy hover:border-navy">
            Ara
          </button>
        </form>
      </div>

      <p className="mb-3 text-sm text-slate">
        <span className="num">{filtered.length}</span> dosya
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">
          {all.length === 0 ? "Kütüphane boş. Yukarıdan dosya yükleyin." : "Bu filtreye uyan dosya yok."}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((m) => {
            const url = mediaUrl(m.path);
            const kind = mediaKind(m.mime, m.path);
            const uses = usage.get(m.path)?.length ?? 0;
            return (
              <li key={m.id}>
                <Link href={`/admin/medya/${m.id}`} className="group block overflow-hidden rounded-xl border border-gypsum bg-white hover:border-navy">
                  <div className="relative aspect-square bg-gypsum">
                    {url && kind === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={m.title ?? ""} className="h-full w-full object-cover" loading="lazy" />
                    )}
                    {url && kind === "video" && <video src={`${url}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" />}
                    {kind === "video" && <span className="absolute left-2 top-2 rounded bg-navy/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">VİDEO</span>}
                    <span
                      className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${uses ? "bg-ok-bg text-ok" : "bg-white/90 text-slate"}`}
                    >
                      {uses ? `${uses} yerde` : "kullanılmıyor"}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-semibold text-ink group-hover:text-navy">{m.title || mediaName(m.path)}</p>
                    <p className="mt-0.5 text-[11px] text-slate">
                      {formatSize(m.size)}
                      {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Sayfalar" className="mt-6 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={qs({ sayfa: String(page - 1) })} className="rounded-full border border-gypsum bg-white px-4 py-2 font-semibold text-navy hover:border-navy">
              ← Önceki
            </Link>
          )}
          <span className="text-slate">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={qs({ sayfa: String(page + 1) })} className="rounded-full border border-gypsum bg-white px-4 py-2 font-semibold text-navy hover:border-navy">
              Sonraki →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
