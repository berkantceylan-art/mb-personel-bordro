"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, textareaCls } from "@/components/erp";
import { saveAd, saveNotice, saveVideo, type SiteFormState } from "@/lib/site-content-actions";
import { PORTAL_TYPE_LABELS, siteMediaUrl } from "@/lib/site-content";

const TYPES = PORTAL_TYPE_LABELS;
const LANGS: [string, string][] = [["tr", "Türkçe"], ["en", "English"], ["fr", "Français"]];
const mediaUrl = siteMediaUrl;

type I18n = Record<string, string>;
export type AdRow = { id: string; builtin: string | null; title: I18n; subtitle: I18n; button_label: I18n; button_href: string | null; image_path: string | null; image_mobile_path: string | null; video_path: string | null; locales: string[]; sort: number; is_active: boolean; starts_at: string | null; ends_at: string | null };
export type NoticeRow = { id: string; kind: string; title: I18n; body: I18n; link_href: string | null; image_path: string | null; target_types: string[]; priority: number; starts_at: string | null; ends_at: string | null };
export type VideoRow = { id: string; title: I18n; description: I18n; target_types: string[]; video_path: string | null; video_url: string | null; poster_path: string | null; sort: number; is_active: boolean };

export function Thumb({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />;
}

/** ISO → datetime-local (İstanbul) */
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 16) : "");

/** Görsel / video yükleme: dosya tarayıcıdan doğrudan site-media deposuna gider, form yalnız yolu gönderir */
function MediaPick({ name, label, hint, accept, folder, initial, onChange }: { name: string; label: string; hint?: string; accept: string; folder: string; initial?: string | null; onChange?: (p: string) => void }) {
  const [path, setPath] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const url = mediaUrl(path);
  const isVideo = /\.(mp4|webm|mov)$/i.test(path);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr("");
    const max = file.type.startsWith("video/") ? 50 : 10;
    if (file.size > max * 1024 * 1024) { setErr(`Dosya en çok ${max} MB olabilir.`); return; }
    setBusy(true);
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+/g, "-").slice(-60);
    const p = `${folder}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
    const { error } = await createClient().storage.from("site-media").upload(p, file, { contentType: file.type || undefined, upsert: false });
    setBusy(false);
    if (error) { setErr(/row-level|policy|permission/i.test(error.message) ? "Yükleme yetkiniz yok (site editörü olmalısınız)." : error.message); return; }
    setPath(p);
    onChange?.(p);
  };
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{label}{hint && <span className="ml-1 font-normal text-muted">· {hint}</span>}</span>
      <input type="hidden" name={name} value={path} />
      <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-[#C5D0DB] bg-white p-2">
        {url ? (
          isVideo ? <video src={url} className="h-16 w-28 rounded object-cover bg-black" muted /> : <Thumb src={url} className="h-16 w-28 rounded object-cover" />
        ) : <span className="grid h-16 w-28 place-items-center rounded bg-[#F2F5F8] text-xs text-muted">yok</span>}
        <label className={`${btnSecondary} cursor-pointer h-9 text-xs`}>
          {busy ? "Yükleniyor…" : url ? "Değiştir" : "Dosya seç"}
          <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {url && <button type="button" className="text-xs font-semibold text-bad" onClick={() => { setPath(""); onChange?.(""); }}>Kaldır</button>}
      </div>
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}

function LangFields({ base, label, row, max, area, required }: { base: string; label: string; row?: I18n; max: number; area?: boolean; required?: boolean }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {LANGS.map(([l, n]) => (
        <Field key={l} label={`${label} · ${n}`} hint={l === "tr" ? (required ? "zorunlu" : undefined) : "boşsa Türkçe görünür"}>
          {area ? <textarea name={`${base}_${l}`} defaultValue={row?.[l] ?? ""} maxLength={max} rows={3} className={textareaCls} required={required && l === "tr"} />
            : <input name={`${base}_${l}`} defaultValue={row?.[l] ?? ""} maxLength={max} className={inputCls} required={required && l === "tr"} />}
        </Field>
      ))}
    </div>
  );
}

function Schedule({ starts, ends }: { starts: string | null; ends: string | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Yayın başlangıcı" hint="boşsa hemen"><input type="datetime-local" name="starts" defaultValue={local(starts)} className={inputCls} /></Field>
      <Field label="Yayından kalkış" hint="boşsa süresiz"><input type="datetime-local" name="ends" defaultValue={local(ends)} className={inputCls} /></Field>
    </div>
  );
}

function Result({ state }: { state: SiteFormState | null }) {
  return state ? <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice> : null;
}

function useDone(tab: string) {
  const router = useRouter();
  return () => router.replace(`/site-icerik?sekme=${tab}`);
}

export function AdForm({ row }: { row?: AdRow }) {
  const done = useDone("reklam");
  const { state, pending, formProps } = useActionForm(saveAd, { onSuccess: done });
  const builtin = row?.builtin;
  return (
    <form {...formProps} className="flex flex-col gap-4">
      {row && <input type="hidden" name="id" value={row.id} />}
      {builtin && <input type="hidden" name="builtin" value={builtin} />}
      {builtin ? (
        <Notice tone="info">Bu hazır bir portal reklamıdır; tasarımı sitede kodla çizilir, görsel gerekmez. Metinleri boş bırakırsanız varsayılan metin (3 dilde) kullanılır. Tarih, sıra ve yayın durumunu değiştirebilirsiniz.</Notice>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <MediaPick name="image_path" label="Görsel (masaüstü)" hint="2100×800 önerilir" accept="image/*" folder="reklamlar" initial={row?.image_path} />
          <MediaPick name="image_mobile_path" label="Mobil görsel" hint="1080×1350, isteğe bağlı" accept="image/*" folder="reklamlar" initial={row?.image_mobile_path} />
          <MediaPick name="video_path" label="Video" hint="mp4, isteğe bağlı, 50 MB" accept="video/mp4,video/webm" folder="reklamlar" initial={row?.video_path} />
        </div>
      )}
      <LangFields base="title" label="Başlık" row={row?.title} max={160} />
      <LangFields base="sub" label="Alt metin" row={row?.subtitle} max={300} area />
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <Field label="Buton yazısı (TR)" hint="ör. Hemen başla"><input name="label_tr" defaultValue={row?.button_label?.tr ?? ""} maxLength={60} className={inputCls} /></Field>
        <Field label="Tıklayınca gidilecek adres" hint="/tr/urunler ya da https://…"><input name="href" defaultValue={row?.button_href ?? ""} maxLength={500} className={inputCls} /></Field>
      </div>
      <input type="hidden" name="label_en" value={row?.button_label?.en ?? ""} />
      <input type="hidden" name="label_fr" value={row?.button_label?.fr ?? ""} />
      <Schedule starts={row?.starts_at ?? null} ends={row?.ends_at ?? null} />
      <div className="flex flex-wrap items-end gap-5">
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="font-semibold text-ink mb-1.5">Hangi dillerde gösterilsin?</legend>
          <div className="flex gap-3">{LANGS.map(([l, n]) => <label key={l} className="flex items-center gap-1.5"><input type="checkbox" name="locales" value={l} defaultChecked={!row || !row.locales?.length || row.locales.includes(l)} className="w-4 h-4" />{n}</label>)}</div>
        </fieldset>
        <Field label="Sıra" className="w-24"><input type="number" name="sort" defaultValue={row?.sort ?? 0} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={row?.is_active ?? true} className="w-5 h-5" />Yayında</label>
      </div>
      <Result state={state} />
      <div className="flex gap-2">
        <button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : row ? "Reklamı güncelle" : "Reklamı ekle"}</button>
        {row && <button type="button" onClick={done} className={btnSecondary}>Vazgeç</button>}
      </div>
    </form>
  );
}

const KIND_HELP: Record<string, string> = {
  news: "Portalda Bildirimler listesine düşer (zil simgesinde sayı çıkar).",
  banner: "Portalın en üstünde renkli şerit olarak görünür.",
  popup: "Hekim portala girince bir kez açılan pencere.",
  update: "Güncelleme duyurusu: sitedeki Yardım › Yenilikler'de, portalda 14 gün üst şerit ve bildirim olarak görünür. Herkes görür.",
};

export function NoticeForm({ row }: { row?: NoticeRow }) {
  const done = useDone("duyuru");
  const { state, pending, formProps } = useActionForm(saveNotice, { onSuccess: done });
  const [kind, setKind] = useState(row?.kind ?? "news");
  const all = !row || !row.target_types?.length;
  return (
    <form {...formProps} className="flex flex-col gap-4">
      {row && <input type="hidden" name="id" value={row.id} />}
      <fieldset className="grid gap-2 md:grid-cols-4">
        <legend className="text-sm font-semibold text-ink mb-1.5">Nerede görünsün?</legend>
        {([["news", "Bildirim"], ["banner", "Portal üst şeridi"], ["popup", "Açılır pencere"], ["update", "Güncelleme duyurusu"]] as [string, string][]).map(([k, l]) => (
          <label key={k} className={`rounded-[12px] border p-3 text-sm cursor-pointer ${kind === k ? "border-brand-700 bg-[#EAF2FB]" : "border-line bg-white"}`}>
            <span className="flex items-center gap-2 font-semibold"><input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />{l}</span>
            <span className="mt-1 block text-xs text-muted">{KIND_HELP[k]}</span>
          </label>
        ))}
      </fieldset>
      {kind !== "update" && (
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="font-semibold text-ink mb-1.5">Kimler görsün?</legend>
          <div className="flex flex-wrap gap-4">{TYPES.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="targets" value={k} defaultChecked={all || row?.target_types.includes(k)} className="w-4 h-4" />{l}</label>)}</div>
          <span className="text-xs text-muted">Yalnız onaylı portal hesapları görür. Hepsini seçmek = tüm hekim ve kullanıcılar.</span>
        </fieldset>
      )}
      <LangFields base="title" label="Başlık" row={row?.title} max={160} required />
      <LangFields base="body" label="Metin" row={row?.body} max={2000} area />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Bağlantı" hint="isteğe bağlı: /tr/yardim ya da https://…"><input name="href" defaultValue={row?.link_href ?? ""} maxLength={500} className={inputCls} /></Field>
        {kind === "popup" && <MediaPick name="image_path" label="Görsel" hint="isteğe bağlı" accept="image/*" folder="duyurular" initial={row?.image_path} />}
      </div>
      <Schedule starts={row?.starts_at ?? null} ends={row?.ends_at ?? null} />
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="pin" defaultChecked={(row?.priority ?? 0) > 0} className="w-4 h-4" />Öncelikli (aynı anda birden çok şerit / pencere varsa bu gösterilir)</label>
        {!row && <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="staff" className="w-4 h-4" />Personele de duyur (ERP › Duyurular)</label>}
      </div>
      <Result state={state} />
      <div className="flex gap-2">
        <button disabled={pending} className={btnPrimary}>{pending ? "Yayınlanıyor…" : row ? "Duyuruyu güncelle" : "Duyuruyu yayınla"}</button>
        {row && <button type="button" onClick={done} className={btnSecondary}>Vazgeç</button>}
      </div>
    </form>
  );
}

export function VideoForm({ row }: { row?: VideoRow }) {
  const done = useDone("video");
  const { state, pending, formProps } = useActionForm(saveVideo, { onSuccess: done });
  const all = !row || !row.target_types?.length;
  return (
    <form {...formProps} className="flex flex-col gap-4">
      {row && <input type="hidden" name="id" value={row.id} />}
      <LangFields base="title" label="Başlık" row={row?.title} max={160} required />
      <LangFields base="desc" label="Kısa açıklama" row={row?.description} max={500} area />
      <div className="grid gap-3 md:grid-cols-3">
        <MediaPick name="video_path" label="Video dosyası" hint="mp4, en çok 50 MB" accept="video/mp4,video/webm" folder="yardim" initial={row?.video_path} />
        <Field label="ya da YouTube / Vimeo bağlantısı" hint="büyük videolar için"><input name="video_url" defaultValue={row?.video_url ?? ""} placeholder="https://youtu.be/…" className={inputCls} /></Field>
        <MediaPick name="poster_path" label="Kapak görseli" hint="isteğe bağlı" accept="image/*" folder="yardim" initial={row?.poster_path} />
      </div>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="font-semibold text-ink mb-1.5">Hangi hesap türünün sekmesinde görünsün?</legend>
        <div className="flex flex-wrap gap-4">{TYPES.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="targets" value={k} defaultChecked={all || row?.target_types.includes(k)} className="w-4 h-4" />{l}</label>)}</div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-5">
        <Field label="Sıra" className="w-24"><input type="number" name="sort" defaultValue={row?.sort ?? 0} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={row?.is_active ?? true} className="w-5 h-5" />Yayında</label>
      </div>
      <Result state={state} />
      <div className="flex gap-2">
        <button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : row ? "Videoyu güncelle" : "Videoyu ekle"}</button>
        {row && <button type="button" onClick={done} className={btnSecondary}>Vazgeç</button>}
      </div>
    </form>
  );
}

