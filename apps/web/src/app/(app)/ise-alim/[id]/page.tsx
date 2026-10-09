import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { CRITERIA, SOURCE_LABEL, STAGES, STAGE_LABEL, formatPhone, nextStage, publicBaseUrl, whatsappLink } from "@/lib/recruiting";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addNote, eraseCandidate, hireCandidate, moveStage, saveScores, scheduleInterview } from "../actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const hr = s.role !== "branch_manager";
  const { id } = await params;
  const supabase = await createClient();
  const { data: c } = await supabase.from("candidates").select("*, job_postings(title, department_id), referrer:employees!candidates_referrer_employee_id_fkey(first_name, last_name)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: events }, { data: scores }, { data: branches }, { data: depts }] = await Promise.all([
    supabase.from("candidate_events").select("kind, from_stage, to_stage, body, created_at").eq("candidate_id", id).order("created_at", { ascending: false }),
    supabase.from("candidate_scores").select("criterion, score, note, scored_by").eq("candidate_id", id),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  const files = [c.cv_path, ...(c.file_paths ?? [])].filter(Boolean) as string[];
  const { data: urls } = files.length ? await supabase.storage.from("documents").createSignedUrls(files, 600) : { data: [] };
  const mine = new Map((scores ?? []).filter((x) => x.scored_by === s.userId).map((x) => [x.criterion, x]));
  const avg = (k: string) => { const xs = (scores ?? []).filter((x) => x.criterion === k); return xs.length ? xs.reduce((a, x) => a + x.score, 0) / xs.length : null; };
  const scorers = new Set((scores ?? []).map((x) => x.scored_by)).size;
  const post = c.job_postings as { title: string; department_id: string | null } | null;
  const ref = c.referrer as { first_name: string; last_name: string } | null;
  const nxt = nextStage(c.stage);
  const closed = c.stage === "rejected" || c.stage === "withdrawn";
  const statusUrl = `${publicBaseUrl()}/basvuru/${c.access_token}`;
  const inviteText = c.interview_at
    ? `Merhaba ${c.first_name}, ${s.companyName} ${post?.title ?? ""} başvurunuz için sizi ${dt(c.interview_at)} tarihinde${c.interview_place ? ` ${c.interview_place} adresinde` : ""} mülakata davet ediyoruz. Katılımınızı buradan onaylayabilirsiniz: ${statusUrl}`
    : `Merhaba ${c.first_name}, ${s.companyName} başvurunuz bize ulaştı. Başvurunuzun durumunu buradan takip edebilirsiniz: ${statusUrl}`;
  const info: Array<[string, string | null]> = [
    ["Telefon", formatPhone(c.phone)], ["E-posta", c.email], ["Doğum tarihi", c.birth_date ? formatDate(c.birth_date) : null], ["İlçe", c.district],
    ["Askerlik", c.military], ["Başlayabilir", c.start_when], ["Öğrenim", c.education], ["Deneyim", c.experience], ["Son iş yeri", c.last_employer],
    ["Beklenen ücret", c.expected_wage ? formatTL(Number(c.expected_wage)) : null], ["Kaynak", `${SOURCE_LABEL[c.source] ?? c.source}${c.heard_from ? ` · ${c.heard_from}` : ""}`],
    ["Öneren", ref ? `${ref.first_name} ${ref.last_name} (çalışan)` : c.referrer_name], ["KVKK onayı", c.kvkk_consent_at ? dt(c.kvkk_consent_at) : "yok"],
    ["Veri silinme tarihi", formatDate(c.purge_after)],
  ];

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name === "-" ? "" : c.last_name}`} subtitle={`${c.tracking_code} · ${post?.title ?? "Genel başvuru"} · ${STAGE_LABEL[c.stage]}`} actions={<Link href="/ise-alim" className="text-sm font-semibold text-brand-700">← Pano</Link>} />
      <div className="p-4 md:p-6 grid gap-4 lg:grid-cols-[1.3fr_1fr] items-start">
        <div className="flex flex-col gap-4">
          <Card title="Aşama">
            <ol className="flex flex-wrap gap-1.5" aria-label="Aşamalar">
              {STAGES.map(([k, l], i) => {
                const idx = STAGES.findIndex(([x]) => x === c.stage);
                return <li key={k} className={`text-xs font-semibold rounded-full px-2.5 py-1 ${closed ? "bg-[#EEF2F6] text-muted" : i < idx ? "bg-[#E6F4EC] text-ok" : i === idx ? "bg-brand-700 text-white" : "bg-[#EEF2F6] text-muted"}`}>{l}</li>;
              })}
              {closed && <li className="text-xs font-semibold rounded-full px-2.5 py-1 bg-[#FDECEA] text-bad">{STAGE_LABEL[c.stage]}</li>}
            </ol>
            {c.employee_id ? (
              <p className="text-sm">İşe alındı → <Link href={`/personel/${c.employee_id}`} className="font-semibold text-brand-700">personel kartı</Link></p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {nxt && nxt !== "hired" && <form action={moveStage}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="stage" value={nxt} /><PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">{STAGE_LABEL[nxt]} aşamasına al</PendingSubmit></form>}
                <form action={moveStage} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <select name="stage" defaultValue="" className={input} aria-label="Aşamaya taşı"><option value="" disabled>Aşamaya taşı…</option>{STAGES.filter(([k]) => k !== "hired" && k !== c.stage).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="withdrawn">Aday çekildi</option></select>
                  <PendingSubmit className="h-11 px-3 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-sm text-brand-700">Taşı</PendingSubmit>
                </form>
                {!closed && (
                  <form action={moveStage} className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="stage" value="rejected" />
                    <input name="reason" placeholder="Ret nedeni (adaya gösterilmez)" className={`${input} w-56`} />
                    <PendingSubmit className="h-11 px-3 rounded-[10px] border border-[#E3B4AE] bg-white font-semibold text-sm text-bad">Reddet</PendingSubmit>
                  </form>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-sm">
              <a href={whatsappLink(c.phone, inviteText)} target="_blank" rel="noopener" className="h-10 px-3 inline-flex items-center rounded-[10px] bg-[#1A7F52] text-white font-semibold">WhatsApp ile yaz</a>
              <a href={`tel:${c.phone}`} className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Ara</a>
              <a href={`/basvuru/${c.access_token}`} target="_blank" rel="noopener" className="h-10 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Adayın gördüğü sayfa ↗</a>
            </div>
          </Card>

          <Card title="Mülakat">
            {c.interview_at && <p className="text-sm">Planlanan: <b>{dt(c.interview_at)}</b>{c.interview_place ? ` · ${c.interview_place}` : ""} · {c.candidate_reply === "confirmed" ? <span className="text-ok font-semibold">aday onayladı ✓</span> : c.candidate_reply === "reschedule" ? <span className="text-bad font-semibold">aday başka gün istiyor</span> : "aday yanıtı bekleniyor"}</p>}
            <form action={scheduleInterview} className="flex flex-wrap gap-2 items-end text-sm">
              <input type="hidden" name="id" value={c.id} />
              <label className="flex flex-col gap-1 text-muted">Tarih ve saat<input type="datetime-local" name="at" required className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Yer<input name="place" placeholder="Laboratuvar, Karabağlar" className={input} /></label>
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">{c.interview_at ? "Yeniden planla" : "Planla"}</PendingSubmit>
            </form>
            <p className="text-xs text-muted">Planladıktan sonra &quot;WhatsApp ile yaz&quot; davet mesajını ve adayın onay bağlantısını hazır getirir.</p>
          </Card>

          <Card title={`Mülakat puan kartı${scorers ? ` · ${scorers} değerlendiren · ortalama ${Number(c.score ?? 0).toLocaleString("tr-TR")}` : ""}`}>
            <form action={saveScores} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={c.id} />
              {CRITERIA.map(([k, l]) => {
                const a = avg(k);
                return (
                  <fieldset key={k} className="grid gap-2 sm:grid-cols-[150px_auto_1fr] items-center border-b border-[#EEF2F6] pb-2">
                    <legend className="sr-only">{l}</legend>
                    <span className="text-sm font-semibold">{l}{a !== null && <span className="block text-xs font-normal text-muted">ort. {a.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</span>}</span>
                    <span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="cursor-pointer"><input type="radio" name={k} value={n} defaultChecked={mine.get(k)?.score === n} className="peer sr-only" /><span className="w-10 h-10 rounded-lg border border-[#D5DEE8] grid place-items-center text-sm font-semibold peer-checked:bg-brand-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600">{n}</span></label>
                    ))}</span>
                    <input name={`${k}_note`} defaultValue={mine.get(k)?.note ?? ""} placeholder="Not" className={`${input} h-10`} />
                  </fieldset>
                );
              })}
              <PendingSubmit className="self-start h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Puanlarımı kaydet</PendingSubmit>
            </form>
          </Card>

          <Card title="Notlar ve geçmiş">
            <form action={addNote} className="flex gap-2"><input type="hidden" name="id" value={c.id} /><input name="body" placeholder="Not ekle (deneme günü gözlemi, referans görüşmesi…)" className={`${input} flex-1`} /><PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Ekle</PendingSubmit></form>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {(events ?? []).map((e, i) => (
                <li key={i} className="py-2 flex gap-3"><span className="text-xs text-muted w-32 shrink-0">{dt(e.created_at)}</span><span>{e.kind === "stage" ? <>Aşama: <b>{STAGE_LABEL[e.from_stage ?? ""] ?? e.from_stage} → {STAGE_LABEL[e.to_stage ?? ""] ?? e.to_stage}</b>{e.body ? ` · ${e.body}` : ""}</> : e.body}</span></li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Aday bilgileri">
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {info.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="font-medium break-words">{v}</dd></div>)}
            </dl>
            {(c.skills ?? []).length > 0 && <div className="flex flex-wrap gap-1.5">{(c.skills as string[]).map((x) => <span key={x} className="text-xs bg-[#EEF3F9] rounded-full px-2.5 py-1">{x}</span>)}</div>}
            {c.about && <p className="text-sm whitespace-pre-line bg-[#F5F7FA] rounded-lg p-3">{c.about}</p>}
          </Card>
          <Card title="Dosyalar">
            {files.length === 0 && <p className="text-sm text-muted">Dosya yüklenmemiş.</p>}
            <ul className="text-sm">{(urls ?? []).map((u, i) => <li key={i} className="py-1"><a href={u.signedUrl ?? "#"} target="_blank" rel="noopener" className="font-semibold text-brand-700">{files[i]!.includes("/ozgecmis.") ? "Özgeçmiş" : `İş örneği ${i}`} ↗</a></li>)}</ul>
          </Card>
          {hr && !c.employee_id && !closed && (
            <Card title="İşe al">
              <form action={hireCandidate} className="flex flex-col gap-2 text-sm">
                <input type="hidden" name="id" value={c.id} />
                <label className="flex flex-col gap-1 text-muted">İşe başlama tarihi<input type="date" name="hire_date" defaultValue={todayIso()} required className={input} /></label>
                <label className="flex flex-col gap-1 text-muted">Şube<select name="branch_id" required className={input}>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="flex flex-col gap-1 text-muted">Bölüm<select name="department_id" defaultValue={post?.department_id ?? ""} className={input}><option value="">Seçiniz</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <ConfirmSubmit label="Personel kaydını aç" question={`${c.first_name} için personel kaydı açılsın mı?`} yes="Evet, aç" className="h-11 px-4 rounded-[10px] bg-[#1A7F52] text-white font-semibold" />
                <p className="text-xs text-muted">Ad, telefon, e-posta, doğum tarihi ve özgeçmiş personel dosyasına aktarılır; uyum (ilk gün) kontrol listesi başlar.</p>
              </form>
            </Card>
          )}
          {hr && (
            <Card title="KVKK">
              <p className="text-xs text-muted">Aday verisi {formatDate(c.purge_after)} tarihinde otomatik silinir. Aday silinmesini isterse hemen silebilirsiniz.</p>
              <form action={eraseCandidate}><input type="hidden" name="id" value={c.id} /><ConfirmSubmit label="Aday verisini kalıcı sil" question="Aday ve tüm dosyaları kalıcı silinecek. Emin misiniz?" yes="Evet, sil" className="h-10 px-3 rounded-[10px] border border-[#E3B4AE] bg-white text-bad font-semibold text-sm" /></form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
