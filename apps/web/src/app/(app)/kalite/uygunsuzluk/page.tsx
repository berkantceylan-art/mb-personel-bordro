import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { NCR_SOURCE, NCR_STATUS } from "@/lib/quality";
import { addAction, openNcr, saveNcr, toggleAction } from "@/lib/quality-actions";
import { QNav } from "../QNav";

export const dynamic = "force-dynamic";

type N = { id: string; no: number; source: string; complaint_id: string | null; title: string; description: string | null; lot_no: string | null; immediate_action: string | null; root_cause: string | null; status: string; effective: boolean | null; created_at: string; closed_at: string | null; stk_items: { name: string } | null };
type A = { id: string; ncr_id: string; kind: string; description: string; owner_id: string | null; due_date: string | null; done_at: string | null; done_note: string | null };

/** Uygunsuzluk ve düzeltici / önleyici faaliyet (DÖF) */
export default async function NcrPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const canEdit = (s.modules.production ?? 0) >= 2 || (s.modules.lab ?? 0) >= 2;
  const supabase = await createClient();
  const [{ data }, { data: ad }, { data: ud }] = await Promise.all([
    supabase.from("qms_ncrs").select("*, stk_items(name)").order("created_at", { ascending: false }).limit(200),
    supabase.from("qms_actions").select("*").order("due_date", { nullsFirst: false }),
    supabase.rpc("users_overview"),
  ]);
  const ncrs = (data ?? []) as unknown as N[];
  const acts = (ad ?? []) as A[];
  const users = ((ud ?? []) as { user_id: string; display_name: string; role: string }[]).filter((u) => u.role !== "portal");
  const uname = new Map(users.map((u) => [u.user_id, u.display_name]));
  const sel = ncrs.find((n) => n.id === sp.id) ?? null;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm w-full";
  const ta = "rounded-[10px] border border-line bg-white p-3 text-sm w-full";

  return (
    <>
      <PageHeader title="Uygunsuzluk ve DÖF" subtitle="Uygunsuzluk kaydı, anlık önlem, kök neden; düzeltici ve önleyici faaliyetler sorumlu ve terminle" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        <QNav at="/kalite/uygunsuzluk" />
        {sel && (
          <Card title={`Uygunsuzluk #${sel.no} · ${NCR_SOURCE[sel.source]}`} action={<span className="flex gap-3 text-sm">{sel.complaint_id && <Link href={`/kalite?sikayet=${sel.complaint_id}`} className="font-semibold text-brand-700">Şikâyet</Link>}<Link href="/kalite/uygunsuzluk" className="font-semibold text-brand-700">Kapat</Link></span>}>
            <form action={saveNcr} className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="id" value={sel.id} />
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Başlık<input name="title" defaultValue={sel.title} maxLength={200} className={inp} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Durum<select name="status" defaultValue={sel.status} className={inp}>{Object.entries(NCR_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Tanım<textarea name="description" rows={3} defaultValue={sel.description ?? ""} maxLength={2000} className={ta} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1">Anlık önlem (düzeltme)<textarea name="immediate_action" rows={3} defaultValue={sel.immediate_action ?? ""} maxLength={1000} className={ta} /></label>
              <label className="text-xs font-semibold text-muted flex flex-col gap-1 md:col-span-2">Kök neden analizi (5 neden / balık kılçığı)<textarea name="root_cause" rows={3} defaultValue={sel.root_cause ?? ""} maxLength={2000} className={ta} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" name="effective" defaultChecked={sel.effective === true} /> Faaliyetler etkili oldu (kapanışta)</label>
              {canEdit && <div><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit></div>}
            </form>
            <h3 className="font-semibold mt-2">Faaliyetler</h3>
            <ul className="divide-y divide-[#EEF2F6]">
              {acts.filter((a) => a.ncr_id === sel.id).map((a) => (
                <li key={a.id} className="py-2 flex flex-wrap gap-3 items-center text-sm">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${a.kind === "corrective" ? "bg-[#EAF2FB] text-brand-700" : "bg-[#F3E8FF] text-[#7C3AED]"}`}>{a.kind === "corrective" ? "Düzeltici" : "Önleyici"}</span>
                  <span className="flex-1 min-w-[200px]">{a.description}{a.done_note && <span className="block text-xs text-muted">{a.done_note}</span>}</span>
                  <span className="text-xs text-muted">{a.owner_id ? uname.get(a.owner_id) : "—"}</span>
                  <span className={`text-xs ${!a.done_at && a.due_date && a.due_date < today ? "text-bad font-semibold" : "text-muted"}`}>{a.due_date ? formatDate(a.due_date) : ""}</span>
                  {canEdit && <form action={toggleAction} className="flex gap-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="done" value={a.done_at ? "0" : "1"} />{!a.done_at && <input name="done_note" placeholder="Yapılan" className="h-8 w-40 rounded-[8px] border border-line px-2 text-xs" />}<PendingSubmit className={`h-8 px-2 rounded-[8px] text-xs font-semibold ${a.done_at ? "border border-line" : "bg-ok text-white"}`}>{a.done_at ? "Geri al" : "Tamamlandı"}</PendingSubmit></form>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form action={addAction} className="flex flex-wrap gap-2 items-end">
                <input type="hidden" name="ncr_id" value={sel.id} />
                <select name="kind" className="h-10 rounded-[10px] border border-line px-2 text-sm"><option value="corrective">Düzeltici</option><option value="preventive">Önleyici</option></select>
                <input name="description" required maxLength={1000} placeholder="Faaliyet" className="h-10 flex-1 min-w-[240px] rounded-[10px] border border-line px-3 text-sm" />
                <select name="owner_id" className="h-10 rounded-[10px] border border-line px-2 text-sm"><option value="">Sorumlu</option>{users.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select>
                <input type="date" name="due_date" className="h-10 rounded-[10px] border border-line px-2 text-sm" />
                <PendingSubmit className="h-10 px-3 rounded-[10px] border border-line text-sm font-semibold">Ekle</PendingSubmit>
              </form>
            )}
          </Card>
        )}
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead><tr className="text-left text-xs text-muted"><th className="p-3">No</th><th className="p-3">Tarih</th><th className="p-3">Kaynak</th><th className="p-3">Başlık</th><th className="p-3">Faaliyet</th><th className="p-3">Durum</th></tr></thead>
              <tbody>
                {ncrs.map((n) => {
                  const a = acts.filter((x) => x.ncr_id === n.id);
                  const late = a.filter((x) => !x.done_at && x.due_date && x.due_date < today).length;
                  return (
                    <tr key={n.id} className="border-t border-[#EEF2F6]">
                      <td className="p-3"><Link href={`/kalite/uygunsuzluk?id=${n.id}`} className="font-semibold text-brand-700">#{n.no}</Link></td>
                      <td className="p-3 whitespace-nowrap">{formatDate(n.created_at.slice(0, 10))}</td>
                      <td className="p-3">{NCR_SOURCE[n.source]}</td>
                      <td className="p-3">{n.title}{n.lot_no && <span className="block text-xs text-muted">{n.stk_items?.name} lot {n.lot_no}</span>}</td>
                      <td className="p-3 text-xs">{a.filter((x) => x.done_at).length}/{a.length}{late ? <b className="text-bad"> · {late} gecikmiş</b> : null}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${NCR_STATUS[n.status]?.[1]}`}>{NCR_STATUS[n.status]?.[0]}</span></td>
                    </tr>
                  );
                })}
                {ncrs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Uygunsuzluk kaydı yok.</td></tr>}
              </tbody>
            </table>
          </section>
          {canEdit && (
            <Card title="Yeni uygunsuzluk">
              <form action={openNcr} className="flex flex-col gap-2">
                <select name="source" className={inp}>{Object.entries(NCR_SOURCE).filter(([k]) => k !== "complaint").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name="title" required maxLength={200} placeholder="Başlık" className={inp} />
                <textarea name="description" rows={3} maxLength={2000} placeholder="Ne tespit edildi?" className={ta} />
                <input name="lot_no" maxLength={60} placeholder="Lot no (varsa)" className={inp} />
                <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Aç</PendingSubmit>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
