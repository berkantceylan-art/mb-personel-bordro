import { SimpleRows } from "@/components/admin/SimpleRows";
import { Flash, PageHead } from "@/components/admin/ui";
import type { SiteEvent } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Eğitimler" };
export default async function EventsAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: regs }] = await Promise.all([supabase.from("cms_events").select("*").is("deleted_at", null).order("starts_at", { ascending: false }), supabase.from("cms_event_regs").select("event_id")]);
  const cnt = new Map<string, number>();
  for (const r of (regs ?? []) as Array<{ event_id: string }>) cnt.set(r.event_id, (cnt.get(r.event_id) ?? 0) + 1);
  const rows = ((data ?? []) as SiteEvent[]).map((e) => ({ id: e.id, title: t(e.title, "tr"), sub: `${new Date(e.starts_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" })} · ${cnt.get(e.id) ?? 0}${e.capacity ? `/${e.capacity}` : ""} kayıt`, href: `/admin/egitimler/${e.id}`, view: `/tr/egitim/${e.slug}`, draft: !e.is_active }));
  return (<><PageHead title="Hekim eğitimleri ve webinarlar" lead="Sitede /egitim. Kayıt formu açılır; her kayıtta bildirim gelir." action={{ href: "/admin/egitimler/yeni", label: "Yeni eğitim" }} /><Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270204000000_site_pages_plus.sql çalıştırılmalı." : undefined)} /><SimpleRows table="cms_events" rows={rows} empty="Henüz eğitim yok." /></>);
}
