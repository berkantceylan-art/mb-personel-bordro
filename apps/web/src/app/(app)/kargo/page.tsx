import Link from "next/link";
import { redirect } from "next/navigation";
import { Stat, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { CARRIER, OPEN_IN, OPEN_OUT, STATUS, daysSince, trackingUrl, type Shipment } from "@/lib/shipments";
import { accountNames } from "./data";

export const dynamic = "force-dynamic";

const TABS = [
  ["gelen", "Gelen (açık)"],
  ["giden", "Giden (açık)"],
  ["gumruk", "Gümrükte"],
  ["gecmis", "Tümü / geçmiş"],
] as const;

/** Kargo, gümrük, kurye: pano ve liste */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ sekme?: string; q?: string; firma?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.sekme) ? sp.sekme! : "gelen";
  const supabase = await createClient();
  const { data, error } = await supabase.from("shipments").select("*").order("created_at", { ascending: false }).limit(1000);
  const all = (data ?? []) as Shipment[];
  const names = await accountNames(all.map((x) => x.portal_account_id ?? ""));
  const today = todayIso();

  const openIn = all.filter((x) => x.direction === "in" && OPEN_IN.includes(x.status));
  const openOut = all.filter((x) => x.direction === "out" && OPEN_OUT.includes(x.status));
  const c = {
    coming: openIn.filter((x) => ["expected", "in_transit", "out_for_delivery"].includes(x.status)).length,
    customs: all.filter((x) => x.status === "at_customs").length,
    toOpen: openIn.filter((x) => x.status === "arrived").length,
    toJob: openIn.filter((x) => x.status === "opened").length,
    ready: openOut.filter((x) => x.status === "ready").length,
    courier: all.filter((x) => x.carrier === "our_courier" && x.courier_date === today && !["delivered", "arrived", "opened", "job_created", "cancelled"].includes(x.status)).length,
  };

  const q = (sp.q ?? "").toLocaleLowerCase("tr").replace(/\s+/g, "");
  let list = tab === "gelen" ? openIn : tab === "giden" ? openOut : tab === "gumruk" ? all.filter((x) => x.status === "at_customs") : all;
  if (sp.firma) list = list.filter((x) => x.carrier === sp.firma);
  if (q) list = list.filter((x) => `${x.no}${x.tracking_no ?? ""}${x.party_name ?? ""}${names.get(x.portal_account_id ?? "") ?? ""}${x.country ?? ""}`.toLocaleLowerCase("tr").replace(/\s+/g, "").includes(q));

  const th = "py-2.5 px-3 font-semibold border-b border-line text-left whitespace-nowrap";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm";

  return (
    <>
      <PageHeader
        title="Kargo, gümrük ve kurye"
        subtitle="Gelen ölçüler ve giden işler: geldi mi, nerede?"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/kargo/okut" className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">Paket okut</Link>
            <Link href="/kargo/yeni?yon=in" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">+ Gelen</Link>
            <Link href="/kargo/yeni?yon=out" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">+ Giden</Link>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">Kargo tabloları yok: Supabase&apos;de 20261124000000_shipments.sql çalıştırın.</p>}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-6">
          <Stat label="Yolda / bekleniyor" value={String(c.coming)} href="/kargo?sekme=gelen" />
          <Stat label="Gümrükte" value={String(c.customs)} href="/kargo?sekme=gumruk" />
          <Stat label="Açılmayı bekleyen" value={String(c.toOpen)} sub="geldi, açılmadı" href="/kargo?sekme=gelen" />
          <Stat label="İş kaydı bekleyen" value={String(c.toJob)} sub="açıldı" href="/kargo?sekme=gelen" />
          <Stat label="Sevke hazır" value={String(c.ready)} href="/kargo?sekme=giden" />
          <Stat label="Bugün kurye" value={String(c.courier)} href="/kargo/kurye" />
        </section>

        <nav className="flex flex-wrap gap-2" aria-label="Liste">
          {TABS.map(([k, l]) => (
            <Link key={k} href={`/kargo?sekme=${k}`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold ${tab === k ? "bg-brand-700 text-white" : "bg-white border border-line text-brand-700"}`}>
              {l}
            </Link>
          ))}
        </nav>

        <form className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="sekme" value={tab} />
          <input name="q" defaultValue={sp.q} placeholder="Takip no, gönderi no, hekim, ülke" className={`${input} flex-1 min-w-56`} />
          <select name="firma" defaultValue={sp.firma ?? ""} className={input}>
            <option value="">Tüm firmalar</option>
            {Object.entries(CARRIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ara</button>
        </form>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-xs text-muted">
                <th className={th}>No</th><th className={th}>Yön</th><th className={th}>Firma / takip</th><th className={th}>Gönderen / alıcı</th><th className={th}>Paket</th><th className={th}>Durum</th><th className={th}>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const [label, cls] = STATUS[x.status];
                const url = trackingUrl(x.carrier, x.tracking_no);
                const stale = OPEN_IN.includes(x.status) || OPEN_OUT.includes(x.status) ? daysSince(x.updated_at) : 0;
                return (
                  <tr key={x.id} className="hover:bg-[#F8FAFC]">
                    <td className={`${td} num`}><Link href={`/kargo/${x.id}`} className="font-semibold text-brand-700">G{x.no}</Link></td>
                    <td className={td}>{x.direction === "in" ? "↓ Gelen" : "↑ Giden"}</td>
                    <td className={td}>
                      <div className="font-semibold">{CARRIER[x.carrier]}</div>
                      {x.tracking_no && (url ? <a href={url} target="_blank" rel="noreferrer" className="num text-xs text-brand-700 underline">{x.tracking_no}</a> : <span className="num text-xs text-muted">{x.tracking_no}</span>)}
                    </td>
                    <td className={td}>
                      <div>{(x.portal_account_id && names.get(x.portal_account_id)) || x.party_name || "—"}</div>
                      <div className="text-xs text-muted">{[x.city, x.country].filter(Boolean).join(", ")}</div>
                    </td>
                    <td className={`${td} num`}>{x.package_count}</td>
                    <td className={td}>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
                      {stale >= 3 && <div className="text-xs text-warn mt-1">{stale} gündür değişmedi</div>}
                    </td>
                    <td className={`${td} num text-xs text-muted`}>
                      {x.carrier === "our_courier" && x.courier_date ? `Kurye: ${formatDate(x.courier_date)}` : x.expected_on ? `Beklenen: ${formatDate(x.expected_on)}` : formatDate(x.created_at)}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">Kayıt yok.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Yabancı hekim, klinik ve aracı kuruluşlar portaldan &quot;kargoya verdim&quot; dediğinde paket burada <b>Yolda</b> olarak görünür. Yerli hekimlerin kurye talepleri <b>Kurye rotası</b> ekranına düşer. DHL / UPS durumları şimdilik firmanın sitesinden (takip numarasına tıklayın) kontrol edilip elle güncellenir; API anahtarları eklenince otomatik olacak.</p>
      </div>
    </>
  );
}
