import Link from "next/link";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Değişiklik geçmişi" };

const TABLES: Record<string, { label: string; href: string }> = {
  cms_slides: { label: "Slayt", href: "/admin/slaytlar" },
  cms_announcements: { label: "Duyuru", href: "/admin/duyurular" },
  cms_products: { label: "Ürün", href: "/admin/urunler" },
  cms_stories: { label: "Hikâye", href: "/admin/hikayeler" },
  cms_pages: { label: "Sayfa", href: "/admin/sayfalar" },
  cms_cases: { label: "Vaka", href: "/admin/vakalar" },
  site_settings: { label: "Site ayarları", href: "/admin/ayarlar" },
};
const ACTION: Record<string, { label: string; cls: string }> = {
  INSERT: { label: "eklendi", cls: "bg-ok-bg text-ok" },
  UPDATE: { label: "değişti", cls: "bg-porcelain text-navy" },
  DELETE: { label: "silindi", cls: "bg-bad-bg text-bad" },
};
const FIELD: Record<string, string> = {
  title: "başlık", subtitle: "alt başlık", body: "metin", name: "ad", summary: "kısa açıklama", is_active: "yayın durumu", deleted_at: "çöp kutusu",
  image_path: "görsel", image_mobile_path: "mobil görsel", video_path: "video", gallery: "galeri", sort: "sıra", starts_at: "başlangıç", ends_at: "bitiş",
  button_label: "buton yazısı", button_href: "buton bağlantısı", link_href: "bağlantı", link_label: "bağlantı yazısı", priority: "öncelik", kind: "tür",
  audience: "hedef kitle", slug: "adres", category: "grup", group: "grup", highlights: "öne çıkanlar", seo_title: "SEO başlığı", seo_description: "SEO açıklaması",
  frames: "kareler", cover_path: "kapak", data: "ayarlar", before_path: "öncesi görseli", after_path: "sonrası görseli", featured: "öne çıkarma", teeth: "dişler",
  product_slug: "ürün", description: "açıklama", show_in_footer: "alt bilgi", placement: "yer",
};

type Row = { id: number; table_name: string; row_id: string | null; action: string; at: string; actor_email: string | null; label: string; changed: string[] | null };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ once?: string; tablo?: string }> }) {
  const { once, tablo } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cms_audit", {
    p_limit: 100,
    p_before: once && /^\d+$/.test(once) ? Number(once) : null,
    p_table: tablo && tablo in TABLES ? tablo : null,
  });
  const rows = (data ?? []) as Row[];
  const last = rows.at(-1);

  return (
    <>
      <PageHead title="Değişiklik geçmişi" lead="Site içeriğinde kim, ne zaman, neyi değiştirdi." />
      <Flash hata={error ? "Geçmiş henüz okunamıyor (SQL dosyası çalıştırılmalı)." : undefined} />
      <nav aria-label="Tür" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/gecmis" aria-current={!tablo ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 ${!tablo ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}>
          Tümü
        </Link>
        {Object.entries(TABLES).map(([k, v]) => (
          <Link
            key={k}
            href={`/admin/gecmis?tablo=${k}`}
            aria-current={tablo === k ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 ${tablo === k ? "bg-navy text-white" : "bg-white text-slate hover:text-navy"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Kayıt yok.</div>
      ) : (
        <ol className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((r) => {
            const tbl = TABLES[r.table_name];
            const act = ACTION[r.action] ?? ACTION.UPDATE;
            const link = r.table_name === "site_settings" ? tbl.href : r.action !== "DELETE" && r.row_id ? `${tbl.href}/${r.row_id}` : null;
            const changed = (r.changed ?? []).map((f) => FIELD[f] ?? f);
            const trashed = r.action === "UPDATE" && (r.changed ?? []).includes("deleted_at");
            return (
              <li key={r.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-baseline sm:gap-4">
                <span className="text-xs text-slate">{formatTr(r.at)}</span>
                <span className="min-w-0 text-sm">
                  <span className="mr-2 font-semibold text-slate">{tbl?.label ?? r.table_name}</span>
                  {link ? (
                    <Link href={link} className="font-semibold text-navy hover:underline">
                      {r.label || (r.table_name === "site_settings" ? "Site ayarları" : "(başlıksız)")}
                    </Link>
                  ) : (
                    <span className="font-semibold">{r.label || "(başlıksız)"}</span>
                  )}{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${act.cls}`}>{trashed ? "çöp kutusu" : act.label}</span>
                  {changed.length > 0 && !trashed && <span className="ml-2 text-xs text-slate">{changed.slice(0, 6).join(", ")}</span>}
                </span>
                <span className="truncate text-xs text-slate">{r.actor_email ?? "—"}</span>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length === 100 && last && (
        <div className="mt-4 text-center">
          <Link href={`/admin/gecmis?once=${last.id}${tablo ? `&tablo=${tablo}` : ""}`} className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
            Daha eski kayıtlar
          </Link>
        </div>
      )}
    </>
  );
}
