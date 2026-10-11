import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, Tabs, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { adAction, noticeAction, videoAction } from "@/lib/site-content-actions";
import { AdForm, NoticeForm, TYPES, Thumb, VideoForm, mediaUrl, type AdRow, type NoticeRow, type VideoRow } from "./SiteForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site içerikleri" };

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://mbdentaire.com";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
type Live = { is_active: boolean; starts_at?: string | null; ends_at?: string | null };
function state(r: Live): [string, "green" | "amber" | "gray" | "blue"] {
  const now = Date.now();
  if (!r.is_active) return ["Durduruldu", "gray"];
  if (r.starts_at && Date.parse(r.starts_at) > now) return ["Planlandı", "blue"];
  if (r.ends_at && Date.parse(r.ends_at) <= now) return ["Süresi bitti", "amber"];
  return ["Yayında", "green"];
}
const range = (r: Live) => {
  const a = fmt(r.starts_at ?? null), b = fmt(r.ends_at ?? null);
  return a || b ? `${a ?? "hemen"} → ${b ?? "süresiz"}` : "Süresiz";
};
const KIND: Record<string, string> = { news: "Bildirim", banner: "Portal üst şeridi", popup: "Açılır pencere", update: "Güncelleme duyurusu" };
const BUILTIN: Record<string, string> = { "portal-promo": "Hazır reklam · Vakanızı 2 dakikada gönderin", "portal-tracking": "Hazır reklam · İşiniz nerede? Canlı takip" };
const typeNames = (t: string[]) => (!t?.length ? "Tüm hesap türleri" : t.map((k) => TYPES.find(([v]) => v === k)?.[1] ?? k).join(", "));

/** Web sitesi reklamları, hekim / kullanıcı duyuruları ve Yardım sayfası videoları */
export default async function SiteContentPage({ searchParams }: { searchParams: Promise<{ sekme?: string; duzenle?: string }> }) {
  const s = await getSession();
  if (!s.siteAccess) redirect("/");
  const sp = await searchParams;
  const tab = ["reklam", "duyuru", "video"].includes(sp.sekme ?? "") ? sp.sekme! : "reklam";
  const supabase = await createClient();
  const [ads, notices, videos] = await Promise.all([
    supabase.from("cms_slides").select("id, builtin, title, subtitle, button_label, button_href, image_path, image_mobile_path, video_path, locales, sort, is_active, starts_at, ends_at").eq("placement", "home").is("deleted_at", null).order("sort").order("created_at"),
    supabase.from("cms_announcements").select("id, kind, audience, title, body, link_href, image_path, target_types, priority, is_active, starts_at, ends_at, created_at").or("audience.eq.portal,kind.eq.update").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
    supabase.from("cms_help_videos").select("id, title, description, target_types, video_path, video_url, poster_path, sort, is_active").is("deleted_at", null).order("sort").order("created_at"),
  ]);
  const needSql = !!(ads.error || videos.error);
  const adRows = (ads.data ?? []) as (AdRow & Live)[];
  const noticeRows = (notices.data ?? []) as (NoticeRow & Live & { audience: string; created_at: string })[];
  const videoRows = (videos.data ?? []) as (VideoRow & Live)[];
  const editAd = tab === "reklam" ? adRows.find((r) => r.id === sp.duzenle) : undefined;
  const editNotice = tab === "duyuru" ? noticeRows.find((r) => r.id === sp.duzenle) : undefined;
  const editVideo = tab === "video" ? videoRows.find((r) => r.id === sp.duzenle) : undefined;
  const liveAds = adRows.filter((r) => state(r)[0] === "Yayında").length;

  const Btn = ({ action, id, op, children, danger }: { action: (f: FormData) => Promise<void>; id: string; op: string; children: React.ReactNode; danger?: boolean }) => (
    <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} />
      <button className={`text-sm font-semibold ${danger ? "text-bad" : "text-brand-700"} hover:underline`}>{children}</button></form>
  );

  return (
    <>
      <PageHeader title="Site içerikleri" subtitle="Ana sayfa reklamları, hekim ve kullanıcı duyuruları, Yardım sayfası videoları" />
      <div className={`${page} max-w-[1100px]`}>
        {needSql && <Notice tone="bad">Supabase&apos;de 20270101000000_help_ads.sql çalıştırılmalı (reklam tarihleri, hazır reklamlar ve videolar için).</Notice>}
        <Tabs active={`/site-icerik?sekme=${tab}`} items={[
          ["/site-icerik?sekme=reklam", "Reklamlar", liveAds],
          ["/site-icerik?sekme=duyuru", "Hekim duyuruları", noticeRows.filter((r) => state(r)[0] === "Yayında").length],
          ["/site-icerik?sekme=video", "Yardım videoları", videoRows.length],
        ]} />

        {tab === "reklam" && (
          <>
            <Notice tone="info">Reklamlar sitenin ana sayfasında otomatik döner (7 saniyede bir). Başlangıç ve bitiş tarihi verirseniz kendiliğinden yayına girer ve kalkar. Kutunun boyu sabittir; görsel ne olursa olsun ana sayfa düzeni bozulmaz. <a href={`${SITE}/tr`} target="_blank" rel="noreferrer" className="font-semibold underline">Ana sayfayı aç ↗</a></Notice>
            <section className="bg-white border border-line rounded-[14px] p-4 md:p-5">
              <h2 className="font-display font-semibold text-brand-800 mb-4">{editAd ? "Reklamı düzenle" : "Yeni reklam"}</h2>
              <AdForm key={editAd?.id ?? "yeni"} row={editAd} />
            </section>
            <ul className="flex flex-col gap-2">
              {adRows.map((r, k) => {
                const [st, tone] = state(r);
                const img = mediaUrl(r.image_path);
                return (
                  <li key={r.id} className="bg-white border border-line rounded-[14px] p-3 flex flex-wrap items-center gap-3">
                    {r.builtin ? <span className="grid h-14 w-24 place-items-center rounded-lg bg-brand-800 text-[10px] font-semibold text-white text-center px-1">MB Dental hazır</span>
                      : img ? <Thumb src={img} className="h-14 w-24 rounded-lg object-cover" />
                      : <span className="grid h-14 w-24 place-items-center rounded-lg bg-black text-xs text-white">video</span>}
                    <div className="flex-1 min-w-[220px]">
                      <b className="block">{r.title?.tr || (r.builtin ? BUILTIN[r.builtin] : "(başlıksız)")}</b>
                      <span className="text-xs text-muted">{range(r)}{r.locales?.length ? ` · ${r.locales.join(", ").toUpperCase()}` : ""}{r.button_href ? ` · ${r.button_href}` : ""}</span>
                    </div>
                    <Chip tone={tone}>{st}</Chip>
                    <div className="flex items-center gap-3">
                      {k > 0 && <Btn action={adAction} id={r.id} op="up">↑</Btn>}
                      {k < adRows.length - 1 && <Btn action={adAction} id={r.id} op="down">↓</Btn>}
                      <a href={`/site-icerik?sekme=reklam&duzenle=${r.id}`} className="text-sm font-semibold text-brand-700 hover:underline">Düzenle</a>
                      <Btn action={adAction} id={r.id} op="toggle">{r.is_active ? "Durdur" : "Yayınla"}</Btn>
                      {!r.builtin && <Btn action={adAction} id={r.id} op="delete" danger>Sil</Btn>}
                    </div>
                  </li>
                );
              })}
              {adRows.length === 0 && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz reklam yok.</li>}
            </ul>
          </>
        )}

        {tab === "duyuru" && (
          <>
            <Notice tone="info">Buradan yazdığınız duyurular hekim portalında (yerli ve yabancı hekimler, klinikler, aracı kuruluşlar) görünür. &ldquo;Güncelleme duyurusu&rdquo; ayrıca sitedeki Yardım › Yenilikler bölümüne düşer. İsterseniz aynı duyuruyu personele de gönderebilirsiniz.</Notice>
            <section className="bg-white border border-line rounded-[14px] p-4 md:p-5">
              <h2 className="font-display font-semibold text-brand-800 mb-4">{editNotice ? "Duyuruyu düzenle" : "Yeni duyuru"}</h2>
              <NoticeForm key={editNotice?.id ?? "yeni"} row={editNotice} />
            </section>
            <ul className="flex flex-col gap-2">
              {noticeRows.map((r) => {
                const [st, tone] = state(r);
                return (
                  <li key={r.id} className="bg-white border border-line rounded-[14px] p-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[240px]">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{KIND[r.kind] ?? r.kind} · {r.kind === "update" ? "Herkes" : typeNames(r.target_types)}</span>
                      <b className="block">{r.title?.tr}</b>
                      <span className="text-xs text-muted">{range(r)}</span>
                    </div>
                    <Chip tone={tone}>{st}</Chip>
                    <div className="flex items-center gap-3">
                      <a href={`/site-icerik?sekme=duyuru&duzenle=${r.id}`} className="text-sm font-semibold text-brand-700 hover:underline">Düzenle</a>
                      <Btn action={noticeAction} id={r.id} op="toggle">{r.is_active ? "Durdur" : "Yayınla"}</Btn>
                      <Btn action={noticeAction} id={r.id} op="delete" danger>Sil</Btn>
                    </div>
                  </li>
                );
              })}
              {noticeRows.length === 0 && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz duyuru yok.</li>}
            </ul>
          </>
        )}

        {tab === "video" && (
          <>
            <Notice tone="info">Videolar sitedeki <a href={`${SITE}/tr/yardim`} target="_blank" rel="noreferrer" className="font-semibold underline">Yardım merkezi ↗</a> sayfasında, seçtiğiniz hesap türünün sekmesinde görünür. Sayfada ayrıca her hesap türü için hazır, adım adım animasyonlu anlatım bulunur. Ekran kaydını telefon ya da bilgisayarla alıp buradan yükleyebilir veya YouTube bağlantısı verebilirsiniz.</Notice>
            <section className="bg-white border border-line rounded-[14px] p-4 md:p-5">
              <h2 className="font-display font-semibold text-brand-800 mb-4">{editVideo ? "Videoyu düzenle" : "Yeni video"}</h2>
              <VideoForm key={editVideo?.id ?? "yeni"} row={editVideo} />
            </section>
            <ul className="flex flex-col gap-2">
              {videoRows.map((r) => {
                const [st, tone] = state(r);
                return (
                  <li key={r.id} className="bg-white border border-line rounded-[14px] p-3 flex flex-wrap items-center gap-3">
                    <span className="grid h-14 w-24 place-items-center rounded-lg bg-black text-xl text-white">▶</span>
                    <div className="flex-1 min-w-[220px]">
                      <b className="block">{r.title?.tr}</b>
                      <span className="text-xs text-muted">{typeNames(r.target_types)} · {r.video_url ? "YouTube / Vimeo" : "Yüklenen dosya"}</span>
                    </div>
                    <Chip tone={tone}>{st}</Chip>
                    <div className="flex items-center gap-3">
                      <a href={`/site-icerik?sekme=video&duzenle=${r.id}`} className="text-sm font-semibold text-brand-700 hover:underline">Düzenle</a>
                      <Btn action={videoAction} id={r.id} op="toggle">{r.is_active ? "Durdur" : "Yayınla"}</Btn>
                      <Btn action={videoAction} id={r.id} op="delete" danger>Sil</Btn>
                    </div>
                  </li>
                );
              })}
              {videoRows.length === 0 && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz video yok.</li>}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
