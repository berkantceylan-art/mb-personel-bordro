import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { waLink } from "@/lib/wa";
import { ACT_KIND, LEAD_SOURCE, LEAD_STAGE } from "@/lib/quality";
import { addActivity, completeTask, convertLead, leadFromMessage, saveLead, setLeadStage, winbackTask } from "@/lib/crm-actions";

export const dynamic = "force-dynamic";

type L = { id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; city: string | null; country: string; source: string; stage: string; est_monthly: number | null; owner_id: string | null; next_action: string | null; next_date: string | null; lost_reason: string | null; note: string | null; customer_id: string | null; created_at: string };
type A = { id: string; lead_id: string | null; customer_id: string | null; kind: string; notes: string | null; at: string; due_date: string | null; done: boolean; lab_customers: { name: string } | null; crm_leads: { name: string } | null };

/** Müşteri ilişkileri: potansiyel klinikler, aşamalar, bugünün adımları, site mesajları, hacmi düşen klinikler */
export default async function CrmPage({ searchParams }: { searchParams: Promise<{ aday?: string; kayip?: string }> }) {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1 && (s.modules.lab ?? 0) < 3) redirect("/");
  const sp = await searchParams;
  const canEdit = (s.modules.sales ?? 0) >= 2 || (s.modules.lab ?? 0) >= 3;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: ld, error }, { data: tasks }, { data: msgs }, { data: watch }] = await Promise.all([
    supabase.from("crm_leads").select("*").order("next_date", { nullsFirst: false }).order("created_at", { ascending: false }).limit(500),
    supabase.from("crm_activities").select("id, lead_id, customer_id, kind, notes, at, due_date, done, lab_customers(name), crm_leads(name)").eq("done", false).order("due_date").limit(100),
    supabase.from("cms_messages").select("id, name, company, email, phone, country, message, created_at").eq("status", "new").order("created_at", { ascending: false }).limit(20),
    supabase.rpc("kpi_clinic_watch"),
  ]);
  const leads = (ld ?? []) as L[];
  const open = (tasks ?? []) as unknown as A[];
  const sel = sp.aday ? leads.find((l) => l.id === sp.aday) ?? null : null;
  const { data: hist } = sel ? await supabase.from("crm_activities").select("id, lead_id, customer_id, kind, notes, at, due_date, done").eq("lead_id", sel.id).order("at", { ascending: false }) : { data: [] };
  const { data: imported } = await supabase.from("crm_leads").select("message_id").not("message_id", "is", null).limit(2000);
  const done = new Set((imported ?? []).map((x) => x.message_id as string));
  const due = leads.filter((l) => !["won", "lost"].includes(l.stage) && l.next_date && l.next_date <= today);
  const stages = Object.keys(LEAD_STAGE).filter((k) => sp.kayip === "1" || k !== "lost");
  const pipe = leads.filter((l) => !["won", "lost"].includes(l.stage)).reduce((a, l) => a + Number(l.est_monthly ?? 0), 0);
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm w-full";

  return (
    <>
      <PageHeader title="Müşteri takibi (CRM)" subtitle="Potansiyel klinikler: görüşme, numune, teklif; bugünün adımları; site mesajlarından aday; hacmi düşen hekimleri geri kazanma" actions={<Link href="/kpi" className="text-sm font-semibold text-brand-700">Yönetim KPI</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1400px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261227000000_quality_crm.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[["Açık aday", leads.filter((l) => !["won", "lost"].includes(l.stage)).length], ["Bugün yapılacak", due.length + open.filter((t) => t.due_date && t.due_date <= today).length], ["Tahmini aylık potansiyel", fmt(pipe)], ["Bu yıl kazanılan", leads.filter((l) => l.stage === "won" && l.created_at.slice(0, 4) === today.slice(0, 4)).length]].map(([l, v]) => <div key={l as string} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>)}
        </div>

        {sel && (
          <Card title={sel.name} action={<span className="flex gap-3 text-sm">{sel.customer_id && <Link href={`/isler/hekimler/${sel.customer_id}`} className="font-semibold text-brand-700">Hekim kartı</Link>}<Link href="/crm" className="font-semibold text-brand-700">Kapat</Link></span>}>
            <div className="flex flex-wrap gap-2">
              {Object.entries(LEAD_STAGE).map(([k, [l, c]]) => (
                <form key={k} action={setLeadStage}><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="stage" value={k} /><button disabled={!canEdit} className="h-8 px-3 rounded-full text-xs font-semibold border" style={sel.stage === k ? { background: c, color: "#fff", borderColor: c } : { borderColor: "#E1E7EE" }}>{l}</button></form>
              ))}
              {sel.phone && <a href={`tel:${sel.phone}`} className="h-8 px-3 inline-flex items-center rounded-full border border-line text-xs font-semibold">Ara</a>}
              {waLink(sel.phone, `Merhaba ${sel.contact_name ?? ""}, `) && <a href={waLink(sel.phone, `Merhaba ${sel.contact_name ?? ""}, `)!} target="_blank" rel="noreferrer" className="h-8 px-3 inline-flex items-center rounded-full border border-[#25D366] text-[#128C7E] text-xs font-semibold">WhatsApp</a>}
              {canEdit && !sel.customer_id && <form action={convertLead} className="flex gap-1"><input type="hidden" name="id" value={sel.id} /><select name="kind" className="h-8 rounded-full border border-line px-2 text-xs"><option value="doctor_tr">Hekim (TR)</option><option value="clinic">Klinik</option><option value="doctor_foreign">Yurt dışı hekim</option><option value="hospital">Hastane</option></select><select name="currency" className="h-8 rounded-full border border-line px-2 text-xs"><option>TRY</option><option>EUR</option><option>USD</option></select><PendingSubmit className="h-8 px-3 rounded-full bg-ok text-white text-xs font-semibold">Kazanıldı → hekim kartı aç</PendingSubmit></form>}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <form action={saveLead} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="id" value={sel.id} /><input type="hidden" name="stage" value={sel.stage} />
                <input name="name" defaultValue={sel.name} required className={inp} />
                <input name="contact_name" defaultValue={sel.contact_name ?? ""} placeholder="Yetkili" className={inp} />
                <input name="phone" defaultValue={sel.phone ?? ""} placeholder="Telefon" className={inp} />
                <input name="email" defaultValue={sel.email ?? ""} placeholder="E-posta" className={inp} />
                <input name="city" defaultValue={sel.city ?? ""} placeholder="Şehir" className={inp} />
                <select name="source" defaultValue={sel.source} className={inp}>{Object.entries(LEAD_SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name="est_monthly" defaultValue={sel.est_monthly ? String(sel.est_monthly / 100) : ""} placeholder="Tahmini aylık ciro (₺)" className={inp} />
                <input name="next_date" type="date" defaultValue={sel.next_date ?? ""} className={inp} />
                <input name="next_action" defaultValue={sel.next_action ?? ""} placeholder="Sonraki adım" className={`${inp} sm:col-span-2`} />
                {sel.stage === "lost" && <input name="lost_reason" defaultValue={sel.lost_reason ?? ""} placeholder="Kaybetme nedeni" className={`${inp} sm:col-span-2`} />}
                <textarea name="note" defaultValue={sel.note ?? ""} rows={3} placeholder="Not" className="rounded-[10px] border border-line p-3 text-sm sm:col-span-2" />
                {canEdit && <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit>}
              </form>
              <div className="flex flex-col gap-2">
                {canEdit && (
                  <form action={addActivity} className="grid gap-2 sm:grid-cols-[140px_1fr]">
                    <input type="hidden" name="lead_id" value={sel.id} />
                    <select name="kind" className={inp}>{Object.entries(ACT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <input name="notes" placeholder="Ne konuşuldu / ne yapılacak" className={inp} />
                    <input name="due_date" type="date" className={inp} title="Sonraki adım tarihi" />
                    <div className="flex gap-2"><input name="next_action" placeholder="Sonraki adım (isteğe bağlı)" className={inp} /><PendingSubmit className="h-10 px-3 rounded-[10px] border border-line text-sm font-semibold">Ekle</PendingSubmit></div>
                  </form>
                )}
                <ul className="divide-y divide-[#EEF2F6] text-sm max-h-72 overflow-y-auto">
                  {((hist ?? []) as A[]).map((a) => <li key={a.id} className="py-1.5"><b>{ACT_KIND[a.kind]}</b> <span className="text-xs text-muted">{formatDate(a.at.slice(0, 10))}{!a.done && a.due_date ? ` · termin ${formatDate(a.due_date)}` : ""}</span>{a.notes && <div>{a.notes}</div>}</li>)}
                  {(hist ?? []).length === 0 && <li className="py-2 text-muted">Henüz görüşme kaydı yok.</li>}
                </ul>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold">Aday hattı</h2><Link href={sp.kayip === "1" ? "/crm" : "/crm?kayip=1"} className="text-xs font-semibold text-brand-700">{sp.kayip === "1" ? "Kaybedilenleri gizle" : "Kaybedilenleri göster"}</Link></div>
            <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(180px, 1fr))` }}>
              {stages.map((k) => {
                const list = leads.filter((l) => l.stage === k);
                return (
                  <section key={k} className="rounded-[16px] bg-[#F1F5F9] p-2 flex flex-col gap-2 min-h-[120px]">
                    <h3 className="text-xs font-bold uppercase tracking-wide px-1 flex justify-between" style={{ color: LEAD_STAGE[k]![1] }}><span>{LEAD_STAGE[k]![0]}</span><span>{list.length}</span></h3>
                    {list.slice(0, k === "won" ? 8 : 40).map((l) => (
                      <Link key={l.id} href={`/crm?aday=${l.id}`} className={`rounded-[12px] bg-white p-2.5 text-sm border ${sel?.id === l.id ? "border-brand-700" : "border-transparent"} hover:border-brand-700`}>
                        <b className="block truncate">{l.name}</b>
                        <span className="text-xs text-muted">{[l.city, LEAD_SOURCE[l.source]].filter(Boolean).join(" · ")}</span>
                        {l.next_date && !["won", "lost"].includes(l.stage) && <span className={`block text-xs mt-1 ${l.next_date <= today ? "text-bad font-semibold" : "text-muted"}`}>{formatDate(l.next_date)} · {l.next_action ?? "takip"}</span>}
                        {l.est_monthly ? <span className="block text-xs text-ok">{fmt(l.est_monthly)}/ay</span> : null}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <Card title={`Bugün ve geciken (${due.length + open.filter((t) => t.due_date && t.due_date <= today).length})`}>
              <ul className="divide-y divide-[#EEF2F6] text-sm">
                {due.map((l) => <li key={l.id} className="py-1.5"><Link href={`/crm?aday=${l.id}`} className="font-semibold text-brand-700">{l.name}</Link> <span className="text-xs text-muted">{l.next_action ?? "takip"} · {formatDate(l.next_date!)}</span></li>)}
                {open.filter((t) => !t.due_date || t.due_date <= today || t.customer_id).slice(0, 30).map((t) => (
                  <li key={t.id} className="py-1.5 flex gap-2 items-start">
                    <span className="flex-1">{t.customer_id ? <Link href={`/isler/hekimler/${t.customer_id}`} className="font-semibold text-brand-700">{t.lab_customers?.name}</Link> : <Link href={`/crm?aday=${t.lead_id}`} className="font-semibold text-brand-700">{t.crm_leads?.name}</Link>} <span className="text-xs text-muted">{t.notes}{t.due_date ? ` · ${formatDate(t.due_date)}` : ""}</span></span>
                    {canEdit && <form action={completeTask}><input type="hidden" name="id" value={t.id} /><PendingSubmit className="text-xs font-semibold text-ok">✓</PendingSubmit></form>}
                  </li>
                ))}
                {due.length === 0 && open.length === 0 && <li className="py-2 text-muted">Bugün için adım yok.</li>}
              </ul>
            </Card>
            {canEdit && (
              <Card title="Yeni aday">
                <form action={saveLead} className="flex flex-col gap-2">
                  <input name="name" required placeholder="Klinik / hekim adı" className={inp} />
                  <div className="grid grid-cols-2 gap-2"><input name="contact_name" placeholder="Yetkili" className={inp} /><input name="phone" placeholder="Telefon" className={inp} /></div>
                  <div className="grid grid-cols-2 gap-2"><input name="city" placeholder="Şehir" className={inp} /><select name="source" className={inp}>{Object.entries(LEAD_SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                  <div className="grid grid-cols-2 gap-2"><input name="next_action" placeholder="Sonraki adım" defaultValue="İlk arama" className={inp} /><input name="next_date" type="date" defaultValue={today} className={inp} /></div>
                  <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Ekle</PendingSubmit>
                </form>
              </Card>
            )}
            {(msgs ?? []).length > 0 && (
              <Card title="Site mesajları (yeni)">
                <ul className="divide-y divide-[#EEF2F6] text-sm">
                  {(msgs ?? []).map((m) => (
                    <li key={m.id} className="py-2">
                      <b>{m.company || m.name}</b> <span className="text-xs text-muted">{formatDate(String(m.created_at).slice(0, 10))}{m.country ? ` · ${m.country}` : ""}</span>
                      <p className="text-xs text-muted line-clamp-2">{m.message}</p>
                      {canEdit && (done.has(m.id) ? <span className="text-xs text-ok">Adaylarda</span> : <form action={leadFromMessage}><input type="hidden" name="id" value={m.id} /><PendingSubmit className="text-xs font-semibold text-brand-700">Adaya çevir</PendingSubmit></form>)}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {((watch ?? []) as unknown[]).length > 0 && (
              <Card title="Hacmi düşen hekimler">
                <ul className="divide-y divide-[#EEF2F6] text-sm">
                  {((watch ?? []) as { customer_id: string; name: string; prev60: number; last60: number; change_pct: number | null }[]).slice(0, 12).map((w) => (
                    <li key={w.customer_id} className="py-1.5 flex gap-2 items-center">
                      <Link href={`/isler/hekimler/${w.customer_id}`} className="flex-1 text-brand-700">{w.name}</Link>
                      <span className="text-xs text-bad">{w.prev60}→{w.last60}</span>
                      {canEdit && <form action={winbackTask}><input type="hidden" name="customer_id" value={w.customer_id} /><input type="hidden" name="why" value={`son 60 gün ${w.prev60} → ${w.last60} iş`} /><PendingSubmit className="text-xs font-semibold text-brand-700">Görev aç</PendingSubmit></form>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
