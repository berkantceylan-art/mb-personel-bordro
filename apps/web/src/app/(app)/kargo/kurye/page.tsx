import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { SLOT, STATUS, type Shipment } from "@/lib/shipments";
import { accountNames } from "../data";

export const dynamic = "force-dynamic";

const DONE = ["delivered", "arrived", "opened", "job_created", "cancelled", "returned"];

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bizim kuryenin günlük rotası: alınacak ölçüler ve teslim edilecek işler */
export default async function CourierPage({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : todayIso();
  const supabase = await createClient();
  const [{ data: dayRows }, { data: undated }] = await Promise.all([
    supabase.from("shipments").select("*").eq("carrier", "our_courier").eq("courier_date", day).order("courier_slot").order("created_at"),
    supabase.from("shipments").select("*").eq("carrier", "our_courier").is("courier_date", null).eq("status", "ready").order("created_at"),
  ]);
  const rows = (dayRows ?? []) as Shipment[];
  const later = (undated ?? []) as Shipment[];
  const names = await accountNames([...rows, ...later].map((x) => x.portal_account_id ?? ""));
  const pick = rows.filter((x) => x.direction === "in");
  const drop = rows.filter((x) => x.direction === "out");
  const open = rows.filter((x) => !DONE.includes(x.status)).length;

  const Item = ({ x }: { x: Shipment }) => {
    const done = DONE.includes(x.status);
    const maps = x.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([x.address, x.city].filter(Boolean).join(", "))}` : null;
    return (
      <li className={`rounded-xl border p-4 flex flex-col gap-2 ${done ? "border-line bg-[#F8FAFC] opacity-70" : "border-line bg-white"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/kargo/${x.id}`} className="font-semibold text-brand-700 text-base">{(x.portal_account_id && names.get(x.portal_account_id)) || x.party_name || "—"}</Link>
          <span className="text-xs text-muted">G{x.no} · {SLOT[x.courier_slot ?? "any"]} · {x.package_count} paket</span>
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-md ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span>
        </div>
        {x.address && <p className="text-sm whitespace-pre-line">{x.address}{x.city ? `, ${x.city}` : ""}</p>}
        {x.note && <p className="text-sm text-muted">{x.note}</p>}
        <div className="flex flex-wrap gap-2">
          {x.phone && <a href={`tel:${x.phone.replace(/[^\d+]/g, "")}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">📞 Ara</a>}
          {maps && <a href={maps} target="_blank" rel="noreferrer" className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">🗺 Yol tarifi</a>}
          {!done && <Link href={`/kargo/${x.id}`} className="h-10 px-3 inline-flex items-center rounded-[10px] bg-ok text-white text-sm font-semibold">{x.direction === "in" ? "Teslim al (imza)" : "Teslim et (imza)"}</Link>}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Kurye rotası" subtitle={`${formatDate(day)} · ${open} açık iş`} actions={<Link href="/kargo/yeni?yon=out" className="text-sm font-semibold text-brand-700">+ Teslimat ekle</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-6 max-w-[900px]">
        <nav className="flex flex-wrap gap-2 items-center">
          <Link href={`/kargo/kurye?gun=${shift(day, -1)}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-line bg-white font-semibold text-brand-700">← Önceki gün</Link>
          <Link href="/kargo/kurye" className={`h-10 px-3 inline-flex items-center rounded-[10px] font-semibold ${day === todayIso() ? "bg-brand-700 text-white" : "border border-line bg-white text-brand-700"}`}>Bugün</Link>
          <Link href={`/kargo/kurye?gun=${shift(todayIso(), 1)}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-line bg-white font-semibold text-brand-700">Yarın</Link>
          <Link href={`/kargo/kurye?gun=${shift(day, 1)}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-line bg-white font-semibold text-brand-700">Sonraki gün →</Link>
        </nav>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-brand-800">Alınacak ölçü / paket ({pick.length})</h2>
          <ul className="flex flex-col gap-3">{pick.map((x) => <Item key={x.id} x={x} />)}</ul>
          {pick.length === 0 && <p className="text-sm text-muted">Bu gün için alım yok.</p>}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-brand-800">Teslim edilecek iş ({drop.length})</h2>
          <ul className="flex flex-col gap-3">{drop.map((x) => <Item key={x.id} x={x} />)}</ul>
          {drop.length === 0 && <p className="text-sm text-muted">Bu gün için teslimat yok.</p>}
        </section>

        {later.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-warn">Sevke hazır, günü belirlenmemiş ({later.length})</h2>
            <ul className="flex flex-col gap-3">{later.map((x) => <Item key={x.id} x={x} />)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
