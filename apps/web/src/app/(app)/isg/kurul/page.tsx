import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { COMMITTEE_MONTHS, COMMITTEE_ROLE, repsNeeded } from "@/lib/isg";
import { addCommitteeMember, closeDecision, deleteRow, saveMeeting } from "@/lib/isg-actions";
import { isgBase } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
type Dec = { text: string; responsible?: string; due?: string | null; status: string; closed_on?: string };
const DEFAULT_AGENDA = "Önceki toplantı kararlarının takibi\nİş kazası, ramak kala ve meslek hastalıkları\nRisk değerlendirmesi önlemlerinin durumu\nEğitim ve sağlık gözetimi\nTespit ve öneriler\nDilek ve öneriler";

/** İSG kurulu (50+ çalışan, 6 aydan uzun süren işler) ve çalışan temsilcileri */
export default async function CommitteePage() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const today = todayIso();
  const base = await isgBase(supabase);
  const [{ data: members, error }, { data: meetings }, { data: emps }] = await Promise.all([
    supabase.from("committee_members").select("*").is("until", null).order("role"),
    supabase.from("committee_meetings").select("*").order("held_on", { ascending: false }),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
  ]);
  if (error) return (<><PageHeader title="İSG kurulu" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const who = (m: { employee_id: string | null; full_name: string | null }) => (m.employee_id ? name.get(m.employee_id) : m.full_name) ?? "—";
  const required = base.workers >= 50;
  const period = COMMITTEE_MONTHS[base.hazard];
  const last = (meetings ?? [])[0];
  const nextDue = last ? new Date(new Date(last.held_on + "T12:00:00Z").setUTCMonth(new Date(last.held_on + "T12:00:00Z").getUTCMonth() + period)).toISOString().slice(0, 10) : today;
  const reps = (members ?? []).filter((m) => m.role === "temsilci" || m.role === "bas-temsilci").length;
  const repNeed = repsNeeded(base.workers);
  const openDec = (meetings ?? []).flatMap((m) => ((m.decisions as Dec[]) ?? []).map((d, i) => ({ ...d, i, meeting: m }))).filter((d) => d.status !== "kapandi");
  const roles = new Set((members ?? []).map((m) => m.role));
  const missingRoles = ["baskan", "sekreter", "hekim", "ik", "bas-temsilci"].filter((r) => !roles.has(r));
  return (
    <>
      <PageHeader title="İSG kurulu" subtitle={`${base.workers} çalışan · ${required ? `kurul zorunlu, ${period === 1 ? "ayda bir" : `${period} ayda bir`} toplanır` : "50 çalışanın altında kurul zorunlu değil"}`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/kurul" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Son toplantı" value={last ? formatDate(last.held_on) : "Yok"} sub={last ? `${last.meeting_no}. toplantı` : undefined} />
          <Stat label="Sonraki toplantı" value={formatDate(nextDue)} sub={nextDue < today ? "gecikti" : `${period} ayda bir`} />
          <Stat label="Çalışan temsilcisi" value={`${reps} / ${repNeed}`} sub="6331 md. 20" />
          <Stat label="Açık kararlar" value={String(openDec.length)} />
        </div>
        {(nextDue < today && required) || missingRoles.length > 0 || reps < repNeed ? <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm flex flex-col gap-1">
          {nextDue < today && required && <p>⚠ Kurul toplantısı gecikti (son: {last ? formatDate(last.held_on) : "yok"}).</p>}
          {missingRoles.length > 0 && <p>⚠ Kurulda eksik üye: {missingRoles.map((r) => COMMITTEE_ROLE[r]).join(", ")}.</p>}
          {reps < repNeed && <p>⚠ {base.workers} çalışan için {repNeed} çalışan temsilcisi gerekir; {reps} kayıtlı.</p>}
        </div> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Kurul üyeleri ve temsilciler">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(members ?? []).map((m) => <li key={m.id} className="py-1.5 flex justify-between gap-2"><span><b>{who(m)}</b> <span className="text-muted">· {COMMITTEE_ROLE[m.role]}</span></span>{can && <form action={deleteRow}><input type="hidden" name="table" value="committee_members" /><input type="hidden" name="id" value={m.id} /><ConfirmSubmit label="Çıkar" /></form>}</li>)}</ul>
            {can && <form action={addCommitteeMember} className="grid gap-2 grid-cols-2 text-sm">
              <select name="role" required className={input} aria-label="Görev">{Object.entries(COMMITTEE_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select name="employee_id" className={input} aria-label="Personel"><option value="">Personel (veya dışarıdan)</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
              <input name="full_name" placeholder="Dışarıdan ise ad soyad (uzman, hekim)" className={`${input} col-span-2`} aria-label="Ad soyad" />
              <PendingSubmit className={`${btn} justify-self-start`}>Ekle</PendingSubmit>
            </form>}
          </Card>
          <Card title="Açık kararlar">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{openDec.map((d) => <li key={`${d.meeting.id}-${d.i}`} className="py-1.5 flex flex-wrap justify-between gap-2"><span className="flex-1 min-w-40">{d.text}<span className="block text-xs text-muted">{d.meeting.meeting_no}. toplantı{d.responsible ? ` · ${d.responsible}` : ""}{d.due ? <> · <span className={d.due < today ? "text-bad font-semibold" : ""}>termin {formatDate(d.due)}</span></> : null}</span></span>{can && <form action={closeDecision}><input type="hidden" name="id" value={d.meeting.id} /><input type="hidden" name="i" value={d.i} /><PendingSubmit className="text-xs text-brand-700 font-semibold">Tamamlandı</PendingSubmit></form>}</li>)}{openDec.length === 0 && <li className="py-2 text-muted">Açık karar yok.</li>}</ul>
          </Card>
        </div>
        {can && (
          <Card title="Toplantı kaydı">
            <form action={saveMeeting} className="grid gap-2 md:grid-cols-2 text-sm">
              <label className="text-xs text-muted flex flex-col gap-1">Tarih<input type="date" name="held_on" required defaultValue={today} className={input} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">İmzalı tutanak (isteğe bağlı)<input type="file" name="file" accept="application/pdf,image/*" className="text-sm" /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Gündem (her satıra bir madde)<textarea name="agenda" rows={6} defaultValue={DEFAULT_AGENDA} className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Kararlar (her satır: karar | sorumlu | termin YYYY-AA-GG)<textarea name="decisions" rows={6} placeholder={"Tesviye tezgâhlarına HEPA filtreli lokal egzoz takılacak | Satın alma | 2026-11-30"} className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-sm" /></label>
              <fieldset className="md:col-span-2 flex flex-wrap gap-x-4 gap-y-1 border border-line rounded-lg p-2"><legend className="px-1 text-xs text-muted">Katılanlar</legend>{(members ?? []).map((m) => <label key={m.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="attendees" value={`${who(m)} (${COMMITTEE_ROLE[m.role]})`} defaultChecked className="w-4 h-4" />{who(m)}</label>)}</fieldset>
              <textarea name="notes" rows={3} placeholder="Görüşmeler" className="md:col-span-2 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-sm" aria-label="Görüşmeler" />
              <PendingSubmit className={`${btn} justify-self-start`}>Kaydet</PendingSubmit>
            </form>
          </Card>
        )}
        <Card title="Toplantılar">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(meetings ?? []).map((m) => <li key={m.id} className="py-1.5 flex flex-wrap justify-between gap-2"><span><b>{m.meeting_no}. toplantı</b> · {formatDate(m.held_on)} · {(m.decisions as Dec[]).length} karar</span><a href={`/yazdir/isg?tur=kurul&id=${m.id}`} target="_blank" rel="noopener" className="text-brand-700 font-semibold text-xs">Tutanak yazdır</a></li>)}{(meetings ?? []).length === 0 && <li className="py-2 text-muted">Toplantı kaydı yok.</li>}</ul>
        </Card>
      </div>
    </>
  );
}
