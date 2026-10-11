import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { Q_CATEGORY, Q_SEVERITY, Q_SOURCE, Q_STATUS } from "@/lib/quality";
import { openNcr, saveComplaint } from "@/lib/quality-actions";
import { QNav } from "./QNav";

export const dynamic = "force-dynamic";

type C = { id: string; no: number; customer_id: string | null; job_id: string | null; source: string; category: string; severity: string; description: string; status: string; root_cause: string | null; resolution: string | null; remake: boolean; cost: number; received_at: string; closed_at: string | null; lab_customers: { name: string } | null; jobs: { no: number; patient: string | null } | null };
type S = { open_complaints: number; complaints: number; units: number; by_category: Record<string, number>; open_ncrs: number; overdue_actions: number; avg_close_days: number | null; survey_avg: number | null; survey_n: number };

/** Kalite: hekim şikâyetleri, özet göstergeler */
export default async function QualityPage({ searchParams }: { searchParams: Promise<{ sikayet?: string; durum?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const canEdit = (s.modules.production ?? 0) >= 2 || (s.modules.lab ?? 0) >= 2;
  const supabase = await createClient();
  let q = supabase.from("qms_complaints").select("*, lab_customers(name), jobs(no, patient)").order("received_at", { ascending: false }).limit(200);
  if (sp.durum === "acik") q = q.neq("status", "closed");
  else if (sp.durum === "kapali") q = q.eq("status", "closed");
  const [{ data, error }, { data: sum }, { data: cust }, sel] = await Promise.all([
    q,
    supabase.rpc("qms_summary", { p_days: 90 }),
    supabase.from("lab_customers").select("id, name").eq("is_active", true).order("name").limit(2000),
    sp.sikayet ? supabase.from("qms_complaints").select("*, lab_customers(name), jobs(no, patient)").eq("id", sp.sikayet).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as unknown as C[];
  const sm = (sum ?? null) as S | null;
  const c = sel.data as unknown as C | null;
  const { data: ncrs } = c ? await supabase.from("qms_ncrs").select("id, no, title, status").eq("complaint_id", c.id) : { data: [] };
  const rate = sm && sm.units ? ((sm.complaints / sm.units) * 100).toFixed(1) : null;
  const cats = sm ? Object.entries(sm.by_category).sort((a, b) => b[1] - a[1]) : [];
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm w-full";
  const ta = "rounded-[10px] border border-line bg-white p-3 text-sm w-full";

  return (
    <>
      <PageHeader title="Kalite yönetimi" subtitle="Hekim şikâyetleri, uygunsuzluklar ve düzeltici faaliyetler, iç denetim, memnuniyet anketi" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261227000000_quality_crm.sql çalıştırılmalı.</Notice>}
        <QNav at="/kalite" />
        {sm && (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            {[["Açık şikâyet", sm.open_complaints, sm.open_complaints ? "text-bad" : ""], ["Şikâyet / 100 ünit (90 gün)", rate ?? "—", ""], ["Ort. kapanış", sm.avg_close_days != null ? `${sm.avg_close_days} gün` : "—", ""], ["Açık uygunsuzluk · geciken DÖF", `${sm.open_ncrs} · ${sm.overdue_actions}`, sm.overdue_actions ? "text-bad" : ""], ["Memnuniyet (90 gün)", sm.survey_avg != null ? `${sm.survey_avg} / 5 (${sm.survey_n})` : "—", ""]].map(([l, v, cl]) => (
              <div key={l as string} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-xl font-bold mt-1 ${cl}`}>{v}</div></div>
            ))}
          </div>
        )}

        {c && (
          <Card title={`Şikâyet #${c.no}${c.lab_customers ? ` · ${c.lab_customers.name}` : ""}`} action={<Link href="/kalite" className="text-sm font-semibold text-brand-700">Kapat</Link>}>
            <div className="text-sm text-muted">{formatDate(c.received_at.slice(0, 10))} · {Q_SOURCE[c.source]}{c.jobs ? <> · <Link href={`/isler/${c.job_id}`} className="text-brand-700 font-semibold">İş #{c.jobs.no}</Link> {c.jobs.patient}</> : null}</div>
            <form action={saveComplaint} className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="id" value={c.id} />
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Durum<select name="status" defaultValue={c.status} className={inp}>{Object.entries(Q_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Kategori<select name="category" defaultValue={c.category} className={inp}>{Object.entries(Q_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Ciddiyet<select name="severity" defaultValue={c.severity} className={inp}>{Object.entries(Q_SEVERITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Maliyet (₺)<input name="cost" inputMode="decimal" defaultValue={c.cost ? String(c.cost / 100).replace(".", ",") : ""} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1 md:col-span-4">Şikâyet<textarea name="description" rows={2} defaultValue={c.description} maxLength={2000} className={ta} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1 md:col-span-2">Kök neden<textarea name="root_cause" rows={3} defaultValue={c.root_cause ?? ""} maxLength={2000} placeholder="Neden oldu? (5 neden)" className={ta} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1 md:col-span-2">Çözüm / hekime dönüş<textarea name="resolution" rows={3} defaultValue={c.resolution ?? ""} maxLength={2000} className={ta} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" name="remake" defaultChecked={c.remake} /> Yeniden yapıldı</label>
              {canEdit && <div className="md:col-span-3 flex gap-2 items-center"><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit></div>}
            </form>
            <div className="flex flex-wrap gap-2 items-center border-t border-line pt-3 text-sm">
              <b>Uygunsuzluk kayıtları:</b>
              {(ncrs ?? []).map((n) => <Link key={n.id} href={`/kalite/uygunsuzluk?id=${n.id}`} className="text-brand-700 font-semibold">#{n.no} {n.title}</Link>)}
              {canEdit && <form action={openNcr}><input type="hidden" name="complaint_id" value={c.id} /><input type="hidden" name="title" value={`${Q_CATEGORY[c.category]} · şikâyet #${c.no}`} /><input type="hidden" name="description" value={c.description} /><PendingSubmit className="h-9 px-3 rounded-[10px] border border-line text-sm font-semibold">+ Uygunsuzluk / DÖF aç</PendingSubmit></form>}
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
            <div className="flex gap-1 p-3 text-sm">{[["", "Tümü"], ["acik", "Açık"], ["kapali", "Kapanan"]].map(([k, l]) => <Link key={k} href={k ? `/kalite?durum=${k}` : "/kalite"} className={`h-8 px-3 inline-flex items-center rounded-[8px] font-semibold ${(sp.durum ?? "") === k ? "bg-brand-700 text-white" : "border border-line"}`}>{l}</Link>)}</div>
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-left text-xs text-muted"><th className="p-3">No</th><th className="p-3">Tarih</th><th className="p-3">Hekim</th><th className="p-3">Kategori</th><th className="p-3">Şikâyet</th><th className="p-3">Ciddiyet</th><th className="p-3">Durum</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#EEF2F6]">
                    <td className="p-3"><Link href={`/kalite?sikayet=${r.id}`} className="font-semibold text-brand-700">#{r.no}</Link></td>
                    <td className="p-3 whitespace-nowrap">{formatDate(r.received_at.slice(0, 10))}</td>
                    <td className="p-3">{r.lab_customers?.name ?? "—"}{r.jobs && <span className="block text-xs text-muted">İş #{r.jobs.no}</span>}</td>
                    <td className="p-3">{Q_CATEGORY[r.category]}<span className="block text-xs text-muted">{Q_SOURCE[r.source]}</span></td>
                    <td className="p-3 max-w-[320px]">{r.description.slice(0, 140)}{r.cost ? <span className="block text-xs text-bad">{fmt(r.cost)}</span> : null}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${Q_SEVERITY[r.severity]?.[1]}`}>{Q_SEVERITY[r.severity]?.[0]}</span></td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${Q_STATUS[r.status]?.[1]}`}>{Q_STATUS[r.status]?.[0]}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">Şikâyet kaydı yok.</td></tr>}
              </tbody>
            </table>
          </section>
          <div className="flex flex-col gap-4">
            {canEdit && (
              <Card title="Yeni şikâyet">
                <form action={saveComplaint} className="flex flex-col gap-2">
                  <select name="customer_id" className={inp}><option value="">Hekim (iş no yazarsanız otomatik)</option>{(cust ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <input name="job_no" inputMode="numeric" placeholder="İş no (isteğe bağlı)" className={inp} />
                  <div className="grid grid-cols-2 gap-2">
                    <select name="category" className={inp}>{Object.entries(Q_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <select name="severity" defaultValue="medium" className={inp}>{Object.entries(Q_SEVERITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
                  </div>
                  <select name="source" className={inp}>{Object.entries(Q_SOURCE).filter(([k]) => !["portal", "survey"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <textarea name="description" required rows={3} maxLength={2000} placeholder="Hekim ne dedi?" className={ta} />
                  <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit>
                </form>
              </Card>
            )}
            {cats.length > 0 && (
              <Card title="Son 90 gün kategori">
                <ul className="flex flex-col gap-2 text-sm">{cats.map(([k, v]) => <li key={k}><div className="flex justify-between"><span>{Q_CATEGORY[k] ?? k}</span><b>{v}</b></div><div className="h-1.5 rounded bg-[#EEF2F6] mt-1"><div className="h-1.5 rounded bg-bad" style={{ width: `${(v / maxCat) * 100}%` }} /></div></li>)}</ul>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
