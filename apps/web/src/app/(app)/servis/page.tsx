import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice, Tabs, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { toggleTechnician } from "@/lib/service-actions";
import { MaintenanceButton, NewTicketForm, TechForm, type AssetOpt } from "./ServiceForms";
import { TICKET_COLS, TicketList, type TicketRow } from "./TicketList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Arıza / servis" };

/** Arıza / tamir / bakım: herkes bildirir; satın alma onaylar ve atar; teknisyen yapar; satın alma ücreti onaylar; muhasebe öder */
export default async function ServicePage({ searchParams }: { searchParams: Promise<{ s?: string; demirbas?: string }> }) {
  const ses = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const buyer = (ses.modules.purchases ?? 0) >= 2 || (ses.modules.assets ?? 0) >= 3;
  const fin = (ses.modules.finance ?? 0) >= 2;
  const [{ data: isTech }, { data: rows, error }, { data: assets }, { data: emp }, { data: dir }] = await Promise.all([
    supabase.rpc("svc_is_tech"),
    supabase.from("svc_tickets").select(TICKET_COLS).order("created_at", { ascending: false }).limit(400),
    supabase.from("assets").select("id, name, code, location, status").not("status", "in", "(RETIRED,LOST)").order("name").limit(2000),
    supabase.from("employees").select("id").eq("user_id", ses.userId).maybeSingle(),
    supabase.rpc("company_directory"),
  ]);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const { data: mineA } = emp ? await supabase.from("asset_assignments").select("asset_id").eq("employee_id", emp.id).is("returned_on", null) : { data: [] };
  const mineSet = new Set(((mineA ?? []) as { asset_id: string }[]).map((x) => x.asset_id));
  const opts: AssetOpt[] = ((assets ?? []) as AssetOpt[]).map((a) => ({ ...a, mine: mineSet.has(a.id) }));
  const all = (rows ?? []) as unknown as TicketRow[];
  const mine = all.filter((t) => t.reported_by === ses.userId);
  type Tab = [string, string, (t: TicketRow) => boolean];
  const TABS: Tab[] = [["benim", "Bildirimlerim", (t) => t.reported_by === ses.userId]];
  if (buyer) TABS.push(["onay", "Onay bekleyen", (t) => t.status === "reported"], ["acik", "Açık işler", (t) => ["approved", "in_progress"].includes(t.status)], ["ucret", "Ücret onayı", (t) => t.status === "done"]);
  if (buyer || fin) TABS.push(["odeme", "Ödeme bekleyen", (t) => t.status === "cost_approved"], ["kapanan", "Kapanan", (t) => ["closed", "rejected", "cancelled"].includes(t.status)]);
  const defTab = buyer ? "onay" : fin ? "odeme" : "benim";
  const tab = TABS.find((t) => t[0] === sp.s) ?? TABS.find((t) => t[0] === defTab)!;
  const shown = all.filter(tab[2]);
  const { data: techs } = buyer ? await supabase.rpc("svc_tech_list") : { data: [] };

  return (
    <>
      <PageHeader title="Arıza / servis" subtitle="Bozulan masa, fiş, cihaz… bildirin · satın alma onaylar, teknik servise ya da dış servise atar · ücret onayı ve ödeme"
        actions={(isTech || buyer) ? <Link href="/teknik-servis" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">🔧 Teknik servis ekranı</Link> : undefined} />
      <div className={`${page} max-w-[1100px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270106000000_service.sql çalıştırılmalı.</Notice>}
        <details className="bg-white border border-line rounded-[16px] p-4 md:p-5" open={!buyer || !!sp.demirbas || mine.length === 0}>
          <summary className="cursor-pointer font-display text-lg font-bold">➕ Arıza / tamir bildir</summary>
          <div className="mt-3"><NewTicketForm assets={opts} defaultAsset={sp.demirbas} /></div>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1"><Tabs active={`/servis?s=${tab[0]}`} items={TABS.map(([k, l, f]) => [`/servis?s=${k}`, l, all.filter(f).length])} /></div>
          {buyer && <MaintenanceButton />}
        </div>
        <TicketList rows={shown} names={names} />
        {buyer && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Teknik servis personeli</h2>
            <ul className="flex flex-col gap-1.5">
              {((techs ?? []) as { user_id: string; name: string; phone: string | null; skills: string | null; is_active: boolean; open_jobs: number }[]).map((t) => (
                <li key={t.user_id} className={`flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-sm ${t.is_active ? "" : "opacity-60"}`}>
                  <b className="flex-1">{t.name}</b><span className="text-muted">{[t.phone, t.skills].filter(Boolean).join(" · ")}</span><span>{t.open_jobs} açık iş</span>
                  <form action={toggleTechnician}><input type="hidden" name="user_id" value={t.user_id} /><input type="hidden" name="active" value={t.is_active ? "0" : "1"} /><button className="text-xs font-semibold text-brand-700">{t.is_active ? "Pasif yap" : "Aktif yap"}</button></form>
                </li>
              ))}
            </ul>
            <TechForm users={((dir ?? []) as { user_id: string; display_name: string }[]).filter((u) => !((techs ?? []) as { user_id: string }[]).some((t) => t.user_id === u.user_id))} />
          </section>
        )}
      </div>
    </>
  );
}
