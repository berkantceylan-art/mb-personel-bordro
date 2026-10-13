import Link from "next/link";
import { PORTAL_UI, formatDate, portalContext, portalLocale, type CaseStatus } from "@/lib/portal";
import { PX } from "@/lib/portal-extra-ui";
import { SHIP_UI } from "@/lib/shipments-portal";
import { createClient } from "@/lib/supabase/server";
import { MarkSeen } from "./MarkSeen";
import { t } from "@/lib/i18n";

export const metadata = { title: "Bildirimler" };

type Item = { key: string; at: string; title: string; body: string; href: string };

/** Laboratuvardan gelen her şey: vaka durumu, mesaj, dosya ve paket hareketleri */
export default async function PortalNotifications() {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const ui = PORTAL_UI[locale];
  const px = PX[locale];
  const sh = SHIP_UI[locale];
  const supabase = await createClient();
  const [{ data: cases }, { data: ships }] = await Promise.all([
    supabase.from("portal_cases").select("id, no, patient_ref").eq("account_id", acc.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("shipments").select("id, no, direction, carrier, tracking_no").eq("portal_account_id", acc.id).order("created_at", { ascending: false }).limit(300),
  ]);
  const caseMap = new Map((cases ?? []).map((c) => [c.id as string, c as { id: string; no: number; patient_ref: string }]));
  const shipMap = new Map((ships ?? []).map((s) => [s.id as string, s as { id: string; no: number; direction: string; carrier: string; tracking_no: string | null }]));
  const [{ data: ce }, { data: se }] = await Promise.all([
    caseMap.size ? supabase.from("portal_case_events").select("id, case_id, kind, status, body, created_at").in("case_id", [...caseMap.keys()]).eq("from_lab", true).order("id", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    shipMap.size ? supabase.from("shipment_events").select("id, shipment_id, status, created_at").in("shipment_id", [...shipMap.keys()]).not("status", "is", null).order("id", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
  ]);
  const items: Item[] = [];
  for (const e of (ce ?? []) as { id: number; case_id: string; kind: string; status: CaseStatus | null; body: string | null; created_at: string }[]) {
    const c = caseMap.get(e.case_id);
    if (!c) continue;
    const title = `${px.notifCase} #${c.no} · ${c.patient_ref}`;
    const body = e.kind === "status" && e.status ? ui.statuses[e.status] : e.kind === "message" ? `${px.notifMessage}: ${e.body ?? ""}` : (e.body ?? "");
    items.push({ key: `c${e.id}`, at: e.created_at, title, body, href: `/portal/vaka/${c.id}#gecmis` });
  }
  for (const e of (se ?? []) as { id: number; shipment_id: string; status: string; created_at: string }[]) {
    const s = shipMap.get(e.shipment_id);
    if (!s) continue;
    items.push({ key: `s${e.id}`, at: e.created_at, title: `${px.notifShipment} · ${s.direction === "in" ? sh.incoming : sh.outgoing} · ${sh.carriers[s.carrier] ?? s.carrier}${s.tracking_no ? ` ${s.tracking_no}` : ""}`, body: sh.status[e.status] ?? e.status, href: "/portal/paketler" });
  }
  // Laboratuvar duyuruları (hesap türüne göre hedeflenmiş; RLS süzer)
  // + güncelleme duyuruları (herkese açık "update" türü)
  const now = Date.now();
  const { data: anns } = await supabase.from("cms_announcements").select("id, kind, title, body, link_href, starts_at, ends_at, created_at").or("audience.eq.portal,kind.eq.update").is("deleted_at", null).eq("is_active", true).order("created_at", { ascending: false }).limit(20);
  for (const a of (anns ?? []) as { id: string; kind: string; title: Record<string, string>; body: Record<string, string>; link_href: string | null; starts_at: string | null; ends_at: string | null; created_at: string }[]) {
    const title = t(a.title, locale);
    if (!title || (a.starts_at && Date.parse(a.starts_at) > now) || (a.ends_at && Date.parse(a.ends_at) <= now)) continue;
    const upd = a.kind === "update";
    items.push({ key: `a${a.id}`, at: a.starts_at ?? a.created_at, title: `${upd ? "✨" : "📣"} ${title}`, body: t(a.body, locale), href: a.link_href ?? (upd ? `/${locale}/yardim#yenilikler` : "/portal/bildirimler") });
  }
  // Hesaba özel bildirimler (ör. laboratuvar yöneticisinin hesabı görüntülemesi)
  const { data: own } = await supabase.from("notifications").select("id, title, body, link, created_at").eq("user_id", ctx!.user.id).order("created_at", { ascending: false }).limit(20);
  for (const n of (own ?? []) as { id: string; title: string; body: string | null; link: string | null; created_at: string }[]) {
    items.push({ key: `n${n.id}`, at: n.created_at, title: `🔔 ${n.title}`, body: n.body ?? "", href: n.link ?? "/portal/bildirimler" });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <MarkSeen />
      <h1 className="display text-3xl font-semibold text-navy">{px.notifTitle}</h1>
      {items.length ? (
        <ul className="mt-6 grid gap-2">
          {items.slice(0, 80).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl bg-white px-5 py-4 hover:ring-2 hover:ring-smile">
                <span className="font-semibold text-navy">{i.title}</span>
                <span className="text-sm text-ink">{i.body}</span>
                <span className="ml-auto text-xs text-slate">{formatDate(i.at, locale, true)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-slate">{px.notifEmpty}</p>
      )}
    </>
  );
}
