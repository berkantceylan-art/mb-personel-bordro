import Link from "next/link";
import { Flash, PageHead } from "@/components/admin/ui";
import { mediaName, publicMediaUrl } from "@/lib/media";
import { buildMediaPlan, type PlanRow } from "@/lib/media-plan";
import { applyMediaPlan } from "@/lib/media-plan-actions";

export const metadata = { title: "Görselleri yerleştir" };

function Thumbs({ paths, dim }: { paths: string[]; dim?: boolean }) {
  if (!paths.length) return <span className="text-xs text-slate">—</span>;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${dim ? "opacity-60" : ""}`}>
      {paths.slice(0, 8).map((p) =>
        p.startsWith("(") ? (
          <li key={p} className="text-xs text-slate">
            {p}
          </li>
        ) : (
          <li key={p} title={mediaName(p)}>
            {/\.(mp4|webm|mov)$/i.test(p) ? (
              <video src={`${publicMediaUrl(p)}#t=0.5`} muted preload="metadata" className="h-14 w-10 rounded-md bg-gypsum object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicMediaUrl(p)} alt="" loading="lazy" className="h-14 w-14 rounded-md bg-gypsum object-cover" />
            )}
          </li>
        ),
      )}
      {paths.length > 8 && <li className="self-center text-xs text-slate">+{paths.length - 8}</li>}
    </ul>
  );
}

export default async function AutoMediaPage({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const { rows, libraryCount, unmatched } = await buildMediaPlan();
  const groups = ["Ürünler", "Sayfalar", "Departmanlar", "Slaytlar", "Hikâyeler"] as const;
  const pending = rows.filter((r) => !r.filled).length;

  return (
    <>
      <PageHead
        title="Görselleri yerleştir"
        lead="Medya kütüphanesindeki eski site görsellerini dosya adlarına göre ürünlere, sayfalara, departmanlara, slaytlara ve hikâyelere yerleştirir. Boş alanlar işaretli gelir; dolu alanlar korunur (isterseniz işaretleyip galeriye ekleyebilirsiniz)."
      />
      <Flash ok={ok} hata={hata} />
      <p className="mb-5 text-sm text-slate">
        Kütüphanede {libraryCount} dosya var · {rows.length} öneri ({pending} boş alan) ·{" "}
        <Link href="/admin/medya" className="font-semibold text-navy underline">
          Medya kütüphanesi
        </Link>
      </p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">
          Eşleşen görsel bulunamadı. Kütüphanedeki dosya adları eski siteyle aynı olmalı (ör. zirkon1.webp, cnc1.jpg).
        </div>
      ) : (
        <form action={applyMediaPlan} className="grid gap-8">
          {groups.map((g) => {
            const list = rows.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <section key={g}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">{g}</h2>
                <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
                  {list.map((r: PlanRow) => (
                    <li key={r.key}>
                      <label className="grid cursor-pointer gap-3 p-4 hover:bg-porcelain sm:grid-cols-[auto_12rem_1fr_1fr] sm:items-center">
                        <input type="checkbox" name="row" value={r.key} defaultChecked={!r.filled} className="h-5 w-5 accent-navy" />
                        <span>
                          <span className="block font-semibold text-navy">{r.label}</span>
                          <span className="text-xs text-slate">
                            {r.field}
                            {r.filled && " · dolu"}
                          </span>
                        </span>
                        <span>
                          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate">Şu an</span>
                          <Thumbs paths={r.current} dim />
                        </span>
                        <span>
                          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate">{r.field === "Galeri" && r.filled ? "Eklenecek" : "Önerilen"}</span>
                          <Thumbs paths={r.proposed} />
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-gypsum bg-white/95 p-4 shadow-lg backdrop-blur">
            <span className="mr-auto text-sm text-slate">Kapakta seçili görsel alana yazılır; galeride mevcut görsellerin sonuna eklenir.</span>
            <button type="submit" className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
              Seçilenleri uygula
            </button>
          </div>
        </form>
      )}
      {unmatched.length > 0 && (
        <details className="mt-8 rounded-2xl border border-gypsum bg-white p-5">
          <summary className="cursor-pointer font-semibold text-navy">Eşleşmeyen görseller ({unmatched.length})</summary>
          <p className="mt-2 text-sm text-slate">Bunları ilgili içeriğin düzenleme ekranında “Kütüphaneden seç” ile elle ekleyebilirsiniz.</p>
          <div className="mt-3">
            <Thumbs paths={unmatched.slice(0, 60)} />
          </div>
          <p className="mt-2 text-xs text-slate">{unmatched.slice(0, 60).map((p) => mediaName(p)).join(", ")}</p>
        </details>
      )}
    </>
  );
}
