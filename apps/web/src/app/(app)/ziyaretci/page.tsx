import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { VIS_STATUS, visNo } from "@/lib/visitor";
import { InviteForm } from "./InviteForm";
import { DecideForm } from "./DecideForm";
import { visHostSave } from "@/lib/visitor-actions";
import { PendingSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ziyaretçilerim" };
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/** Personel: misafirlerimi önceden kaydet, geldiğinde bildirim al */
export default async function MyVisitorsPage() {
  const s = await getSession();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const supabase = await createClient();
  const admin = s.role === "owner" || s.role === "hr";
  const [{ data, error }, { data: guard }, { data: reqData }, { data: hostData }, { data: members }] = await Promise.all([
    supabase.from("vis_visits").select("id, year, no, visitor_name, visitor_company, status, expected_at, checked_in_at, checked_out_at, badge_no, token").or(`host_user.eq.${s.userId},created_by.eq.${s.userId}`).order("created_at", { ascending: false }).limit(60),
    supabase.rpc("vis_is_guard"),
    supabase.from("vis_visits").select("id, year, no, visitor_name, visitor_company, phone, visitor_email, purpose, expected_at, visitor_count, host_target, requested_at").eq("status", "requested").order("expected_at").limit(100),
    supabase.from("vis_hosts").select("id, label, description, approver_ids, weekdays, hour_from, hour_to, slot_minutes, is_active, sort").order("sort").order("label"),
    admin ? supabase.from("memberships").select("user_id, display_name").eq("company_id", s.companyId).order("display_name") : Promise.resolve({ data: [] }),
  ]);
  const requests = (reqData ?? []) as { id: string; year: number; no: number; visitor_name: string; visitor_company: string | null; phone: string | null; visitor_email: string | null; purpose: string | null; expected_at: string | null; visitor_count: number; host_target: string | null }[];
  const hosts = (hostData ?? []) as { id: string; label: string; description: string | null; approver_ids: string[]; weekdays: number[]; hour_from: number; hour_to: number; slot_minutes: number; is_active: boolean; sort: number }[];
  const people = ((members ?? []) as { user_id: string; display_name: string | null }[]).filter((m) => m.display_name);
  const hostLabel = new Map(hosts.map((h) => [h.id, h.label]));
  const localInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16) : "");
  const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const rows = (data ?? []) as { id: string; year: number; no: number; visitor_name: string; visitor_company: string | null; status: string; expected_at: string | null; checked_in_at: string | null; checked_out_at: string | null; badge_no: string | null; token: string }[];
  return (
    <>
      <PageHeader title="Ziyaretçilerim" subtitle="Misafirinizi önceden kaydedin; QR davetiyeyle girer, geldiğinde size bildirim gelir"
        actions={guard ? <Link href="/guvenlik" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">🛡 Güvenlik paneli</Link> : undefined} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[900px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270110000000_visitors.sql çalıştırılmalı.</Notice>}
        {requests.length > 0 && (
          <section className="bg-white border border-warn/40 rounded-[16px] p-4 md:p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">📅 Randevu talepleri ({requests.length})</h2>
            <p className="text-xs text-muted">Siteden gelen talepler. Onaylayınca ziyaretçinin QR davetiyesi açılır, güvenlik listesine düşer.</p>
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-[12px] border border-line p-3 flex flex-wrap items-center gap-3">
                  <span className="flex-1 min-w-[220px]">
                    <b>{r.visitor_name}</b>{r.visitor_company ? ` · ${r.visitor_company}` : ""}{r.visitor_count > 1 ? ` · ${r.visitor_count} kişi` : ""}
                    <span className="block text-xs text-muted">{[visNo(r), r.host_target ? hostLabel.get(r.host_target) : null, r.expected_at ? `istenen ${dt(r.expected_at)}` : null, r.phone, r.visitor_email].filter(Boolean).join(" · ")}</span>
                    {r.purpose && <span className="block text-sm">Amaç: {r.purpose}</span>}
                  </span>
                  <DecideForm id={r.id} at={localInput(r.expected_at)} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5"><h2 className="font-display text-lg font-bold mb-3">Yeni misafir</h2><InviteForm origin={origin} /></section>
        <ul className="flex flex-col gap-2">
          {rows.map((v) => {
            const [l, c] = VIS_STATUS[v.status] ?? VIS_STATUS.expected!;
            return (
              <li key={v.id} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3">
                <b className="num w-28">{visNo(v)}</b>
                <span className="flex-1 min-w-[160px]"><b>{v.visitor_name}</b><span className="block text-xs text-muted">{[v.visitor_company, v.expected_at ? `beklenen ${dt(v.expected_at)}` : null, v.checked_in_at ? `geldi ${dt(v.checked_in_at)}` : null, v.checked_out_at ? `çıktı ${dt(v.checked_out_at)}` : null].filter(Boolean).join(" · ")}</span></span>
                {v.status === "expected" && <a href={`/z/${v.token}`} target="_blank" className="text-xs font-semibold text-brand-700">Davetiye ↗</a>}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>
              </li>
            );
          })}
          {!rows.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz misafir kaydınız yok.</li>}
        </ul>
        {admin && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Siteden randevu ayarları</h2>
            <p className="text-xs text-muted">Ziyaretçiler mbdentaire.com/tr/ziyaret sayfasından randevu ister. Burada &quot;kimi ziyaret edeceksiniz&quot; seçeneklerini (kişi ya da birim), onaylayacak kişileri ve kabul edilen gün / saatleri belirleyin. Seçenek yoksa sitede randevu formu kapalı görünür.</p>
            {[...hosts, null].map((h) => (
              <form key={h?.id ?? "new"} action={visHostSave} className="rounded-[12px] border border-line p-3 flex flex-col gap-2">
                {h && <input type="hidden" name="id" value={h.id} />}
                <div className="flex flex-wrap gap-2">
                  <input name="label" defaultValue={h?.label ?? ""} required placeholder="Sitede görünecek ad: ör. Satış – Ahmet Yılmaz" aria-label="Ad" className="h-10 flex-1 min-w-[220px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
                  <input name="description" defaultValue={h?.description ?? ""} placeholder="Kısa açıklama (isteğe bağlı)" aria-label="Açıklama" className="h-10 flex-1 min-w-[200px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="text-xs font-semibold text-muted">Onaylayan:</span>
                  {people.map((p) => <label key={p.user_id} className="flex items-center gap-1"><input type="checkbox" name="approver" value={p.user_id} defaultChecked={h?.approver_ids.includes(p.user_id)} /> {p.display_name}</label>)}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <span className="text-xs font-semibold text-muted">Günler:</span>
                  {DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="weekday" value={i + 1} defaultChecked={(h?.weekdays ?? [1, 2, 3, 4, 5]).includes(i + 1)} /> {d}</label>)}
                  <label className="flex items-center gap-1">Saat <input name="hour_from" type="number" min={0} max={23} defaultValue={h?.hour_from ?? 9} className="h-9 w-16 rounded-lg border border-[#D5DEE8] px-2" /> – <input name="hour_to" type="number" min={1} max={24} defaultValue={h?.hour_to ?? 18} className="h-9 w-16 rounded-lg border border-[#D5DEE8] px-2" /></label>
                  <label className="flex items-center gap-1">Aralık <select name="slot" defaultValue={String(h?.slot_minutes ?? 30)} className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2"><option value="15">15 dk</option><option value="30">30 dk</option><option value="60">60 dk</option></select></label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="is_active" defaultChecked={h?.is_active ?? true} /> Sitede açık</label>
                  <PendingSubmit className="ml-auto h-9 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{h ? "Kaydet" : "+ Ekle"}</PendingSubmit>
                  {h && <button name="delete" value="1" className="h-9 px-3 text-sm font-semibold text-bad">Sil</button>}
                </div>
              </form>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
