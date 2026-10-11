import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { SVC_EVENT, SVC_KIND, SVC_PRIORITY, SVC_STATUS, svcNo, tl } from "@/lib/service";
import { cancelTicket, startTicket } from "@/lib/service-actions";
import { AddPhoto, ApproveForm, CostForm, DoneForm, PayForm } from "../ServiceForms";

export const dynamic = "force-dynamic";

type T = { id: string; year: number; no: number; kind: string; asset_id: string | null; title: string; description: string | null; location: string | null; priority: string; status: string; reported_by: string | null; technician_user: string | null; vendor: string | null; due_date: string | null; done_note: string | null; cost: number; vat_rate: number; cost_note: string | null; decision_note: string | null; created_at: string; started_at: string | null; done_at: string | null; paid_at: string | null; fin_txn_id: string | null; assets: { name: string; code: string | null; location: string | null; status: string } | null };
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const card = "bg-white border border-line rounded-[16px] p-4 md:p-5";

/** Servis kaydı: bilgiler, fotoğraflar, geçmiş ve rolüne göre işlem */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ses = await getSession();
  const supabase = await createClient();
  const [{ data: t0 }, { data: photos }, { data: ev }, { data: dir }, { data: isTech }] = await Promise.all([
    supabase.from("svc_tickets").select("*, assets(name, code, location, status)").eq("id", id).maybeSingle(),
    supabase.from("svc_photos").select("id, stage, data, created_at").eq("ticket_id", id).order("created_at"),
    supabase.from("svc_events").select("id, at, action, note, by_user").eq("ticket_id", id).order("at"),
    supabase.rpc("company_directory"),
    supabase.rpc("svc_is_tech"),
  ]);
  if (!t0) notFound();
  const t = t0 as unknown as T;
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const buyer = (ses.modules.purchases ?? 0) >= 2 || (ses.modules.assets ?? 0) >= 3;
  const fin = (ses.modules.finance ?? 0) >= 2;
  const canWork = (t.technician_user && t.technician_user === ses.userId) || (!t.technician_user && buyer) || (buyer && !!isTech);
  const [label, cls] = SVC_STATUS[t.status] ?? SVC_STATUS.reported!;
  const [pl, pcls] = SVC_PRIORITY[t.priority] ?? SVC_PRIORITY.normal!;
  const [{ data: techs }, { data: accounts }] = await Promise.all([
    buyer && ["reported", "approved"].includes(t.status) ? supabase.rpc("svc_tech_list") : Promise.resolve({ data: [] }),
    fin && t.status === "cost_approved" ? supabase.from("fin_accounts").select("id, name, kind").in("kind", ["cash", "bank", "credit_card"]).eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const pics = (photos ?? []) as { id: string; stage: string; data: string }[];
  const Pics = ({ stage }: { stage: string }) => (
    <div className="flex flex-wrap gap-2">
      {pics.filter((p) => p.stage === stage).map((p) => (
        <a key={p.id} href={p.data} target="_blank" rel="noopener">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.data} alt="" className="h-28 w-28 rounded-xl border border-line object-cover" />
        </a>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title={`${svcNo(t)} · ${t.title}`} subtitle={`${SVC_KIND[t.kind]} · ${dt(t.created_at)}${t.reported_by ? ` · bildiren ${names.get(t.reported_by) ?? "—"}` : " · otomatik bakım"}`} />
      <div className={`${page} max-w-[1000px]`}>
        <Link href="/servis" className="text-sm font-semibold text-brand-700">← Arıza / servis</Link>
        <section className={`${card} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${cls}`}>{label}</span>
            <span className={`text-sm ${pcls}`}>{pl}</span>
            {t.due_date && <span className="text-sm text-muted">Hedef: <b>{formatDate(t.due_date)}</b></span>}
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            {t.assets && <div><dt className="text-xs text-muted">Demirbaş</dt><dd><Link href={`/teknik-servis?d=${t.asset_id}`} className="font-semibold text-brand-700">{t.assets.name}{t.assets.code ? ` · ${t.assets.code}` : ""}</Link></dd></div>}
            {(t.location || t.assets?.location) && <div><dt className="text-xs text-muted">Yer</dt><dd>{t.location ?? t.assets?.location}</dd></div>}
            {t.technician_user && <div><dt className="text-xs text-muted">Teknisyen</dt><dd>🔧 {names.get(t.technician_user) ?? "—"}</dd></div>}
            {t.vendor && <div><dt className="text-xs text-muted">Dış servis</dt><dd>🏢 {t.vendor}</dd></div>}
            {t.cost > 0 && <div><dt className="text-xs text-muted">Ücret</dt><dd className="num font-semibold">{tl(t.cost)} TL <span className="text-xs font-normal text-muted">KDV %{Number(t.vat_rate)} dahil</span>{t.cost_note ? <span className="block text-xs font-normal text-muted">{t.cost_note}</span> : null}</dd></div>}
            {t.paid_at && <div><dt className="text-xs text-muted">Ödeme</dt><dd>✓ {dt(t.paid_at)}{t.fin_txn_id && fin ? <Link href={"/finans/islemler"} className="ml-2 text-xs font-semibold text-brand-700">kayıt →</Link> : null}</dd></div>}
          </dl>
          {t.description && <p className="text-sm whitespace-pre-wrap"><b>Açıklama:</b> {t.description}</p>}
          {t.decision_note && <p className="text-sm"><b>Not:</b> {t.decision_note}</p>}
          {t.done_note && <p className="text-sm rounded-xl bg-[#F0FDF4] p-3"><b>Yapılan:</b> {t.done_note}</p>}
        </section>

        <section className={`${card} grid gap-4 md:grid-cols-2`}>
          <div className="flex flex-col gap-2"><h2 className="font-display font-semibold">Önce</h2><Pics stage="before" />{!["closed", "rejected", "cancelled"].includes(t.status) && <AddPhoto id={id} stage="before" />}</div>
          <div className="flex flex-col gap-2"><h2 className="font-display font-semibold">Sonra</h2><Pics stage="after" />{canWork && ["in_progress", "done"].includes(t.status) && <AddPhoto id={id} stage="after" />}</div>
        </section>

        {buyer && (t.status === "reported" || t.status === "approved") && (
          <section className={card}>
            <h2 className="font-display font-semibold mb-3">{t.status === "reported" ? "Satın alma kararı" : "Yeniden ata"}</h2>
            <ApproveForm id={id} techs={((techs ?? []) as { user_id: string; name: string; open_jobs: number; is_active: boolean }[]).filter((x) => x.is_active)} reassign={t.status === "approved"} />
          </section>
        )}
        {canWork && t.status === "approved" && (
          <section className={`${card} flex flex-wrap items-center gap-3`}>
            <form action={startTicket}><input type="hidden" name="id" value={id} /><button className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">{t.kind === "external" ? "🚚 Servise gönderildi" : "▶ İşe başla"}</button></form>
            <span className="text-sm text-muted">ya da doğrudan aşağıdan “Tamamlandı” girin.</span>
          </section>
        )}
        {canWork && ["approved", "in_progress"].includes(t.status) && (
          <section className="bg-white border-2 border-[#22C55E]/40 rounded-[16px] p-4 md:p-5">
            <h2 className="font-display font-semibold mb-3">{t.kind === "external" ? "Servisten geldi · tamamla" : "İş tamamlandı"}</h2>
            <DoneForm id={id} external={t.kind === "external"} />
          </section>
        )}
        {buyer && t.status === "done" && (
          <section className={card}><h2 className="font-display font-semibold mb-3">Ücret onayı</h2><CostForm id={id} cost={(t.cost / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} /></section>
        )}
        {fin && t.status === "cost_approved" && (
          <section className={card}><h2 className="font-display font-semibold mb-3">Ödeme · {tl(t.cost)} TL</h2><PayForm id={id} accounts={(accounts ?? []) as { id: string; name: string; kind: string }[]} /></section>
        )}
        {t.status === "cost_approved" && !fin && <p className="text-sm text-muted">Muhasebenin ödemesi bekleniyor.</p>}
        {["reported", "approved"].includes(t.status) && (t.reported_by === ses.userId || buyer) && (
          <form action={cancelTicket}><input type="hidden" name="id" value={id} /><button className="text-sm font-semibold text-bad hover:underline">Kaydı iptal et</button></form>
        )}

        <section className={card}>
          <h2 className="font-display font-semibold mb-2">Geçmiş</h2>
          <ol className="flex flex-col gap-1.5 text-sm">
            {((ev ?? []) as { id: number; at: string; action: string; note: string | null; by_user: string | null }[]).map((e) => (
              <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-xs text-muted num">{dt(e.at)}</span><span>{SVC_EVENT[e.action] ?? e.action}{e.by_user ? <span className="text-muted"> · {names.get(e.by_user) ?? ""}</span> : null}{e.note ? <span className="text-muted"> · {e.note}</span> : null}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
