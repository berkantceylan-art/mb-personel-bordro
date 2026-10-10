import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { SGK_ISVEREN_URL } from "@/lib/isg";
import { saveIncident, updateIncident } from "@/lib/isg-actions";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const KIND: Record<string, string> = { KAZA: "İş kazası", RAMAK_KALA: "Ramak kala", MESLEK_HASTALIGI: "Meslek hastalığı" };
/** 3 iş günü (pazar ve resmi tatil hariç) sonrası */
function sgkDue(iso: string, hol: Set<string>) {
  let d = new Date(iso.slice(0, 10) + "T12:00:00Z"), n = 3;
  while (n > 0) { d = new Date(d.getTime() + 86_400_000); const s = d.toISOString().slice(0, 10); if (d.getUTCDay() !== 0 && !hol.has(s)) n--; }
  return d.toISOString().slice(0, 10);
}

/** İş kazası, meslek hastalığı ve ramak kala: SGK 3 iş günü, kök neden, kaza sıklık ve ağırlık oranları */
export default async function IncidentPage() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const today = todayIso();
  const year = today.slice(0, 4);
  const [{ data: list }, { data: emps }, { data: hols }] = await Promise.all([
    supabase.from("safety_incidents").select("*").order("occurred_at", { ascending: false }).limit(200),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    supabase.from("public_holidays").select("date").eq("half_day", false),
  ]);
  const hol = new Set((hols ?? []).map((h) => h.date as string));
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const thisYear = (list ?? []).filter((x) => String(x.occurred_at).startsWith(year));
  const accidents = thisYear.filter((x) => x.kind === "KAZA");
  const lost = accidents.reduce((a, x) => a + Number(x.lost_days ?? 0), 0);
  // Yaklaşık çalışma saati: aktif çalışan × 7,5 saat × yılın geçen iş günü
  const dayOfYear = Math.round((Date.parse(today) - Date.parse(`${year}-01-01`)) / 86_400_000);
  const hours = (emps ?? []).length * 7.5 * Math.round(dayOfYear * 6 / 7);
  const freq = hours ? (accidents.length * 1_000_000) / hours : 0;
  const sev = hours ? (lost * 1000) / hours : 0;
  const pending = (list ?? []).filter((x) => x.kind !== "RAMAK_KALA" && !x.sgk_notified_on);
  return (
    <>
      <PageHeader title="İş kazası ve meslek hastalığı" subtitle="SGK'ya bildirim: kazadan sonraki 3 iş günü içinde (5510 md. 13)" actions={<a href={SGK_ISVEREN_URL} target="_blank" rel="noopener" className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm grid place-items-center">SGK işveren uygulamaları ↗</a>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/kaza" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label={`${year} iş kazası`} value={String(accidents.length)} sub={`${thisYear.filter((x) => x.kind === "RAMAK_KALA").length} ramak kala`} />
          <Stat label="Kayıp iş günü" value={String(lost)} />
          <Stat label="Kaza sıklık oranı" value={freq.toFixed(1)} sub="1 milyon çalışma saatinde" />
          <Stat label="Kaza ağırlık oranı" value={sev.toFixed(2)} sub="1000 çalışma saatinde kayıp gün" />
        </div>
        {pending.length > 0 && <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm flex flex-col gap-1">{pending.map((x) => { const due = sgkDue(String(x.occurred_at), hol); return <p key={x.id}>⚠ {name.get(x.employee_id) ?? "—"} · {KIND[x.kind]} {formatDate(String(x.occurred_at).slice(0, 10))}: SGK bildirimi {due < today ? <b>süresi {formatDate(due)} tarihinde doldu</b> : <>son gün <b>{formatDate(due)}</b></>}.</p>; })}</div>}
        {can && (
          <Card title="Yeni kayıt">
            <form action={saveIncident} className="grid gap-2 md:grid-cols-3 text-sm">
              <select name="kind" className={input} aria-label="Tür"><option value="KAZA">İş kazası</option><option value="RAMAK_KALA">Ramak kala</option><option value="MESLEK_HASTALIGI">Meslek hastalığı</option></select>
              <input type="datetime-local" name="occurred_at" required className={input} aria-label="Tarih ve saat" />
              <select name="employee_id" className={input} aria-label="Personel"><option value="">Personel</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
              <input name="location" placeholder="Yer (bölüm, tezgâh)" className={input} aria-label="Yer" />
              <input name="body_part" placeholder="Yaralanan uzuv" className={input} aria-label="Uzuv" />
              <input name="injury_type" placeholder="Yaralanma türü (kesik, yanık…)" className={input} aria-label="Yaralanma" />
              <textarea name="description" required rows={2} placeholder="Kaza nasıl oldu?" className="md:col-span-3 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2" aria-label="Açıklama" />
              <input name="witnesses" placeholder="Tanıklar" className={input} aria-label="Tanıklar" />
              <input name="hospital" placeholder="Sevk edilen sağlık kuruluşu" className={input} aria-label="Hastane" />
              <input name="report_days" inputMode="numeric" placeholder="İstirahat (gün)" className={input} aria-label="İstirahat" />
              <input name="actions_taken" placeholder="İlk müdahale / alınan önlem" className={`${input} md:col-span-3`} aria-label="Müdahale" />
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold justify-self-start">Kaydet</PendingSubmit>
            </form>
          </Card>
        )}
        <div className="flex flex-col gap-2">{(list ?? []).map((x) => (
          <details key={x.id} className="rounded-xl border border-line bg-white">
            <summary className="cursor-pointer p-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${x.kind === "RAMAK_KALA" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"}`}>{KIND[x.kind]}</span>
              <b className="flex-1 min-w-40">{x.employee_id ? name.get(x.employee_id) : "—"}</b>
              <span className="num text-xs">{formatDate(String(x.occurred_at).slice(0, 10))}</span>
              <span className="text-xs">{x.kind === "RAMAK_KALA" ? "" : x.sgk_notified_on ? `SGK ${formatDate(x.sgk_notified_on)}` : <b className="text-bad">SGK bildirilmedi</b>}</span>
              <span className="text-xs text-muted">{x.status === "closed" ? "Kapalı" : "Açık"}</span>
            </summary>
            <div className="px-3 pb-3 text-sm flex flex-col gap-2">
              <p>{x.description}</p>
              <p className="text-xs text-muted">{[x.location, x.body_part, x.injury_type, x.hospital, x.witnesses ? `tanık: ${x.witnesses}` : null].filter(Boolean).join(" · ")}</p>
              <a href={`/yazdir/isg?tur=kaza&id=${x.id}`} target="_blank" rel="noopener" className="text-brand-700 font-semibold text-xs">Kaza raporu ve SGK bildirim özeti</a>
              {can && (
                <form action={updateIncident} className="grid gap-2 md:grid-cols-3">
                  <input type="hidden" name="id" value={x.id} />
                  <label className="text-xs text-muted flex flex-col gap-1">SGK bildirim tarihi<input type="date" name="sgk_notified_on" defaultValue={x.sgk_notified_on ?? ""} className={input} /></label>
                  <label className="text-xs text-muted flex flex-col gap-1">SGK referans no<input name="sgk_ref" defaultValue={x.sgk_ref ?? ""} className={input} /></label>
                  <label className="text-xs text-muted flex flex-col gap-1">İşe dönüş<input type="date" name="returned_on" defaultValue={x.returned_on ?? ""} className={input} /></label>
                  <label className="text-xs text-muted flex flex-col gap-1">Kayıp iş günü<input name="lost_days" defaultValue={x.lost_days ?? ""} inputMode="numeric" className={input} /></label>
                  <label className="text-xs text-muted flex flex-col gap-1 md:col-span-2">Kök neden<input name="root_cause" defaultValue={x.root_cause ?? ""} className={input} /></label>
                  <label className="text-xs text-muted flex flex-col gap-1 md:col-span-3">Düzeltici / önleyici faaliyet<input name="corrective_actions" defaultValue={x.corrective_actions ?? ""} className={input} /></label>
                  <div className="flex gap-2 md:col-span-3"><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-xs font-semibold">Kaydet</PendingSubmit>{x.status !== "closed" && <PendingSubmit name="close" value="1" className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] text-xs font-semibold">Kaydet ve kapat</PendingSubmit>}</div>
                </form>
              )}
            </div>
          </details>
        ))}{(list ?? []).length === 0 && <Card><p className="text-sm text-muted">Kayıt yok.</p></Card>}</div>
        <p className="text-xs text-muted">Kaza geçiren personele işe dönmeden önce ilave eğitim verilmelidir; Eğitim yükümlülükleri ekranında otomatik açılır. Sıklık ve ağırlık oranları aktif çalışan sayısından yaklaşık çalışma saatiyle hesaplanır.</p>
      </div>
    </>
  );
}
