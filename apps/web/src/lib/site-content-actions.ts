"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type SiteFormState = { ok?: boolean; message: string };

const PORTAL_TYPES = ["doctor_tr", "doctor_foreign", "clinic", "agency"];
const LOCS = ["tr", "en", "fr"] as const;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const i18n = (f: FormData, base: string, max = 600) => {
  const o: Record<string, string> = {};
  for (const l of LOCS) { const v = s(f, `${base}_${l}`).slice(0, max); if (v) o[l] = v; }
  return o;
};
/** datetime-local (İstanbul saati) → ISO */
const when = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+03:00`).toISOString() : null);
const href = (v: string) => (!v ? null : /^(\/|https:\/\/)/.test(v) ? v.slice(0, 500) : null);
const path = (v: string) => (v && /^[\w\-./]{3,300}$/.test(v) && !v.includes("..") ? v : null);
const fail = (m: string): SiteFormState => ({ ok: false, message: m });
const SQL_HINT = "Supabase'de 20270101000000_help_ads.sql çalıştırılmalı.";
const errMsg = (m: string) => (/builtin|locales|cms_help_videos|schema cache|invalid input value for enum/.test(m) ? SQL_HINT : /row-level security|permission/.test(m) ? "Site içeriklerini düzenleme yetkiniz yok." : m);

async function guard() {
  const ses = await getSession();
  if (!ses.siteAccess) throw new Error("Site içeriklerini düzenleme yetkiniz yok.");
  return ses;
}
const back = () => { revalidatePath("/site-icerik"); };
function timeRange(f: FormData): { starts_at: string | null; ends_at: string | null } | string {
  const starts_at = when(s(f, "starts"));
  const ends_at = when(s(f, "ends"));
  if (starts_at && ends_at && ends_at <= starts_at) return "Bitiş, başlangıçtan sonra olmalı.";
  return { starts_at, ends_at };
}

/* ---------------- Reklamlar (cms_slides, ana sayfa) ---------------- */
export async function saveAd(_: SiteFormState | null, f: FormData): Promise<SiteFormState> {
  try { await guard(); } catch (e) { return fail((e as Error).message); }
  const id = s(f, "id");
  const w = timeRange(f);
  if (typeof w === "string") return fail(w);
  const builtin = s(f, "builtin") || null;
  const row: Record<string, unknown> = {
    placement: "home",
    title: i18n(f, "title", 160),
    subtitle: i18n(f, "sub", 300),
    button_label: i18n(f, "label", 60),
    button_href: href(s(f, "href")),
    locales: LOCS.filter((l) => f.getAll("locales").includes(l)),
    sort: Number(s(f, "sort")) || 0,
    is_active: f.get("active") === "on",
    ...w,
  };
  if (!builtin) {
    row.image_path = path(s(f, "image_path"));
    row.image_mobile_path = path(s(f, "image_mobile_path"));
    row.video_path = path(s(f, "video_path"));
    if (!row.image_path && !row.video_path) return fail("Reklam için bir görsel ya da video yükleyin.");
  }
  if (s(f, "href") && !row.button_href) return fail("Bağlantı / ile ya da https:// ile başlamalı.");
  const supabase = await createClient();
  const { error } = id ? await supabase.from("cms_slides").update(row).eq("id", id) : await supabase.from("cms_slides").insert(row);
  if (error) return fail(errMsg(error.message));
  back();
  return { ok: true, message: id ? "Reklam güncellendi. Sitede en geç 1 dakika içinde görünür." : "Reklam eklendi. Sitede en geç 1 dakika içinde görünür." };
}

export async function adAction(f: FormData) {
  await guard();
  const id = s(f, "id");
  const op = s(f, "op");
  const supabase = await createClient();
  if (op === "toggle") {
    const { data } = await supabase.from("cms_slides").select("is_active").eq("id", id).single();
    await supabase.from("cms_slides").update({ is_active: !data?.is_active }).eq("id", id);
  } else if (op === "delete") {
    await supabase.from("cms_slides").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id).is("builtin", null);
  } else if (op === "up" || op === "down") {
    const { data } = await supabase.from("cms_slides").select("id, sort").eq("placement", "home").is("deleted_at", null).order("sort").order("created_at");
    const list = (data ?? []) as { id: string; sort: number }[];
    const k = list.findIndex((x) => x.id === id);
    const j = op === "up" ? k - 1 : k + 1;
    if (k >= 0 && j >= 0 && j < list.length) {
      [list[k], list[j]] = [list[j]!, list[k]!];
      await Promise.all(list.map((x, n) => supabase.from("cms_slides").update({ sort: n * 10 }).eq("id", x.id)));
    }
  }
  back();
}

/* ---------------- Duyurular (cms_announcements; isteğe bağlı personel duyurusu) ---------------- */
export async function saveNotice(_: SiteFormState | null, f: FormData): Promise<SiteFormState> {
  let ses;
  try { ses = await guard(); } catch (e) { return fail((e as Error).message); }
  const id = s(f, "id");
  const kind = s(f, "kind");
  if (!["news", "banner", "popup", "update"].includes(kind)) return fail("Duyuru türünü seçin.");
  const title = i18n(f, "title", 160);
  if (!title.tr) return fail("Türkçe başlık zorunlu.");
  const w = timeRange(f);
  if (typeof w === "string") return fail(w);
  const targets = f.getAll("targets").map(String).filter((t) => PORTAL_TYPES.includes(t));
  const row = {
    kind,
    audience: kind === "update" ? "public" : "portal",
    title,
    body: i18n(f, "body", 2000),
    link_href: href(s(f, "href")),
    image_path: path(s(f, "image_path")),
    target_types: kind === "update" || targets.length === PORTAL_TYPES.length ? [] : targets,
    priority: f.get("pin") === "on" ? 10 : 0,
    is_active: true,
    ...w,
  };
  if (s(f, "href") && !row.link_href) return fail("Bağlantı / ile ya da https:// ile başlamalı.");
  if (kind !== "update" && targets.length === 0) return fail("En az bir hesap türü seçin.");
  const supabase = await createClient();
  const { error } = id ? await supabase.from("cms_announcements").update(row).eq("id", id) : await supabase.from("cms_announcements").insert(row);
  if (error) return fail(errMsg(error.message));
  let staff = "";
  if (!id && f.get("staff") === "on") {
    const { error: e2 } = await supabase.from("announcements").insert({
      company_id: ses.companyId, title: title.tr, body: (row.body as Record<string, string>).tr ?? title.tr, audience: "ALL",
      published_at: w.starts_at ?? new Date().toISOString(), expires_at: w.ends_at, created_by: ses.userId,
    });
    staff = e2 ? ` Personel duyurusu yazılamadı (${e2.message}).` : " Personele de duyuruldu.";
    revalidatePath("/duyurular");
  }
  back();
  return { ok: true, message: `${id ? "Duyuru güncellendi." : "Duyuru yayınlandı."}${staff}` };
}

export async function noticeAction(f: FormData) {
  await guard();
  const id = s(f, "id");
  const op = s(f, "op");
  const supabase = await createClient();
  if (op === "toggle") {
    const { data } = await supabase.from("cms_announcements").select("is_active").eq("id", id).single();
    await supabase.from("cms_announcements").update({ is_active: !data?.is_active }).eq("id", id);
  } else if (op === "delete") {
    await supabase.from("cms_announcements").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
  }
  back();
}

/* ---------------- Yardım videoları ---------------- */
export async function saveVideo(_: SiteFormState | null, f: FormData): Promise<SiteFormState> {
  try { await guard(); } catch (e) { return fail((e as Error).message); }
  const id = s(f, "id");
  const title = i18n(f, "title", 160);
  if (!title.tr) return fail("Türkçe başlık zorunlu.");
  const url = s(f, "video_url");
  const row = {
    title,
    description: i18n(f, "desc", 500),
    target_types: f.getAll("targets").map(String).filter((t) => PORTAL_TYPES.includes(t)),
    video_path: path(s(f, "video_path")),
    video_url: url ? (/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//.test(url) ? url.slice(0, 500) : null) : null,
    poster_path: path(s(f, "poster_path")),
    sort: Number(s(f, "sort")) || 0,
    is_active: f.get("active") === "on",
  };
  if (url && !row.video_url) return fail("Yalnız YouTube ya da Vimeo bağlantısı girilebilir.");
  if (!row.video_path && !row.video_url) return fail("Video dosyası yükleyin ya da YouTube / Vimeo bağlantısı girin.");
  if (row.target_types.length === PORTAL_TYPES.length) row.target_types = [];
  const supabase = await createClient();
  const { error } = id ? await supabase.from("cms_help_videos").update(row).eq("id", id) : await supabase.from("cms_help_videos").insert(row);
  if (error) return fail(errMsg(error.message));
  back();
  return { ok: true, message: id ? "Video güncellendi." : "Video eklendi; Yardım sayfasında görünür." };
}

export async function videoAction(f: FormData) {
  await guard();
  const id = s(f, "id");
  const op = s(f, "op");
  const supabase = await createClient();
  if (op === "toggle") {
    const { data } = await supabase.from("cms_help_videos").select("is_active").eq("id", id).single();
    await supabase.from("cms_help_videos").update({ is_active: !data?.is_active }).eq("id", id);
  } else if (op === "delete") {
    await supabase.from("cms_help_videos").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
  }
  back();
}
