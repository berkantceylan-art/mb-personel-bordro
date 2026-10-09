import Link from "next/link";
import { redirect } from "next/navigation";
import { nextPeriod, previousPeriod } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { CHANGE_TYPES, CONTRACT_LABEL, DECISION_LABEL, DISC_CATEGORIES, ISSUE_LABEL, addWorkdays, disabilityQuota, workTimeIssues, type WorkIssue } from "@/lib/labor";
import { currentPeriod, formatDate, getSession, periodLabel, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadMonth } from "@/lib/timekeeping";
import { addTelafiEntry, askOvertimeConsent, decideCase, recordDefense, requestDefense, saveCase, saveChange, saveContract, saveDisability, saveMaternity, saveTelafi } from "./actions";

const TABS = [["ozet", "Özet"], ["calisma", "Çalışma süreleri"], ["disiplin", "Disiplin"], ["degisiklik", "Esaslı değişiklik"], ["mesai", "Fazla mesai onayı"], ["telafi", "Telafi çalışması"], ["analik", "Analık ve süt izni"], ["izin", "Yıllık izin planı"], ["sozlesme", "Sözleşmeler"], ["engelli", "Engelli kotası"]] as const;
type Tab = (typeof TABS)[number][0];
const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
const d = (iso?: string | null) => (iso ? formatDate(iso.slice(0, 10)) : "—");
type Emp = { id: string; first_name: string; last_name: string; hire_date: string | null; user_id: string | null; contract_type: string; contract_end: string | null; weekly_hours: number | null; contract_renewals: number; fixed_term_reason: string | null; departments: unknown };

/** İş Kanunu uyum merkezi */
export default async function LaborLawPage({ searchParams }: { searchParams: Promise<{ sekme?: string; donem?: string; yil?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.sekme)?.[0] ?? "ozet") as Tab;
  const today = todayIso();
  const year = Number(sp.yil) || Number(today.slice(0, 4));
  const supabase = await createClient();
  const { data: empsRaw, error } = await supabase.from("employees").select("id, first_name, last_name, hire_date, user_id, contract_type, contract_end, weekly_hours, contract_renewals, fixed_term_reason, departments(name)").neq("status", "terminated").order("first_name");
  if (error) return (<><PageHeader title="İş Kanunu uyumu" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261117000000_labor_law.sql</b> çalıştırılmalı.</p></Card></div></>);
  const emps = (empsRaw ?? []) as Emp[];
  const name = (id: string) => { const e = emps.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : "—"; };
  const dept = (e: Emp) => (e.departments as { name: string } | null)?.name ?? "—";
  const EmpSelect = ({ n = "employee_id" }: { n?: string }) => <select name={n} required className={input} aria-label="Personel"><option value="">Personel seçin</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>;

  const [{ data: cases }, { data: changes }, { data: works }, { data: entries }, { data: mats }, , { data: privs }, { data: sigs }, { data: docType }] = await Promise.all([
    supabase.from("disciplinary_cases").select("*").order("incident_at", { ascending: false }),
    supabase.from("condition_changes").select("*").order("notified_at", { ascending: false }),
    supabase.from("compensatory_work").select("*").order("off_date", { ascending: false }),
    supabase.from("compensatory_entries").select("work_id, work_date, hours"),
    supabase.from("maternity_records").select("*").order("created_at", { ascending: false }),
    supabase.from("leave_plans").select("*").eq("year", year).order("start_date"),
    supabase.from("employee_private").select("employee_id, disabled, disability_degree, gender, birth_date"),
    supabase.from("document_signatures").select("employee_id, signed_at").eq("template_key", "fazla-calisma-muvafakat").gte("signed_at", `${today.slice(0, 4)}-01-01`),
    supabase.from("document_types").select("id").is("company_id", null).eq("template_key", "is-sozlesmesi").maybeSingle(),
  ]);
  const { data: contractDocs } = docType ? await supabase.from("employee_documents").select("employee_id").eq("document_type_id", docType.id) : { data: [] };
  const pv = new Map((privs ?? []).map((p) => [p.employee_id, p]));

  // Hesaplanan uyarılar
  const disabledCount = emps.filter((e) => pv.get(e.id)?.disabled).length;
  const quota = disabilityQuota(emps.length);
  const openCases = (cases ?? []).filter((c) => !c.decided_at);
  const defenseLate = openCases.filter((c) => c.defense_requested_at && !c.defense_received_at && c.defense_due < today);
  const hakliDeadline = (c: { learned_at: string }) => addWorkdays(c.learned_at, 6);
  const changePending = (changes ?? []).filter((c) => !c.responded_at);
  const consented = new Set((sigs ?? []).map((x) => x.employee_id));
  const noConsent = emps.filter((e) => !consented.has(e.id));
  const telafiOpen = (works ?? []).map((w) => ({ w, done: (entries ?? []).filter((x) => x.work_id === w.id).reduce((a, x) => a + Number(x.hours), 0) })).filter((x) => x.done < Number(x.w.hours));
  const fixedEnding = emps.filter((e) => e.contract_type === "belirli" && e.contract_end && e.contract_end <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const chained = emps.filter((e) => e.contract_type === "belirli" && e.contract_renewals >= 1);
  const twoMonthsAgo = new Date(Date.now() - 61 * 86_400_000).toISOString().slice(0, 10);
  const hasContractDoc = new Set((contractDocs ?? []).map((x) => x.employee_id));
  const noContract = emps.filter((e) => e.hire_date && e.hire_date <= twoMonthsAgo && !hasContractDoc.has(e.id));
  const milkActive = (mats ?? []).filter((m) => m.milk_until && m.milk_until >= today);

  return (
    <>
      <PageHeader title="İş Kanunu uyumu" subtitle="4857 sayılı İş Kanunu ve yönetmeliklerden doğan yükümlülüklerin takibi" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <nav className="flex flex-wrap gap-1.5" aria-label="Bölümler">
          {TABS.map(([k, l]) => <Link key={k} href={`/is-hukuku?sekme=${k}`} aria-current={tab === k ? "page" : undefined} className={`h-10 px-3.5 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}</Link>)}
        </nav>

        {tab === "ozet" && (
          <>
            <OzetCalisma />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["engelli", "Engelli çalışan kotası (md. 30)", `${disabledCount} / ${quota}`, disabledCount < quota, disabledCount < quota ? `${quota - disabledCount} kişi eksik; her eksik kişi için her ay idari para cezası` : "kota karşılanıyor"],
                ["disiplin", "Açık disiplin dosyası", String(openCases.length), defenseLate.length > 0 || openCases.some((c) => hakliDeadline(c) <= addWorkdays(today, 1)), defenseLate.length ? `${defenseLate.length} savunma süresi doldu` : "md. 19 savunma, md. 26 altı iş günü"],
                ["degisiklik", "Yanıt bekleyen esaslı değişiklik", String(changePending.length), changePending.some((c) => c.response_due < today), "6 iş günü içinde yazılı kabul (md. 22)"],
                ["mesai", `${today.slice(0, 4)} fazla mesai onayı vermeyen`, String(noConsent.length), noConsent.length > 0, "Fazla Çalışma Yön. md. 9: her yıl yazılı onay"],
                ["telafi", "Tamamlanmamış telafi", String(telafiOpen.length), telafiOpen.some((x) => x.w.deadline < addWorkdays(today, 10)), "2 ay içinde, günde en çok 3 saat (md. 64)"],
                ["analik", "Süt izni süren", String(milkActive.length), false, "günde 1,5 saat, doğumdan sonra 1 yıl (md. 74)"],
                ["sozlesme", "Sözleşme uyarısı", String(fixedEnding.length + chained.length + noContract.length), fixedEnding.length + chained.length + noContract.length > 0, `${fixedEnding.length} bitiyor · ${chained.length} zincirleme · ${noContract.length} yazılı sözleşme yok`],
              ] as const).map(([k, l, v, warn, sub]) => (
                <Link key={k} href={`/is-hukuku?sekme=${k}`} className={`rounded-xl border p-4 flex flex-col gap-1 ${warn ? "border-[#F2C94C] bg-[#FFF4E0]" : "border-line bg-white"}`}>
                  <span className="text-xs text-muted">{l}</span><span className={`num text-2xl font-bold ${warn ? "text-[#8A5A00]" : "text-brand-800"}`}>{v}</span><span className="text-xs text-muted">{sub}</span>
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted">Bu sayfa yükümlülükleri hatırlatır; hukuki danışmanlığın yerine geçmez. Fesih ve disiplin kararlarından önce avukatınıza danışın.</p>
          </>
        )}

        {tab === "calisma" && <Calisma period={sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod()} />}

        {tab === "disiplin" && (
          <>
            <Card title="Yeni tutanak">
              <form action={saveCase} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <EmpSelect />
                <label className="flex flex-col gap-1 text-muted">Olay zamanı<input type="datetime-local" name="incident_at" required className={input} /></label>
                <label className="flex flex-col gap-1 text-muted">İşverenin öğrendiği gün<input type="date" name="learned_at" defaultValue={today} className={input} /></label>
                <select name="category" className={input} aria-label="Konu">{DISC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                <textarea name="description" required rows={2} placeholder="Olay (ne, nerede, nasıl)" className={`${input} h-auto py-2 sm:col-span-2 lg:col-span-3`} />
                <input name="witnesses" placeholder="Tanıklar" className={input} />
                <PendingSubmit className={`${btn} justify-self-start`}>Tutanağı kaydet</PendingSubmit>
              </form>
            </Card>
            {(cases ?? []).map((c) => {
              const lim = hakliDeadline(c);
              const left = Math.round((Date.parse(lim) - Date.parse(today)) / 86_400_000);
              return (
                <Card key={c.id} title={`${name(c.employee_id)} · ${c.category}`} action={<a href={`/yazdir/is-hukuku?tur=disiplin&id=${c.id}`} target="_blank" rel="noopener" className="text-sm font-semibold text-brand-700">Tutanak / savunma istemi yazdır</a>}>
                  <div className="text-xs text-muted flex flex-wrap gap-x-3">
                    <span>Olay {new Date(c.incident_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</span><span>öğrenildi {d(c.learned_at)}</span>
                    {!c.decided_at && <span className={left < 0 ? "text-muted" : left <= 2 ? "text-bad font-semibold" : ""}>haklı fesih için son gün {d(lim)}{left < 0 ? " (geçti)" : ""}</span>}
                  </div>
                  <p className="text-sm whitespace-pre-line">{c.description}{c.witnesses ? `\nTanıklar: ${c.witnesses}` : ""}</p>
                  {!c.defense_requested_at && !c.decided_at && (
                    <form action={requestDefense} className="flex flex-wrap gap-2 items-center text-sm"><input type="hidden" name="id" value={c.id} /><label className="flex items-center gap-2">Savunma süresi<input name="days" type="number" min={1} max={10} defaultValue={2} className={`${input} w-16`} />iş günü</label><PendingSubmit className={btn}>Savunma iste</PendingSubmit></form>
                  )}
                  {c.defense_requested_at && (
                    <div className="text-sm rounded-lg bg-[#F5F7FA] p-3 flex flex-col gap-1">
                      <div className="text-xs text-muted">Savunma istendi {d(c.defense_requested_at)} · son gün {d(c.defense_due)}{c.defense_received_at ? ` · alındı ${d(c.defense_received_at)} (${c.defense_channel === "mobil" ? "uygulamadan" : "yazılı"})` : c.defense_due < today ? " · süre doldu, savunma vermedi" : " · bekleniyor"}</div>
                      {c.defense_text ? <p className="whitespace-pre-line">{c.defense_text}</p> : !c.decided_at && (
                        <form action={recordDefense} className="flex flex-col gap-1"><input type="hidden" name="id" value={c.id} /><textarea name="defense_text" rows={2} placeholder="Yazılı savunmayı aktarın veya 'süresinde savunma vermedi' yazın" className={`${input} h-auto py-2`} /><PendingSubmit className={`${btn} self-start`}>Savunmayı kaydet</PendingSubmit></form>
                      )}
                    </div>
                  )}
                  {c.decided_at ? (
                    <p className="text-sm"><b>Karar:</b> {DECISION_LABEL[c.decision ?? ""]}{c.wage_cut_days ? ` · ${c.wage_cut_days} günlük ücret (${periodLabel(c.wage_cut_period)})` : ""} · {d(c.decided_at)}{c.decision_note ? ` · ${c.decision_note}` : ""}{c.decision?.endsWith("fesih") && <> · <Link href={`/personel/${c.employee_id}/cikis`} className="font-semibold text-bad">İşten çıkış sihirbazı →</Link></>}</p>
                  ) : (
                    <form action={decideCase} className="grid gap-2 sm:grid-cols-[1.4fr_.6fr_.8fr_1.4fr_auto] items-end text-sm">
                      <input type="hidden" name="id" value={c.id} />
                      <label className="flex flex-col gap-1 text-muted">Karar<select name="decision" className={input}>{Object.entries(DECISION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                      <label className="flex flex-col gap-1 text-muted">Kesinti (gün)<input name="wage_cut_days" inputMode="decimal" placeholder="≤ 2" className={input} /></label>
                      <label className="flex flex-col gap-1 text-muted">Dönem<input name="wage_cut_period" placeholder={today.slice(0, 7)} className={input} /></label>
                      <label className="flex flex-col gap-1 text-muted">Gerekçe<input name="decision_note" className={input} /></label>
                      <PendingSubmit className={btn}>Karar ver</PendingSubmit>
                      <label className="flex items-center gap-2 text-xs text-muted sm:col-span-5"><input type="checkbox" name="override" className="w-4 h-4" />Haklı fesih için 6 iş günlük sürenin geçtiğini biliyorum (avukat görüşüyle)</label>
                    </form>
                  )}
                </Card>
              );
            })}
            <p className="text-xs text-muted">md. 19: davranış veya verimle ilgili nedenle fesihten önce savunma alınmalı. md. 25/II–26: ahlak ve iyi niyet kurallarına aykırılıkta fesih hakkı öğrenmeden itibaren 6 iş günü içinde kullanılır. md. 38: ücret kesme cezası ayda 2 günlük ücreti geçemez, gerekçesiyle hemen bildirilir; kesinti işçilerin eğitimi ve sosyal hizmetleri için ayrı hesaba yatırılır.</p>
          </>
        )}

        {tab === "degisiklik" && (
          <>
            <Card title="Esaslı değişiklik bildir">
              <form action={saveChange} className="grid gap-2 sm:grid-cols-3 text-sm">
                <EmpSelect />
                <select name="change_type" className={input} aria-label="Değişiklik türü">{CHANGE_TYPES.map((c) => <option key={c}>{c}</option>)}</select>
                <label className="flex flex-col gap-1 text-muted">Yürürlük<input type="date" name="effective_date" className={input} /></label>
                <textarea name="description" required rows={2} placeholder="Değişikliğin açık tanımı (önceki ve yeni durum)" className={`${input} h-auto py-2 sm:col-span-3`} />
                <PendingSubmit className={`${btn} justify-self-start`}>Bildir (mobil + yazdırılabilir)</PendingSubmit>
              </form>
              <p className="text-xs text-muted">md. 22: işveren, iş sözleşmesinden doğan çalışma koşullarında esaslı değişikliği ancak yazılı bildirimle yapabilir; işçi 6 iş günü içinde yazılı kabul etmezse değişiklik onu bağlamaz. Kabul edilmezse işveren, geçerli nedenle ve bildirim süresine uyarak feshedebilir.</p>
            </Card>
            <Card title="Bildirimler">
              <ul className="divide-y divide-[#EEF2F6] text-sm">{(changes ?? []).map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                  <b>{name(c.employee_id)}</b><span className="text-muted">{c.change_type}</span><span className="flex-1 min-w-[200px]">{c.description}</span>
                  <span className={c.response === "accepted" ? "text-ok font-semibold" : c.response === "rejected" ? "text-bad font-semibold" : c.response_due < today ? "text-bad" : "text-[#7A4F00]"}>{c.response === "accepted" ? `kabul etti ${d(c.responded_at)}` : c.response === "rejected" ? `kabul etmedi ${d(c.responded_at)}` : c.response_due < today ? `süre doldu (${d(c.response_due)}) — kabul edilmemiş sayılır` : `yanıt bekleniyor · son gün ${d(c.response_due)}`}</span>
                  <a href={`/yazdir/is-hukuku?tur=degisiklik&id=${c.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">Yazdır</a>
                </li>
              ))}{(changes ?? []).length === 0 && <li className="py-3 text-muted">Bildirim yok.</li>}</ul>
            </Card>
          </>
        )}

        {tab === "mesai" && (
          <Card title={`${today.slice(0, 4)} fazla çalışma onayı · ${consented.size} / ${emps.length} imzaladı`} action={<form action={askOvertimeConsent}><PendingSubmit className={btn}>İmzalamayanlara bildirim gönder</PendingSubmit></form>}>
            <p className="text-xs text-muted">Fazla Çalışma Yönetmeliği md. 9: fazla çalışma için işçinin yazılı onayı alınır ve özlük dosyasında saklanır; onay bir yıl geçerlidir. Personel &quot;Fazla çalışma ve denkleştirme muvafakatnamesi&quot;ni uygulamadaki İmzalarım sayfasından imzalar. Onayı olmayan personele fazla mesai yaptırılamaz.</p>
            {noConsent.length > 0 && <div className="flex flex-wrap gap-1.5">{noConsent.map((e) => <span key={e.id} className={`text-xs rounded-full px-2.5 py-1 ${e.user_id ? "bg-[#FFF4E0] text-[#7A4F00]" : "bg-[#EEF2F6] text-muted"}`} title={e.user_id ? "Uygulama hesabı var" : "Uygulama hesabı yok: kâğıt formu imzalatın"}>{e.first_name} {e.last_name}{e.user_id ? "" : " (kâğıt)"}</span>)}</div>}
            <Link href="/personel" className="text-xs font-semibold text-brand-700">Kâğıt formu yazdırmak için personel kartı → Belgeler</Link>
          </Card>
        )}

        {tab === "telafi" && (
          <>
            <Card title="Telafi çalışması kaydı">
              <form action={saveTelafi} className="grid gap-2 sm:grid-cols-4 text-sm">
                <label className="flex flex-col gap-1 text-muted">Çalışılmayan gün<input type="date" name="off_date" required className={input} /></label>
                <label className="flex flex-col gap-1 text-muted">Telafi edilecek saat<input name="hours" inputMode="decimal" required placeholder="7,5" className={input} /></label>
                <select name="reason" className={input} aria-label="Neden"><option>Bayram / tatil öncesi-sonrası köprü</option><option>Zorunlu nedenlerle işin durması</option><option>İşçinin talebiyle izin</option><option>Diğer</option></select>
                <input name="note" placeholder="Not" className={input} />
                <fieldset className="sm:col-span-4 border border-line rounded-lg p-2 max-h-40 overflow-y-auto grid grid-cols-2 md:grid-cols-4 gap-1"><legend className="px-1 text-muted">Personel</legend>{emps.map((e) => <label key={e.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="employee_ids" value={e.id} defaultChecked className="w-4 h-4" />{e.first_name} {e.last_name}</label>)}</fieldset>
                <PendingSubmit className={`${btn} justify-self-start`}>Kaydet</PendingSubmit>
              </form>
            </Card>
            {(works ?? []).map((w) => {
              const es = (entries ?? []).filter((x) => x.work_id === w.id);
              const done = es.reduce((a, x) => a + Number(x.hours), 0);
              return (
                <Card key={w.id} title={`${d(w.off_date)} · ${w.reason}`}>
                  <div className="text-sm">{done.toLocaleString("tr-TR")} / {Number(w.hours).toLocaleString("tr-TR")} saat telafi edildi · son gün <b className={w.deadline < today && done < Number(w.hours) ? "text-bad" : ""}>{d(w.deadline)}</b> · {w.employee_ids.length} kişi</div>
                  {es.length > 0 && <div className="flex flex-wrap gap-1.5">{es.map((x) => <span key={x.work_date} className="text-xs rounded-full bg-[#EEF3F9] px-2.5 py-1">{d(x.work_date)} · {x.hours} sa</span>)}</div>}
                  {done < Number(w.hours) && <form action={addTelafiEntry} className="flex flex-wrap gap-2 items-end text-sm"><input type="hidden" name="work_id" value={w.id} /><label className="flex flex-col gap-1 text-muted">Telafi günü<input type="date" name="work_date" required className={input} /></label><label className="flex flex-col gap-1 text-muted w-24">Saat (≤3)<input name="hours" inputMode="decimal" defaultValue="2" className={input} /></label><PendingSubmit className={btn}>Ekle</PendingSubmit></form>}
                </Card>
              );
            })}
            <p className="text-xs text-muted">md. 64: zorunlu nedenlerle çalışılmayan süreler ya da tatil öncesi/sonrası verilen izinler, 2 ay içinde telafi ettirilebilir. Telafi çalışması fazla mesai sayılmaz; günde 3 saati aşamaz ve tatil günlerinde yaptırılamaz.</p>
          </>
        )}

        {tab === "analik" && (
          <>
            <Card title="Analık kaydı">
              <form action={saveMaternity} className="grid gap-2 sm:grid-cols-4 text-sm">
                <select name="employee_id" required className={input} aria-label="Personel"><option value="">Personel seçin</option>{emps.filter((e) => String(pv.get(e.id)?.gender ?? "").toLocaleLowerCase("tr").startsWith("k") || !pv.get(e.id)?.gender).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
                <label className="flex flex-col gap-1 text-muted">Beklenen doğum<input type="date" name="expected_birth" className={input} /></label>
                <label className="flex flex-col gap-1 text-muted">Doğum tarihi<input type="date" name="birth_date" className={input} /></label>
                <label className="flex items-center gap-2 text-muted"><input type="checkbox" name="multiple" className="w-5 h-5" />Çoğul gebelik</label>
                <PendingSubmit className={`${btn} justify-self-start`}>Hesapla ve kaydet</PendingSubmit>
              </form>
            </Card>
            <Card title="Kayıtlar">
              <ul className="divide-y divide-[#EEF2F6] text-sm">{(mats ?? []).map((m) => (
                <li key={m.id} className="py-2 flex flex-wrap gap-x-4 gap-y-1"><b>{name(m.employee_id)}</b><span>izin {d(m.leave_start)} – {d(m.leave_end)}</span>{m.birth_date && <span>doğum {d(m.birth_date)}</span>}{m.milk_until && <span className={m.milk_until >= today ? "text-ok" : "text-muted"}>süt izni {d(m.milk_until)} tarihine kadar (günde 1,5 saat)</span>}</li>
              ))}{(mats ?? []).length === 0 && <li className="py-3 text-muted">Kayıt yok.</li>}</ul>
            </Card>
            <p className="text-xs text-muted">md. 74 (7578 sayılı Kanunla 01.05.2026&apos;dan itibaren): doğumdan önce 8, sonra 16 hafta (çoğul gebelikte doğum öncesi 10 hafta) analık izni; doktor onayıyla doğumdan önceki 2 haftaya kadar çalışılabilir ve kullanılmayan süre doğum sonrasına eklenir. Çocuk 1 yaşına kadar günde 1,5 saat süt izni verilir ve çalışma süresinden sayılır. Talep hâlinde 6 aya kadar ücretsiz izin ve yarım çalışma hakkı vardır.</p>
          </>
        )}

        {tab === "izin" && <Card title="Yıllık izin planı"><p className="text-sm">Yıllık izin planlaması, personel tercihleri, toplu izin ve izin kayıt belgeleri <b>Yıllık izin</b> modülüne taşındı.</p><Link href="/yillik-izin?sekme=plan" className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm grid place-items-center self-start">Yıllık izin planına git</Link></Card>}

        {tab === "sozlesme" && (
          <Card title="Sözleşme türleri ve uyarılar">
            {(fixedEnding.length > 0 || chained.length > 0 || noContract.length > 0) && (
              <div className="text-sm rounded-lg bg-[#FFF4E0] text-[#7A4F00] p-3 flex flex-col gap-1">
                {fixedEnding.map((e) => <div key={e.id}>⚠ {e.first_name} {e.last_name}: belirli süreli sözleşmesi {d(e.contract_end)} tarihinde bitiyor.</div>)}
                {chained.map((e) => <div key={e.id}>⚠ {e.first_name} {e.last_name}: belirli süreli sözleşme {e.contract_renewals} kez yenilenmiş; esaslı neden yoksa belirsiz süreli sayılır (md. 11).</div>)}
                {noContract.length > 0 && <div>⚠ İşe girişi 2 aydan eski olup sistemde imzalı iş sözleşmesi bulunmayan {noContract.length} kişi: {noContract.slice(0, 12).map((e) => `${e.first_name} ${e.last_name}`).join(", ")}{noContract.length > 12 ? "…" : ""}. md. 8: yazılı sözleşme yoksa en geç 2 ay içinde çalışma koşullarını gösteren yazılı belge verilmelidir.</div>}
              </div>
            )}
            <ul className="divide-y divide-[#EEF2F6]">{emps.map((e) => (
              <li key={e.id} className="py-2">
                <form action={saveContract} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_.9fr_.6fr_.6fr_1.4fr_auto] items-center text-sm">
                  <input type="hidden" name="employee_id" value={e.id} />
                  <span className="font-medium">{e.first_name} {e.last_name} <span className="text-xs text-muted">{dept(e)}</span></span>
                  <select name="contract_type" defaultValue={e.contract_type} className={input} aria-label="Tür">{Object.entries(CONTRACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input type="date" name="contract_end" defaultValue={e.contract_end ?? ""} className={input} aria-label="Bitiş" />
                  <input name="weekly_hours" defaultValue={e.weekly_hours ?? ""} placeholder="sa/hf" className={input} aria-label="Haftalık saat" />
                  <input name="contract_renewals" type="number" min={0} defaultValue={e.contract_renewals} className={input} aria-label="Yenileme sayısı" />
                  <input name="fixed_term_reason" defaultValue={e.fixed_term_reason ?? ""} placeholder="Belirli süre nedeni" className={input} aria-label="Neden" />
                  <PendingSubmit className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm">Kaydet</PendingSubmit>
                </form>
              </li>
            ))}</ul>
          </Card>
        )}

        {tab === "engelli" && (
          <Card title={`Engelli çalışan kotası · ${disabledCount} / ${quota}`}>
            <div className={`rounded-lg p-3 text-sm ${disabledCount < quota ? "bg-[#FDECEA] text-[#9B1C1C]" : "bg-[#E6F4EC] text-[#1A7F52]"}`}>{emps.length} çalışan için zorunlu engelli çalışan sayısı <b>{quota}</b>; sistemde kayıtlı <b>{disabledCount}</b>. {disabledCount < quota ? `${quota - disabledCount} eksik: eksik her kişi ve her ay için idari para cezası uygulanır (md. 101). İŞKUR'a engelli personel talebi açıp ilanı İşe alım modülünden yayınlayabilirsiniz.` : "Kota karşılanıyor."}</div>
            <p className="text-xs text-muted">md. 30: 50 veya daha fazla işçi çalıştırılan özel sektör işyerlerinde işçi sayısının %3&apos;ü oranında engelli işçi çalıştırılır; kısmi süreli çalışanlar çalışma sürelerine göre hesaba katılır, kesirlerin yarıma kadarı dikkate alınmaz. Engellilik oranı en az %40 olmalıdır. Bu veri özel nitelikli kişisel veridir; yalnız İK ve sahip görür.</p>
            <ul className="divide-y divide-[#EEF2F6]">{emps.map((e) => { const p = pv.get(e.id); return (
              <li key={e.id} className="py-1.5"><form action={saveDisability} className="flex flex-wrap items-center gap-3 text-sm"><input type="hidden" name="employee_id" value={e.id} /><span className="flex-1 min-w-[180px]">{e.first_name} {e.last_name}</span><label className="flex items-center gap-1.5"><input type="checkbox" name="disabled" defaultChecked={!!p?.disabled} className="w-4 h-4" />Engelli</label><label className="flex items-center gap-1.5">Oran %<input name="disability_degree" type="number" min={0} max={100} defaultValue={p?.disability_degree ?? ""} className={`${input} w-20`} /></label><PendingSubmit className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-brand-700 text-xs font-semibold">Kaydet</PendingSubmit></form></li>
            ); })}</ul>
          </Card>
        )}
      </div>
    </>
  );
}

/** Özet: bu ayın çalışma süresi ihlalleri */
async function OzetCalisma() {
  const supabase = await createClient();
  const m = await loadMonth(supabase, currentPeriod());
  const issues = workTimeIssues(m);
  const by = new Map<string, number>();
  for (const i of issues) by.set(i.kind, (by.get(i.kind) ?? 0) + 1);
  return (
    <Link href="/is-hukuku?sekme=calisma" className={`rounded-xl border p-4 flex flex-wrap gap-4 items-center ${issues.length ? "border-[#F2C94C] bg-[#FFF4E0]" : "border-line bg-white"}`}>
      <span className="text-sm font-semibold text-brand-800">Bu ay çalışma süresi ihlali: <span className="num text-xl">{issues.length}</span></span>
      {(Object.keys(ISSUE_LABEL) as Array<WorkIssue["kind"]>).map((k) => <span key={k} className="text-xs text-muted">{ISSUE_LABEL[k][0]}: <b className="text-ink">{by.get(k) ?? 0}</b></span>)}
    </Link>
  );
}

async function Calisma({ period }: { period: string }) {
  const supabase = await createClient();
  const m = await loadMonth(supabase, period);
  const issues = workTimeIssues(m);
  const people = new Map<string, WorkIssue[]>();
  for (const i of issues) people.set(i.employeeId, [...(people.get(i.employeeId) ?? []), i]);
  return (
    <Card title={`Çalışma süresi denetimi · ${periodLabel(period)} · ${issues.length} ihlal`} action={
      <div className="flex gap-2"><Link href={`/is-hukuku?sekme=calisma&donem=${previousPeriod(period)}`} className="h-9 w-9 grid place-items-center rounded-lg border border-[#D5DEE8] bg-white text-brand-700" aria-label="Önceki ay">←</Link><Link href={`/is-hukuku?sekme=calisma&donem=${nextPeriod(period)}`} className="h-9 w-9 grid place-items-center rounded-lg border border-[#D5DEE8] bg-white text-brand-700" aria-label="Sonraki ay">→</Link></div>
    }>
      <ul className="grid gap-2 sm:grid-cols-2 text-xs text-muted">{(Object.entries(ISSUE_LABEL) as Array<[WorkIssue["kind"], [string, string]]>).map(([k, [l, why]]) => <li key={k}><b className="text-ink">{l}</b> ({issues.filter((i) => i.kind === k).length}) — {why}</li>)}</ul>
      {issues.length === 0 ? <p className="text-sm text-ok">✓ Okutmalara göre bu ay ihlal görünmüyor.</p> : (
        <ul className="divide-y divide-[#EEF2F6] text-sm">{[...people.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, xs]) => (
          <li key={id} className="py-2"><details><summary className="cursor-pointer flex justify-between gap-2"><span><b>{xs[0]!.name}</b> <span className="text-xs text-muted">{xs[0]!.dept}</span></span><span className="text-xs font-semibold text-bad">{xs.length} ihlal</span></summary>
            <ul className="mt-1 text-xs flex flex-col gap-0.5">{xs.map((x, i) => <li key={i}>{x.date.split("-").reverse().join(".")} · {ISSUE_LABEL[x.kind][0]} · {x.detail}</li>)}</ul></details></li>
        ))}</ul>
      )}
      <p className="text-xs text-muted">Kart okutmalarından hesaplanır; eksik okutmalar sonucu etkiler. Ara dinlenmesi (md. 68: 7,5 saati aşan işte en az 1 saat) okutmalardan izlenemez; vardiya tanımındaki mola süresine göre düşülür.</p>
    </Card>
  );
}

