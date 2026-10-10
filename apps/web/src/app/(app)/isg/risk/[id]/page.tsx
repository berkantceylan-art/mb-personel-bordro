import { notFound, redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader } from "@/components/ui";
import { level5x5, levelFK } from "@/lib/isg";
import { announceAssessment, deleteRow, saveRiskItem, setAssessmentStatus } from "@/lib/isg-actions";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm w-full";
type Item = { id: string; area: string; activity: string | null; hazard: string; risk: string; affected: string | null; p: number; s: number; f: number | null; existing_controls: string | null; actions: string | null; responsible: string | null; due_date: string | null; done_on: string | null; rp: number | null; rs: number | null; rf: number | null };

export default async function RiskDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const { id } = await params;
  const supabase = await createClient();
  const today = todayIso();
  const [{ data: a }, { data: items }] = await Promise.all([
    supabase.from("risk_assessments").select("*").eq("id", id).maybeSingle(),
    supabase.from("risk_items").select("*").eq("assessment_id", id).order("sort").order("area"),
  ]);
  if (!a) notFound();
  const fk = a.method === "fine-kinney";
  const score = (p: number, sv: number, f: number | null) => (fk ? p * sv * (f ?? 1) : p * sv);
  const lvl = (x: number) => (fk ? levelFK(x) : level5x5(x));
  const I = (items ?? []) as Item[];
  const sorted = [...I].sort((x, y) => score(Number(y.p), Number(y.s), y.f) - score(Number(x.p), Number(x.s), x.f));
  const Fields = ({ it }: { it?: Item }) => (
    <>
      <input type="hidden" name="assessment_id" value={id} />{it && <input type="hidden" name="id" value={it.id} />}
      <input name="area" defaultValue={it?.area} placeholder="Bölüm / alan" className={input} aria-label="Alan" />
      <input name="activity" defaultValue={it?.activity ?? ""} placeholder="Faaliyet" className={input} aria-label="Faaliyet" />
      <input name="hazard" required defaultValue={it?.hazard} placeholder="Tehlike" className={input} aria-label="Tehlike" />
      <input name="risk" required defaultValue={it?.risk} placeholder="Risk" className={input} aria-label="Risk" />
      <input name="affected" defaultValue={it?.affected ?? ""} placeholder="Etkilenenler" className={input} aria-label="Etkilenenler" />
      <div className="grid grid-cols-3 gap-1"><input name="p" required defaultValue={it?.p} placeholder="Olasılık" className={input} aria-label="Olasılık" /><input name="s" required defaultValue={it?.s} placeholder="Şiddet" className={input} aria-label="Şiddet" />{fk ? <input name="f" defaultValue={it?.f ?? ""} placeholder="Frekans" className={input} aria-label="Frekans" /> : <span />}</div>
      <input name="existing_controls" defaultValue={it?.existing_controls ?? ""} placeholder="Mevcut önlemler" className={input} aria-label="Mevcut önlemler" />
      <input name="actions" defaultValue={it?.actions ?? ""} placeholder="Alınacak önlemler (DÖF)" className={input} aria-label="Önlemler" />
      <input name="responsible" defaultValue={it?.responsible ?? ""} placeholder="Sorumlu" className={input} aria-label="Sorumlu" />
      <label className="text-xs text-muted flex flex-col">Termin<input type="date" name="due_date" defaultValue={it?.due_date ?? ""} className={input} /></label>
      <label className="text-xs text-muted flex flex-col">Tamamlandı<input type="date" name="done_on" defaultValue={it?.done_on ?? ""} className={input} /></label>
      <div className="grid grid-cols-3 gap-1"><input name="rp" defaultValue={it?.rp ?? ""} placeholder="Kalan O" className={input} aria-label="Kalan olasılık" /><input name="rs" defaultValue={it?.rs ?? ""} placeholder="Kalan Ş" className={input} aria-label="Kalan şiddet" />{fk ? <input name="rf" defaultValue={it?.rf ?? ""} placeholder="Kalan F" className={input} aria-label="Kalan frekans" /> : <span />}</div>
    </>
  );
  return (
    <>
      <PageHeader title={a.title} subtitle={`${formatDate(a.done_on)} · geçerlilik ${formatDate(a.valid_until)} · ${fk ? "Fine-Kinney" : "5×5 matris"}`}
        actions={<a href={`/yazdir/isg?tur=risk&id=${id}`} target="_blank" rel="noopener" className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm grid place-items-center">Raporu yazdır</a>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1280px]">
        <IsgNav active="/isg/risk" />
        <Card title="Durum">
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span>Ekip: {((a.team as Array<{ name: string; role: string }>) ?? []).map((t) => `${t.name}${t.role ? ` (${t.role})` : ""}`).join(", ") || "—"}</span>
            {can && a.status !== "yururlukte" && <form action={setAssessmentStatus}><input type="hidden" name="id" value={id} /><PendingSubmit name="status" value="yururlukte" className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Yürürlüğe al</PendingSubmit></form>}
            {can && a.status === "yururlukte" && <form action={announceAssessment}><input type="hidden" name="id" value={id} /><PendingSubmit className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-brand-700 text-xs font-semibold">{a.announced_at ? `Duyuruldu (${formatDate(String(a.announced_at).slice(0, 10))}) · tekrar duyur` : "Çalışanlara duyur (okundu onaylı)"}</PendingSubmit></form>}
          </div>
          <p className="text-xs text-muted">{fk ? "Fine-Kinney: olasılık (0,2–10) × frekans (0,5–10) × şiddet (1–100). 400 üzeri tolerans gösterilemez, 200–400 esaslı, 70–200 önemli." : "5×5: olasılık (1–5) × şiddet (1–5). 25 tolerans gösterilemez, 15–20 yüksek, 8–12 önemli, 3–6 kabul edilebilir."}</p>
        </Card>
        <div className="flex flex-col gap-2">{sorted.map((it) => {
          const sc = score(Number(it.p), Number(it.s), it.f);
          const [l, c] = lvl(sc);
          const rsc = it.rp && it.rs ? score(Number(it.rp), Number(it.rs), it.rf) : null;
          const late = !it.done_on && it.due_date && it.due_date < today;
          return (
            <details key={it.id} className="rounded-xl border border-line bg-white">
              <summary className="cursor-pointer p-3 flex flex-wrap items-center gap-3 text-sm">
                <span className={`num text-xs font-bold px-2 py-1 rounded ${c}`}>{sc} · {l}</span>
                <span className="flex-1 min-w-[220px]"><b>{it.hazard}</b> → {it.risk}<span className="block text-xs text-muted">{it.area}{it.activity ? ` · ${it.activity}` : ""}</span></span>
                <span className="text-xs">{it.done_on ? <span className="text-ok font-semibold">Önlem alındı {formatDate(it.done_on)}</span> : it.due_date ? <span className={late ? "text-bad font-semibold" : ""}>Termin {formatDate(it.due_date)}{it.responsible ? ` · ${it.responsible}` : ""}</span> : <span className="text-muted">termin yok</span>}</span>
                {rsc !== null && <span className={`num text-xs px-2 py-1 rounded ${lvl(rsc)[1]}`}>kalan {rsc}</span>}
              </summary>
              <div className="px-3 pb-3 text-sm flex flex-col gap-2">
                <p><b>Mevcut:</b> {it.existing_controls ?? "—"} · <b>Önlem:</b> {it.actions ?? "—"}</p>
                {can && <form action={saveRiskItem} className="grid gap-1.5 md:grid-cols-4"><Fields it={it} /><PendingSubmit className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Kaydet</PendingSubmit></form>}
                {can && <form action={deleteRow}><input type="hidden" name="table" value="risk_items" /><input type="hidden" name="id" value={it.id} /><ConfirmSubmit label="Satırı sil" /></form>}
              </div>
            </details>
          );
        })}</div>
        {can && <Card title="Risk ekle"><form action={saveRiskItem} className="grid gap-1.5 md:grid-cols-4"><Fields /><PendingSubmit className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Ekle</PendingSubmit></form></Card>}
      </div>
    </>
  );
}
