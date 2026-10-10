import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { HAZARD_LABEL } from "@/lib/compliance";
import { FIRST_AID_PER, SUPPORT_PER, TEAM_LABEL, firstAidNeeded, supportNeeded } from "@/lib/isg";
import { addDrill, addTeamMember, deleteRow, saveEmergencyPlan } from "@/lib/isg-actions";
import { isgBase, signedMap } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";

/** Acil durum planı, tatbikatlar, destek elemanları (Acil Durumlar Yönetmeliği) ve ilkyardımcılar (İlkyardım Yönetmeliği) */
export default async function EmergencyPage() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const today = todayIso();
  const base = await isgBase(supabase);
  const [{ data: plans, error }, { data: drills }, { data: team }, { data: emps }] = await Promise.all([
    supabase.from("emergency_plans").select("*").order("done_on", { ascending: false }),
    supabase.from("emergency_drills").select("*").order("held_on", { ascending: false }),
    supabase.from("emergency_team").select("id, employee_id, team, trained_on, certificate_until"),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
  ]);
  if (error) return (<><PageHeader title="Acil durum" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const need = supportNeeded(base.hazard, base.workers);
  const aidNeed = firstAidNeeded(base.hazard, base.workers);
  const plan = (plans ?? [])[0];
  const lastDrill = (drills ?? [])[0];
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const docs = await signedMap(supabase, [...(plans ?? []).map((p) => p.document_path), ...(drills ?? []).map((d) => d.document_path)]);
  const validAid = (team ?? []).filter((t) => t.team === "ilkyardim" && (!t.certificate_until || t.certificate_until >= today));
  const alerts: string[] = [];
  if (!plan) alerts.push("Acil durum planı yok (Acil Durumlar Yönetmeliği md. 9).");
  else if (plan.valid_until < today) alerts.push(`Acil durum planının süresi ${formatDate(plan.valid_until)} tarihinde doldu.`);
  if (!lastDrill || lastDrill.held_on < yearAgo) alerts.push("Son 1 yılda tatbikat yapılmamış; yılda en az bir tatbikat zorunludur.");
  for (const k of ["sondurme", "kurtarma", "koruma"] as const) { const n = (team ?? []).filter((t) => t.team === k).length; if (n < need) alerts.push(`${TEAM_LABEL[k]}: ${n}/${need} kişi.`); }
  if (validAid.length < aidNeed) alerts.push(`Sertifikası geçerli ilkyardımcı ${validAid.length}/${aidNeed} kişi.`);
  for (const t of (team ?? []).filter((x) => x.certificate_until && x.certificate_until < today)) alerts.push(`${name.get(t.employee_id)} ilkyardım sertifikası ${formatDate(t.certificate_until!)} tarihinde doldu.`);
  return (
    <>
      <PageHeader title="Acil durum yönetimi" subtitle={`${HAZARD_LABEL[base.hazard]} · ${base.workers} çalışan`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/acil" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Acil durum planı" value={plan ? formatDate(plan.valid_until) : "Yok"} sub="geçerlilik" />
          <Stat label="Son tatbikat" value={lastDrill ? formatDate(lastDrill.held_on) : "Yok"} sub="yılda en az 1" />
          <Stat label="Destek elemanı (ekip başına)" value={`${need} kişi`} sub={`her ${SUPPORT_PER[base.hazard]} çalışana 1`} />
          <Stat label="İlkyardımcı" value={`${validAid.length} / ${aidNeed}`} sub={`her ${FIRST_AID_PER[base.hazard]} çalışana 1`} />
        </div>
        {alerts.length > 0 && <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm flex flex-col gap-1">{alerts.map((a, i) => <p key={i}>⚠ {a}</p>)}</div>}
        <Card title="Acil durum ekipleri">
          <div className="grid gap-3 md:grid-cols-2">{(["sondurme", "kurtarma", "koruma", "ilkyardim"] as const).map((k) => {
            const mem = (team ?? []).filter((t) => t.team === k);
            const target = k === "ilkyardim" ? aidNeed : need;
            return (
              <div key={k} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex justify-between"><b>{TEAM_LABEL[k]}</b><span className={mem.length >= target ? "text-ok font-semibold" : "text-bad font-semibold"}>{mem.length}/{target}</span></div>
                <ul className="mt-1 divide-y divide-[#EEF2F6]">{mem.map((m) => <li key={m.id} className="py-1 flex justify-between gap-2"><span>{name.get(m.employee_id)}</span><span className="text-xs text-muted flex gap-2 items-center">{m.certificate_until ? `sertifika ${formatDate(m.certificate_until)}` : m.trained_on ? `eğitim ${formatDate(m.trained_on)}` : ""}{can && <form action={deleteRow}><input type="hidden" name="table" value="emergency_team" /><input type="hidden" name="id" value={m.id} /><ConfirmSubmit label="×" /></form>}</span></li>)}</ul>
              </div>
            );
          })}</div>
          {can && (
            <form action={addTeamMember} className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-end text-sm">
              <select name="employee_id" required className={input} aria-label="Personel"><option value="">Personel</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
              <select name="team" className={input} aria-label="Ekip">{Object.entries(TEAM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="text-xs text-muted flex flex-col gap-1">Eğitim tarihi<input type="date" name="trained_on" className={input} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Sertifika bitişi<input type="date" name="certificate_until" className={input} /></label>
              <PendingSubmit className={btn}>Ekle</PendingSubmit>
            </form>
          )}
          <p className="text-xs text-muted">Destek elemanları görevleriyle ilgili eğitim almalı; ilkyardımcı sertifikası 3 yıl geçerlidir. Personel telefonunda hangi ekipte olduğunu görür.</p>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Acil durum planı">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(plans ?? []).map((p) => <li key={p.id} className="py-1.5 flex justify-between gap-2"><span>{p.title} · {formatDate(p.done_on)} <span className="text-xs text-muted">(geçerli {formatDate(p.valid_until)})</span></span>{p.document_path && docs.get(p.document_path) && <a href={docs.get(p.document_path)} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold text-xs">Dosya</a>}</li>)}</ul>
            {can && <form action={saveEmergencyPlan} className="grid gap-2 grid-cols-2 text-sm"><input name="title" placeholder="Başlık" className={`${input} col-span-2`} aria-label="Başlık" /><input type="date" name="done_on" required defaultValue={today} className={input} aria-label="Tarih" /><input type="file" name="file" accept="application/pdf,image/*" className="text-sm" aria-label="Dosya" /><PendingSubmit className={`${btn} col-span-2 justify-self-start`}>Kaydet</PendingSubmit></form>}
          </Card>
          <Card title="Tatbikatlar">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(drills ?? []).map((d) => <li key={d.id} className="py-1.5"><div className="flex justify-between gap-2"><b>{d.scenario}</b><span className="num text-xs">{formatDate(d.held_on)}</span></div><div className="text-xs text-muted">{d.participants ? `${d.participants} kişi` : ""}{d.duration_min ? ` · ${d.duration_min} dk` : ""}{d.findings ? ` · ${d.findings}` : ""}{d.document_path && docs.get(d.document_path) ? <> · <a href={docs.get(d.document_path)} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold">rapor</a></> : null}</div></li>)}</ul>
            {can && <form action={addDrill} className="grid gap-2 grid-cols-2 text-sm"><input type="date" name="held_on" required defaultValue={today} className={input} aria-label="Tarih" /><select name="scenario" className={input} aria-label="Senaryo"><option>Yangın ve tahliye</option><option>Deprem</option><option>Kimyasal döküntü</option><option>İlkyardım / kalp durması</option><option>Elektrik kesintisi</option></select><input name="participants" inputMode="numeric" placeholder="Katılımcı" className={input} aria-label="Katılımcı" /><input name="duration_min" inputMode="numeric" placeholder="Tahliye süresi (dk)" className={input} aria-label="Süre" /><input name="findings" placeholder="Gözlemler / aksaklıklar" className={`${input} col-span-2`} aria-label="Bulgular" /><input type="file" name="file" accept="application/pdf,image/*" className="text-sm col-span-2" aria-label="Rapor" /><PendingSubmit className={`${btn} col-span-2 justify-self-start`}>Kaydet</PendingSubmit></form>}
          </Card>
        </div>
      </div>
    </>
  );
}
