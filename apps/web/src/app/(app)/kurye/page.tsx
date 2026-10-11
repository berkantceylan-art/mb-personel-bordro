import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { wbNo } from "@/lib/waybill";
import { orderPicked } from "@/lib/waybill-actions";
import { waCourierText, waLink } from "@/lib/wa";
import { DeliverForm } from "./DeliverForm";

export const dynamic = "force-dynamic";

type C = { name: string; phone: string | null; address: string | null; city: string | null; doc_lang: string | null };

/** Kurye ekranı (telefon): bugünün teslim edilecek irsaliyeleri ve alınacak ölçüler; harita, arama, WhatsApp, imzayla teslim */
export default async function CourierScreen() {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const supabase = await createClient();
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [{ data: wd }, { data: od }, { data: co }] = await Promise.all([
    supabase.from("lab_waybills").select("id, year, no, ship_date, total, currency, job_count, delivered_at, delivered_to, lab_customers(name, phone, address, city, doc_lang)").neq("status", "cancelled").gte("ship_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).or(`delivered_at.is.null,ship_date.eq.${today}`).order("ship_date").limit(100),
    supabase.from("lab_orders").select("id, year, no, patient, pickup_note, notes, picked_at, lab_customers(name, phone, address, city, doc_lang)").eq("pickup", true).in("status", ["new", "confirmed"]).order("created_at").limit(100),
    supabase.from("companies").select("name").eq("id", s.companyId).maybeSingle(),
  ]);
  const { data: buyLists } = await supabase.rpc("stk_buy_lists_mine");
  const myLists = (buyLists ?? []) as { id: string; no: string; planned_on: string | null; note: string | null; total: number; picked: number }[];
  const wbs = (wd ?? []) as unknown as { id: string; year: number; no: number; ship_date: string; total: number; currency: string; job_count: number; delivered_at: string | null; delivered_to: string | null; lab_customers: C | null }[];
  const pickups = ((od ?? []) as unknown as { id: string; year: number; no: number; patient: string | null; pickup_note: string | null; notes: string | null; picked_at: string | null; lab_customers: C | null }[]).filter((o) => !o.picked_at);
  const todo = wbs.filter((w) => !w.delivered_at);
  const done = wbs.filter((w) => w.delivered_at);
  const company = (co?.name as string) ?? "MB Dental";
  const addr = (c: C | null) => [c?.address, c?.city].filter(Boolean).join(", ");
  const stops = [...todo.map((w) => addr(w.lab_customers)), ...pickups.map((o) => addr(o.lab_customers))].filter(Boolean);
  const route = stops.length ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stops[stops.length - 1]!)}${stops.length > 1 ? `&waypoints=${encodeURIComponent(stops.slice(0, -1).slice(0, 9).join("|"))}` : ""}&travelmode=driving` : null;

  const Actions = ({ c }: { c: C | null }) => {
    const a = addr(c);
    const wa = waLink(c?.phone, waCourierText(c?.doc_lang, c?.name ?? "", company));
    return (
      <div className="flex flex-wrap gap-2">
        {a && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`} target="_blank" rel="noreferrer" className="h-11 px-3 inline-flex items-center rounded-[12px] border border-line font-semibold">Harita</a>}
        {c?.phone && <a href={`tel:${c.phone}`} className="h-11 px-3 inline-flex items-center rounded-[12px] border border-line font-semibold">Ara</a>}
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="h-11 px-3 inline-flex items-center rounded-[12px] border border-[#25D366] text-[#128C7E] font-semibold">WhatsApp: yoldayım</a>}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Kurye" subtitle={`${todo.length} teslimat · ${pickups.length} ölçü alma`} actions={<span className="flex gap-4 text-sm font-semibold">{route && <a href={route} target="_blank" rel="noreferrer" className="text-brand-700">Tüm rotayı haritada aç</a>}<Link href="/kargo/kurye" className="text-brand-700">Kargo rotası</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[900px]">
        {myLists.map((b) => (
          <Link key={b.id} href={`/alim/${b.id}`} className="rounded-[18px] border-2 border-[#A78BFA] bg-[#F5F3FF] p-4 flex items-center gap-3">
            <span className="text-2xl">🛒</span>
            <span className="flex-1"><b className="font-display text-lg">Alım listesi {b.no}</b><span className="block text-sm text-muted">{b.picked} / {b.total} kalem alındı{b.note ? ` · ${b.note}` : ""}</span></span>
            <span className="font-semibold text-[#6D28D9]">Aç →</span>
          </Link>
        ))}
        {todo.map((w) => (
          <article key={w.id} className="rounded-[18px] border border-line bg-white p-4 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0"><b className="font-display text-lg">{w.lab_customers?.name}</b><div className="text-sm text-muted">{addr(w.lab_customers) || "Adres yok"}</div></div>
              <span className="text-right text-sm"><span className="block font-mono text-xs text-muted">{wbNo(w.year, w.no)}</span>{w.job_count} iş · {money(w.total, w.currency)}{w.ship_date !== today && <span className="block text-xs text-bad font-semibold">{formatDate(w.ship_date)} irsaliyesi</span>}</span>
            </div>
            <Actions c={w.lab_customers} />
            <div className="flex flex-wrap gap-2 items-center"><DeliverForm id={w.id} /><Link href={`/yazdir/irsaliye/${w.id}`} className="text-sm font-semibold text-brand-700">İrsaliye</Link></div>
          </article>
        ))}
        {pickups.map((o) => (
          <article key={o.id} className="rounded-[18px] border-2 border-dashed border-[#F5D9A8] bg-[#FFFBF2] p-4 flex flex-col gap-3">
            <div className="flex items-start gap-2"><div className="flex-1"><span className="text-xs font-bold uppercase tracking-wide text-[#8A5A00]">Ölçü / model alınacak</span><b className="block font-display text-lg">{o.lab_customers?.name}</b><div className="text-sm text-muted">{addr(o.lab_customers) || "Adres yok"}</div>{(o.pickup_note || o.notes) && <div className="text-sm mt-1">{o.pickup_note ?? o.notes}</div>}</div><span className="text-xs font-mono text-muted">SİP-{o.year}-{String(o.no).padStart(4, "0")}</span></div>
            <Actions c={o.lab_customers} />
            <form action={orderPicked}><input type="hidden" name="id" value={o.id} /><PendingSubmit className="h-11 px-4 rounded-[12px] bg-[#D97706] text-white font-bold">Alındı</PendingSubmit></form>
          </article>
        ))}
        {todo.length === 0 && pickups.length === 0 && <p className="rounded-[18px] border border-dashed border-[#C5D0DB] p-8 text-center text-muted">Bekleyen teslimat ya da ölçü alma yok.</p>}
        {done.length > 0 && (
          <section className="rounded-[18px] border border-line bg-white p-4">
            <h2 className="font-semibold mb-2">Bugün teslim edilenler</h2>
            <ul className="text-sm divide-y divide-[#EEF2F6]">{done.map((w) => <li key={w.id} className="py-1.5 flex justify-between gap-2"><span>{w.lab_customers?.name} · {w.job_count} iş</span><span className="text-ok">✓ {w.delivered_to ?? ""} {new Date(w.delivered_at!).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</span></li>)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
