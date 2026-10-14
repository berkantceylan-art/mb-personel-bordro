import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, I18nField, PageHead } from "@/components/admin/ui";
import type { SiteEvent } from "@/lib/cms";
import { saveEvent } from "@/lib/growth-actions";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Eğitim" };
export default async function EventEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { id } = await params;
  const { hata } = await searchParams;
  const supabase = await createClient();
  let e: SiteEvent | undefined;
  let regs: Array<{ name: string; email: string; phone: string | null; clinic: string | null; city: string | null; created_at: string }> = [];
  if (id !== "yeni") {
    if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
    const [{ data }, { data: r }] = await Promise.all([supabase.from("cms_events").select("*").eq("id", id).maybeSingle(), supabase.from("cms_event_regs").select("*").eq("event_id", id).order("created_at")]);
    if (!data) notFound();
    e = data as SiteEvent;
    regs = (r ?? []) as typeof regs;
  }
  const local = e ? new Date(new Date(e.starts_at).getTime() + 3 * 3600000).toISOString().slice(0, 16) : "";
  return (
    <>
      <PageHead title={e ? t(e.title, "tr") : "Yeni eğitim"} />
      <Flash hata={hata} />
      <form action={saveEvent} className="grid gap-5">
        {e && <input type="hidden" name="id" value={e.id} />}
        <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold text-navy">Tarih ve saat<input type="datetime-local" name="starts_at" required defaultValue={local} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Süre (dk)<input type="number" name="duration_min" defaultValue={e?.duration_min ?? 60} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Biçim<select name="mode" defaultValue={e?.mode ?? "online"} className="field font-normal"><option value="online">Çevrim içi</option><option value="onsite">Yüz yüze</option><option value="hybrid">Hibrit</option></select></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Konuşmacı<input name="speaker" defaultValue={e?.speaker ?? ""} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Yer<input name="location" defaultValue={e?.location ?? ""} placeholder="yüz yüze ise adres" className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Kontenjan<input type="number" name="capacity" defaultValue={e?.capacity ?? ""} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy sm:col-span-2">Katılım bağlantısı (yalnız yönetimde)<input name="join_url" defaultValue={e?.join_url ?? ""} placeholder="Zoom / Meet" className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Görsel<input name="image_path" defaultValue={e?.image_path ?? ""} className="field font-normal" /></label>
          <input type="hidden" name="slug" value={e?.slug ?? ""} />
        </div>
        <I18nField name="title" label="Başlık" value={e?.title} required />
        <I18nField name="summary" label="Kısa açıklama" value={e?.summary} multiline rows={2} />
        <I18nField name="body" label="Program / içerik" value={e?.body} multiline rows={6} />
        <label className="flex items-center gap-3 text-sm font-semibold text-navy"><input type="checkbox" name="is_active" defaultChecked={e?.is_active ?? true} className="h-5 w-5 accent-navy" /> Sitede yayında</label>
        <div className="flex gap-3"><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white">Kaydet</button><Link href="/admin/egitimler" className="px-3 py-3 font-semibold text-slate">Vazgeç</Link></div>
      </form>
      {e && (
        <section className="mt-8 rounded-2xl border border-gypsum bg-white p-5">
          <h2 className="display text-lg font-semibold text-navy">Kayıtlar ({regs.length}{e.capacity ? ` / ${e.capacity}` : ""})</h2>
          <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-slate"><th>Ad</th><th>E-posta</th><th>Telefon</th><th>Klinik / şehir</th></tr></thead>
            <tbody>{regs.map((r) => <tr key={r.email} className="border-t border-porcelain"><td className="py-1.5">{r.name}</td><td><a href={`mailto:${r.email}`} className="text-navy">{r.email}</a></td><td>{r.phone ?? "—"}</td><td>{[r.clinic, r.city].filter(Boolean).join(" · ") || "—"}</td></tr>)}</tbody></table>
          {regs.length > 0 && <a href={`mailto:?bcc=${regs.map((r) => r.email).join(",")}&subject=${encodeURIComponent(t(e.title, "tr"))}`} className="mt-3 inline-block text-sm font-semibold text-navy">✉️ Tüm kayıtlılara e-posta yaz</a>}
        </section>
      )}
    </>
  );
}
