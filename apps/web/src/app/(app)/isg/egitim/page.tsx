import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { HAZARD_LABEL } from "@/lib/compliance";
import { TOPICS, TRAINING_KIND, TRAINING_RULES as R } from "@/lib/isg";
import { createSession, deleteRow, saveCourse, saveScores, toggleCourse } from "@/lib/isg-actions";
import { isgBase } from "@/lib/isg-data";
import { OB_STYLE, loadTraining, type Ob } from "@/lib/isg-training";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
const COLS: Array<[keyof Pick<import("@/lib/isg-training").EmpTraining, "onboarding" | "base" | "repeat" | "extra" | "refresh" | "exam">, string]> = [["onboarding", "İşe başlama"], ["base", "Temel"], ["repeat", "Tekrar"], ["extra", "İlave"], ["refresh", "Bilgi yenileme"], ["exam", "Sınav"]];

/** 2026 eğitim yönetmeliği: personel bazında yükümlülükler, oturum kaydı, sınav notları, uzaktan eğitim */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ hepsi?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const base = await isgBase(supabase);
  const [rows, { data: types }, { data: sessions, error }, { data: courses }, { data: progress }] = await Promise.all([
    loadTraining(supabase, base.hazard, today),
    supabase.from("compliance_types").select("id, code, name").eq("category", "TRAINING").eq("active", true).order("sort_order"),
    supabase.from("training_sessions").select("*").order("held_on", { ascending: false }).limit(30),
    supabase.from("elearning_courses").select("id, title, topic_group, duration_min, lesson_hours, questions, active").order("created_at", { ascending: false }),
    supabase.from("elearning_progress").select("course_id, employee_id, watched_sec, attempts, exam_score, passed, focus_losses"),
  ]);
  if (error) return (<><PageHeader title="Eğitim yükümlülükleri" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const shown = sp.hepsi ? rows : rows.filter((r) => r.issues > 0);
  const count = (k: (typeof COLS)[number][0]) => rows.filter((r) => ["late", "missing", "due"].includes(r[k].state)).length;
  const name = new Map(rows.map((r) => [r.id, r.name]));
  const { data: sessRecs } = (sessions ?? []).length ? await supabase.from("training_records").select("session_id, employee_id, exam_score, attempt").in("session_id", (sessions ?? []).map((x) => x.id)) : { data: [] };
  const typeName = new Map((types ?? []).map((t) => [t.id, t.name]));
  const Cell = ({ o }: { o: Ob }) => <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${OB_STYLE[o.state]}`}>{o.text}</span>;
  return (
    <>
      <PageHeader title="Eğitim yükümlülükleri" subtitle={`Çalışanların İSG Eğitimleri Yönetmeliği (RG 02.04.2026) · ${HAZARD_LABEL[base.hazard]}`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1280px]">
        <IsgNav active="/isg/egitim" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">{COLS.map(([k, l]) => <Stat key={k} label={l} value={`${count(k)}`} sub="eksik / geciken" />)}</div>
        <Card title="Kurallar">
          <ul className="text-sm text-[#33414F] grid md:grid-cols-2 gap-x-6 gap-y-1 list-disc pl-5">
            <li><b>İşe başlama:</b> fiilen çalışmadan önce, yüz yüze ve uygulamalı, en az {R.onboardingHours} saat; tutanakla özlük dosyasına.</li>
            <li><b>Temel:</b> en az {R.baseHours[base.hazard]} ders saati (1 ders saati = 45 dk + 15 dk ara), işe girişten itibaren en geç {R.baseDeadlineMonths} ay; 4. konuya en az {R.topic4Hours[base.hazard]} saat.</li>
            <li><b>Tekrar:</b> {R.repeatMonths[base.hazard] / 12} yılda bir, en az {R.repeatHours} ders saati.</li>
            <li><b>Sınav:</b> 100 üzerinden {R.passScore}; başarısız olana en fazla 2 ek sınav, yine başarısızsa temel eğitim tekrar.</li>
            <li><b>Uzaktan:</b> 1–3. konular uzaktan verilebilir; 4. konu {base.hazard === "AZ" ? "uzaktan da" : "yüz yüze"} verilir.</li>
            <li><b>İlave / bilgi yenileme:</b> iş kazası ya da meslek hastalığı sonrası ve 6 aydan uzun ayrılıktan sonra, işe dönmeden önce.</li>
          </ul>
        </Card>
        <Card title={`Personel durumu · ${shown.length}${sp.hepsi ? "" : " eksiği olan"} kişi`} action={<Link href={sp.hepsi ? "/isg/egitim" : "/isg/egitim?hepsi=1"} className="text-sm font-semibold text-brand-700">{sp.hepsi ? "Yalnız eksikler" : "Tüm personel"}</Link>}>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Personel</th><th className="py-2 px-2">İşe giriş</th>{COLS.map(([, l]) => <th key={l} className="py-2 px-2">{l}</th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-t border-[#EEF2F6]"><td className="py-1.5 px-2"><b>{r.name}</b><div className="text-xs text-muted">{r.dept}</div></td><td className="py-1.5 px-2 num text-xs">{r.hire ? formatDate(r.hire) : "—"}</td>{COLS.map(([k]) => <td key={k} className="py-1.5 px-2"><Cell o={r[k]} /></td>)}</tr>
            ))}{shown.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-ok font-semibold">Tüm yükümlülükler karşılanıyor.</td></tr>}</tbody>
          </table></div>
        </Card>
        {can && (
          <Card title="Eğitim oturumu kaydet">
            <form action={createSession} className="grid gap-2 md:grid-cols-4 text-sm items-end">
              <label className="flex flex-col gap-1 text-xs text-muted">Eğitim<select name="type_id" required className={input}>{(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Tür<select name="training_kind" className={input}>{Object.entries(TRAINING_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Tarih<input type="date" name="held_on" required defaultValue={today} className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Ders saati<input name="lesson_hours" inputMode="decimal" required placeholder={String(R.baseHours[base.hazard])} className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç saati<input type="time" name="start_time" className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Bitiş saati<input type="time" name="end_time" className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Yöntem<select name="method" className={input}><option value="yuz-yuze">Yüz yüze</option><option value="karma">Karma</option><option value="uzaktan">Uzaktan</option></select></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Yer<input name="location" className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Eğitici<input name="trainer_name" required className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Unvanı<input name="trainer_title" placeholder="İş güvenliği uzmanı (A)" className={input} /></label>
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="exam" className="w-4 h-4" />Sınav yapıldı (notlar sonra girilir)</label>
              <fieldset className="md:col-span-4 border border-line rounded-lg p-2 grid md:grid-cols-2 gap-x-4"><legend className="px-1 text-xs text-muted">Konu başlıkları (Ek-1)</legend>
                {TOPICS.map((g) => <div key={g.group} className="py-1"><div className="text-xs font-semibold text-brand-800">{g.group}. {g.title}</div>{g.items.map((it) => <label key={it} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="topics" value={`${g.group}. ${it}`} className="w-3.5 h-3.5" />{it}</label>)}</div>)}
              </fieldset>
              <fieldset className="md:col-span-4 border border-line rounded-lg p-2 max-h-56 overflow-y-auto grid grid-cols-2 md:grid-cols-4 gap-1"><legend className="px-1 text-xs text-muted">Katılımcılar (eksiği olanlar işaretli)</legend>
                {rows.map((r) => <label key={r.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="employee_ids" value={r.id} defaultChecked={r.issues > 0} className="w-4 h-4" />{r.name}</label>)}
              </fieldset>
              <input name="note" placeholder="Not" className={`${input} md:col-span-3`} aria-label="Not" />
              <PendingSubmit className={btn}>Kaydet</PendingSubmit>
            </form>
          </Card>
        )}
        <Card title="Son oturumlar">
          <ul className="flex flex-col gap-2">{(sessions ?? []).map((x) => {
            const recs = (sessRecs ?? []).filter((r) => r.session_id === x.id);
            return (
              <li key={x.id} className="rounded-xl border border-line p-3 text-sm flex flex-col gap-2">
                <div className="flex flex-wrap justify-between gap-2"><span><b>{typeName.get(x.type_id)}</b> · {TRAINING_KIND[x.training_kind]} · <span className="num">{formatDate(x.held_on)}</span> · {Number(x.lesson_hours)} ders saati · {x.method === "yuz-yuze" ? "yüz yüze" : x.method} · {x.trainer_name}</span>
                  <span className="flex gap-3 text-xs font-semibold"><a href={`/yazdir/isg?tur=tutanak&id=${x.id}`} target="_blank" rel="noopener" className="text-brand-700">Katılım tutanağı</a>{x.training_kind === "temel" && <a href={`/yazdir/isg?tur=belge&id=${x.id}`} target="_blank" rel="noopener" className="text-brand-700">Temel eğitim belgeleri</a>}</span></div>
                <div className="text-xs text-muted">{(x.employee_ids as string[]).length} katılımcı{(x.topics as string[]).length ? ` · ${(x.topics as string[]).length} konu` : ""}</div>
                {x.exam && can && (
                  <details><summary className="cursor-pointer text-brand-700 font-semibold text-xs">Sınav notları</summary>
                    <form action={saveScores} className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <input type="hidden" name="session_id" value={x.id} />
                      {recs.map((r) => <label key={r.employee_id} className="flex items-center gap-2 text-xs"><span className="flex-1">{name.get(r.employee_id) ?? "—"}</span><input name={`score_${r.employee_id}`} defaultValue={r.exam_score ?? ""} inputMode="numeric" className="h-8 w-16 rounded border border-[#D5DEE8] px-1.5" aria-label="Not" />{r.exam_score !== null && r.exam_score < 60 && <label className="flex items-center gap-1"><input type="checkbox" name={`retry_${r.employee_id}`} />ek sınav ({r.attempt ?? 1}. deneme)</label>}</label>)}
                      <PendingSubmit className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold justify-self-start">Notları kaydet</PendingSubmit>
                    </form>
                  </details>
                )}
                {can && <form action={deleteRow}><input type="hidden" name="table" value="training_sessions" /><input type="hidden" name="id" value={x.id} /><ConfirmSubmit label="Oturumu sil" question="Oturum silinir; personel eğitim kayıtları kalır. Emin misiniz?" /></form>}
              </li>
            );
          })}{(sessions ?? []).length === 0 && <li className="text-sm text-muted">Oturum kaydı yok.</li>}</ul>
        </Card>
        <Card title="Uzaktan eğitim">
          <p className="text-xs text-muted">Personel telefonundan izler: ileri sarma engellenir, sekme değiştirince video durur ve kayda geçer, belirli aralıklarla &quot;devam ediyor musunuz&quot; sorusu çıkar. Tamamlayınca sınava girer; 60 ve üzeri alırsa eğitim kaydı otomatik açılır.</p>
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(courses ?? []).map((c) => {
            const pr = (progress ?? []).filter((p) => p.course_id === c.id);
            return (
              <li key={c.id} className={`py-2 flex flex-wrap items-center gap-2 ${c.active ? "" : "opacity-60"}`}>
                <span className="flex-1 min-w-[220px]"><b>{c.title}</b> <span className="text-muted">· {c.topic_group}. konu · {c.duration_min} dk · {Number(c.lesson_hours)} ders saati · {(c.questions as unknown[]).length} soru</span></span>
                <span className="text-xs">{pr.filter((p) => p.passed).length} başarılı · {pr.filter((p) => !p.passed && p.attempts > 0).length} başarısız · {pr.filter((p) => !p.attempts).length} izliyor</span>
                {can && <form action={toggleCourse}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><PendingSubmit className="text-xs text-brand-700 font-semibold">{c.active ? "Yayından kaldır" : "Yayınla"}</PendingSubmit></form>}
              </li>
            );
          })}{(courses ?? []).length === 0 && <li className="py-2 text-muted">Henüz uzaktan eğitim yok.</li>}</ul>
          {can && (
            <details className="rounded-xl border border-dashed border-[#B9C7D6] p-3"><summary className="cursor-pointer font-semibold text-brand-700">Yeni uzaktan eğitim</summary>
              <form action={saveCourse} className="grid gap-2 md:grid-cols-3 mt-3 text-sm">
                <input name="title" required placeholder="Başlık (ör. Yangından korunma)" className={`${input} md:col-span-2`} aria-label="Başlık" />
                <select name="topic_group" className={input} aria-label="Konu başlığı"><option value="1">1. Genel konular</option><option value="2">2. Sağlık konuları</option><option value="3">3. Teknik konular</option>{base.hazard === "AZ" && <option value="4">4. İşyerine özgü</option>}</select>
                <input name="video_url" placeholder="Video bağlantısı (MP4 adresi)" className={`${input} md:col-span-2`} aria-label="Video bağlantısı" />
                <label className="text-xs text-muted flex flex-col gap-1">veya video dosyası (en çok 20 MB)<input type="file" name="file" accept="video/mp4,video/webm" className="text-sm" /></label>
                <input name="duration_min" inputMode="numeric" required placeholder="Süre (dk)" className={input} aria-label="Süre" />
                <input name="lesson_hours" inputMode="decimal" placeholder="Ders saati (1)" className={input} aria-label="Ders saati" />
                <select name="type_id" className={input} aria-label="Bağlı eğitim türü" defaultValue={(types ?? []).find((t) => t.code === "TEMEL_ISG")?.id}><option value="">Eğitim kaydı açılmasın</option>{(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <textarea name="questions" rows={5} placeholder={"Her satıra bir soru:\nYangın tüpü hangi sırayla kullanılır? | Pimi çek, hortumu tut, sık ; Önce sık, sonra çek ; Yalnız hortumu tut | 1"} className="md:col-span-3 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 font-mono text-xs" aria-label="Sorular" />
                <p className="md:col-span-3 text-xs text-muted">Soru biçimi: <code>Soru | A ; B ; C ; D | doğru şık numarası</code>. Şıkları noktalı virgülle ayırın.</p>
                <PendingSubmit className={`${btn} justify-self-start`}>Yayınla</PendingSubmit>
              </form>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}
