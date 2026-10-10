import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { HAZARD_LABEL } from "@/lib/compliance";
import { CERT_OK, FULL_TIME, KATIP_STATUS, KATIP_URL, KIND_LABEL, MINUTES, hm, requiredMinutes } from "@/lib/isg";
import { addVisit, deleteRow, saveAssignment, saveCompanyIsg, saveProfessional, setAssignmentStatus, toggleProfessional } from "@/lib/isg-actions";
import { isgBase, signedMap } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
type Pro = { id: string; kind: "uzman" | "hekim" | "dsp"; full_name: string; certificate_class: string | null; certificate_no: string | null; phone: string | null; email: string | null; osgb_name: string | null; osgb_no: string | null; user_id: string | null; active: boolean };
type Asg = { id: string; professional_id: string; start_date: string; end_date: string | null; monthly_minutes: number; katip_status: string; katip_no: string | null; sent_on: string | null; approved_on: string | null; document_path: string | null; note: string | null };

/** İSG-KATİP görevlendirme ve sözleşme takibi; çalışan sayısına göre süre yeterliliği; ziyaret kayıtları */
export default async function KatipPage() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const today = todayIso();
  const month = today.slice(0, 7);
  const base = await isgBase(supabase);
  const [{ data: pros, error }, { data: asgs }, { data: visits }, { data: dir }] = await Promise.all([
    supabase.from("isg_professionals").select("*").order("kind").order("full_name"),
    supabase.from("isg_assignments").select("*").order("start_date", { ascending: false }),
    supabase.from("isg_visits").select("id, professional_id, visit_date, minutes, topics").gte("visit_date", `${month}-01`).order("visit_date", { ascending: false }),
    supabase.rpc("company_directory"),
  ]);
  if (error) return (<><PageHeader title="İSG-KATİP" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const P = (pros ?? []) as Pro[];
  const A = (asgs ?? []) as Asg[];
  const proOf = new Map(P.map((p) => [p.id, p]));
  const live = (a: Asg) => a.katip_status === "onayli" && a.start_date <= today && (!a.end_date || a.end_date >= today);
  const safetyUsers = ((dir ?? []) as Array<{ user_id: string; display_name: string; role: string }>).filter((u) => u.role === "safety");
  const docs = await signedMap(supabase, A.map((a) => a.document_path));
  const rows = (["uzman", "hekim", "dsp"] as const).map((k) => {
    const req = requiredMinutes(k, base.hazard, base.workers);
    const act = A.filter((a) => live(a) && proOf.get(a.professional_id)?.kind === k);
    const assigned = act.reduce((x, a) => x + a.monthly_minutes, 0);
    const done = (visits ?? []).filter((v) => proOf.get(v.professional_id)?.kind === k).reduce((x, v) => x + v.minutes, 0);
    return { k, req, assigned, done, act };
  });
  const alerts: string[] = [];
  for (const r of rows) {
    if (r.req === 0) continue;
    if (!r.act.length) alerts.push(`${KIND_LABEL[r.k]} için onaylı ve yürürlükte İSG-KATİP sözleşmesi yok. Görevlendirme yapılmaması her ay tekrarlanan idari para cezası gerektirir (6331 md. 26).`);
    else if (r.assigned < r.req) alerts.push(`${KIND_LABEL[r.k]}: sözleşmedeki süre ${hm(r.assigned)}, gereken ${hm(r.req)} (${base.workers} çalışan). Sözleşme süresini İSG-KATİP'te güncelleyin.`);
  }
  for (const k of ["uzman", "hekim"] as const) if (base.workers >= FULL_TIME[k][base.hazard]) alerts.push(`${base.workers} çalışanla ${KIND_LABEL[k].toLocaleLowerCase("tr")} tam süreli görevlendirilmelidir.`);
  for (const a of A.filter(live)) {
    const p = proOf.get(a.professional_id);
    if (p?.kind === "uzman" && p.certificate_class && !CERT_OK[base.hazard].includes(p.certificate_class)) alerts.push(`${p.full_name} ${p.certificate_class} sınıfı belgeli; ${HAZARD_LABEL[base.hazard].toLocaleLowerCase("tr")} işyerinde ${CERT_OK[base.hazard].join(" / ")} sınıfı gerekir.`);
    if (a.end_date && a.end_date <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)) alerts.push(`${p?.full_name} sözleşmesi ${formatDate(a.end_date)} tarihinde bitiyor; yenisini İSG-KATİP'te başlatın.`);
  }
  for (const a of A.filter((x) => x.katip_status === "onay-bekliyor")) alerts.push(`${proOf.get(a.professional_id)?.full_name} sözleşmesi İSG-KATİP'te onay bekliyor${a.sent_on ? ` (${formatDate(a.sent_on)} tarihinden beri)` : ""}. Süresinde onaylanmazsa sistem iptal eder.`);
  return (
    <>
      <PageHeader title="İSG-KATİP" subtitle={`${HAZARD_LABEL[base.hazard]} · NACE ${base.nace ?? "—"} · ${base.workers} çalışan`} actions={<a href={KATIP_URL} target="_blank" rel="noopener" className={`${btn} grid place-items-center`}>İSG-KATİP&apos;i aç ↗</a>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <IsgNav active="/isg/katip" />
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {rows.map((r) => (
            <Stat key={r.k} label={KIND_LABEL[r.k]!} value={r.req ? `${hm(r.assigned)} / ${hm(r.req)}` : "Gerekmiyor"}
              sub={r.req ? <span className={r.assigned >= r.req ? "text-ok font-semibold" : "text-bad font-semibold"}>{r.assigned >= r.req ? "Süre yeterli" : `${hm(r.req - r.assigned)} eksik`} · bu ay ziyaret {hm(r.done)}</span> : "çok tehlikeli işyerinde 10+ çalışanda gerekir"} />
          ))}
        </div>
        {alerts.length > 0 && <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm flex flex-col gap-1">{alerts.map((a, i) => <p key={i}>⚠ {a}</p>)}</div>}
        <Card title="Süre hesabı">
          <p className="text-sm text-[#33414F]">Çalışan başına aylık en az süre ({HAZARD_LABEL[base.hazard].toLocaleLowerCase("tr")}): iş güvenliği uzmanı <b>{MINUTES.uzman[base.hazard]} dk</b>, işyeri hekimi <b>{MINUTES.hekim[base.hazard]} dk</b>{base.hazard === "COK" ? <>, diğer sağlık personeli <b>{base.workers < 50 ? 10 : 15} dk</b></> : null}. Uzman belge sınıfı: <b>{CERT_OK[base.hazard].join(" / ")}</b>. Tam süreli görevlendirme: uzman {FULL_TIME.uzman[base.hazard]}+, hekim {FULL_TIME.hekim[base.hazard]}+ çalışan.</p>
          {s.role === "owner" && (
            <form action={saveCompanyIsg} className="flex flex-wrap gap-2 items-end text-sm">
              <label className="flex flex-col gap-1 text-muted text-xs">NACE kodu<input name="nace_code" defaultValue={base.nace ?? ""} className={`${input} w-32`} /></label>
              <label className="flex flex-col gap-1 text-muted text-xs">Tehlike sınıfı<select name="hazard_class" defaultValue={base.hazard} className={`${input} w-44`}><option value="COK">Çok tehlikeli</option><option value="TEHLIKELI">Tehlikeli</option><option value="AZ">Az tehlikeli</option></select></label>
              <PendingSubmit className={btn}>Kaydet</PendingSubmit>
            </form>
          )}
        </Card>
        <Card title="İSG profesyonelleri ve sözleşmeler">
          {P.length === 0 && <p className="text-sm text-muted">Henüz kayıt yok. OSGB&apos;den görevlendirilen uzman, hekim ve sağlık personelini ekleyin.</p>}
          <div className="flex flex-col gap-3">{P.map((p) => {
            const mine = A.filter((a) => a.professional_id === p.id);
            const done = (visits ?? []).filter((v) => v.professional_id === p.id).reduce((x, v) => x + v.minutes, 0);
            const cur = mine.find(live);
            return (
              <div key={p.id} className={`rounded-xl border border-line p-3 flex flex-col gap-2 ${p.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap justify-between gap-2 items-baseline">
                  <div><b>{p.full_name}</b> <span className="text-sm text-muted">· {KIND_LABEL[p.kind]}{p.certificate_class ? ` (${p.certificate_class} sınıfı)` : ""}{p.certificate_no ? ` · belge ${p.certificate_no}` : ""}</span></div>
                  <div className="text-xs text-muted">{[p.osgb_name, p.phone, p.email].filter(Boolean).join(" · ")}{p.user_id ? " · uygulama hesabı bağlı" : ""}</div>
                </div>
                {cur && <div className="text-sm">Bu ay ziyaret: <b>{hm(done)}</b> / sözleşme {hm(cur.monthly_minutes)} <span className="inline-block align-middle w-28 h-2 rounded-full bg-[#EEF2F6] overflow-hidden ml-1"><span className={`block h-full ${done >= cur.monthly_minutes ? "bg-[#1A7F52]" : "bg-[#E8A33D]"}`} style={{ width: `${Math.min(100, (done / cur.monthly_minutes) * 100)}%` }} /></span></div>}
                <ul className="text-sm divide-y divide-[#EEF2F6]">{mine.map((a) => { const [l, c] = KATIP_STATUS[a.katip_status] ?? ["", ""]; return (
                  <li key={a.id} className="py-1.5 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-[220px] num">{formatDate(a.start_date)} – {a.end_date ? formatDate(a.end_date) : "süresiz"} · {hm(a.monthly_minutes)}/ay{a.katip_no ? ` · no ${a.katip_no}` : ""}{a.document_path && docs.get(a.document_path) ? <> · <a href={docs.get(a.document_path)} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold">sözleşme</a></> : null}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>
                    {can && a.katip_status === "onay-bekliyor" && <form action={setAssignmentStatus}><input type="hidden" name="id" value={a.id} /><PendingSubmit name="status" value="onayli" className="h-8 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">İSG-KATİP&apos;te onaylandı</PendingSubmit></form>}
                    {can && a.katip_status === "onayli" && <form action={setAssignmentStatus}><input type="hidden" name="id" value={a.id} /><PendingSubmit name="status" value="sona-erdi" className="h-8 px-2 rounded-lg border border-[#D5DEE8] text-xs">Sona erdi</PendingSubmit></form>}
                  </li>
                ); })}</ul>
                {can && (
                  <details className="text-sm"><summary className="cursor-pointer text-brand-700 font-semibold">Sözleşme ekle</summary>
                    <form action={saveAssignment} className="grid gap-2 sm:grid-cols-3 mt-2" encType="multipart/form-data">
                      <input type="hidden" name="professional_id" value={p.id} />
                      <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="date" name="start_date" required className={input} /></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="date" name="end_date" className={input} /></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">Aylık süre (dk) · gereken {requiredMinutes(p.kind, base.hazard, base.workers)}<input name="monthly_minutes" inputMode="numeric" required defaultValue={requiredMinutes(p.kind, base.hazard, base.workers) || ""} className={input} /></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">İSG-KATİP durumu<select name="katip_status" className={input}><option value="onay-bekliyor">Onay bekliyor</option><option value="onayli">Onaylı</option></select></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">Sözleşme no<input name="katip_no" className={input} /></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">Sözleşme dosyası<input type="file" name="file" accept="application/pdf,image/*" className="text-sm" /></label>
                      <PendingSubmit className={`${btn} sm:col-span-3 justify-self-start`}>Kaydet</PendingSubmit>
                    </form>
                  </details>
                )}
                {can && <form action={toggleProfessional}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "0" : "1"} /><PendingSubmit className="text-xs text-muted underline">{p.active ? "Pasife al" : "Aktif yap"}</PendingSubmit></form>}
              </div>
            );
          })}</div>
          {can && (
            <details className="rounded-xl border border-dashed border-[#B9C7D6] p-3"><summary className="cursor-pointer font-semibold text-brand-700">Yeni İSG profesyoneli</summary>
              <form action={saveProfessional} className="grid gap-2 sm:grid-cols-3 mt-3 text-sm">
                <select name="kind" required className={input} aria-label="Tür"><option value="uzman">İş güvenliği uzmanı</option><option value="hekim">İşyeri hekimi</option><option value="dsp">Diğer sağlık personeli</option></select>
                <input name="full_name" required placeholder="Ad soyad" className={input} aria-label="Ad soyad" />
                <select name="certificate_class" className={input} aria-label="Belge sınıfı" defaultValue=""><option value="">Belge sınıfı (uzman)</option><option>A</option><option>B</option><option>C</option></select>
                <input name="certificate_no" placeholder="Belge no" className={input} aria-label="Belge no" />
                <input name="osgb_name" placeholder="OSGB adı" className={input} aria-label="OSGB" />
                <input name="osgb_no" placeholder="OSGB yetki no" className={input} aria-label="OSGB yetki no" />
                <input name="phone" placeholder="Telefon" className={input} aria-label="Telefon" />
                <input name="email" placeholder="E-posta" className={input} aria-label="E-posta" />
                <select name="user_id" className={input} aria-label="Uygulama hesabı" defaultValue=""><option value="">Uygulama hesabı (İSG rolü)</option>{safetyUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select>
                <PendingSubmit className={`${btn} sm:col-span-3 justify-self-start`}>Ekle</PendingSubmit>
              </form>
              <p className="text-xs text-muted mt-2">Uzman veya hekimin uygulamaya girip ziyaret ve tespit kaydı yapabilmesi için Yönetim → Kullanıcılar&apos;dan &quot;İSG&quot; rolüyle davet edin.</p>
            </details>
          )}
        </Card>
        <Card title={`Bu ayın ziyaretleri · ${(visits ?? []).length} kayıt`}>
          {can && P.length > 0 && (
            <form action={addVisit} className="grid gap-2 sm:grid-cols-[1.3fr_1fr_.7fr_2fr_auto] items-end text-sm">
              <select name="professional_id" required className={input} aria-label="Kişi">{P.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({KIND_LABEL[p.kind]})</option>)}</select>
              <input type="date" name="visit_date" required defaultValue={today} className={input} aria-label="Tarih" />
              <input name="hours" inputMode="decimal" required placeholder="Saat" className={input} aria-label="Süre (saat)" />
              <input name="topics" placeholder="Yapılan işler (saha turu, eğitim, muayene…)" className={input} aria-label="Yapılanlar" />
              <PendingSubmit className={btn}>Ekle</PendingSubmit>
            </form>
          )}
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(visits ?? []).map((v) => (
            <li key={v.id} className="py-1.5 flex flex-wrap gap-2 items-center"><span className="num w-24">{formatDate(v.visit_date)}</span><b className="flex-1 min-w-40">{proOf.get(v.professional_id)?.full_name}</b><span className="num">{hm(v.minutes)}</span><span className="text-muted w-full sm:w-auto">{v.topics}</span>
              {can && <form action={deleteRow}><input type="hidden" name="table" value="isg_visits" /><input type="hidden" name="id" value={v.id} /><ConfirmSubmit label="Sil" /></form>}</li>
          ))}{(visits ?? []).length === 0 && <li className="py-3 text-muted">Bu ay ziyaret kaydı yok.</li>}</ul>
          <p className="text-xs text-muted">İSG-KATİP yalnız sözleşmeyi gösterir; fiilen gelinen süreyi bu kayıtlar gösterir. Uzman ve hekim telefonundan kendi ziyaretini girebilir.</p>
        </Card>
      </div>
    </>
  );
}
