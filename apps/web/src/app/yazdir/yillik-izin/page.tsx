import { formatTL } from "@mb/core";
import { PrintButton } from "@/components/PrintButton";
import { fmtDays, loadLeaveData, returnDate, type LeaveData, type LeaveEmp } from "@/lib/annual-leave";
import { logAccess } from "@/lib/kvkk";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dailyWages } from "../../(app)/yillik-izin/load";

export const dynamic = "force-dynamic";
const d = (iso?: string | null) => (iso ? formatDate(iso.slice(0, 10)) : "……/……/………");
const MANAGERS = ["owner", "accountant", "hr", "branch_manager"];

/**
 * Yıllık izin belgeleri
 *  ?tur=form&id=…           izin talep ve onay formu (her izin türü; bölünmüş izin ve yol izni beyanı dâhil)
 *  ?tur=isbasi&id=…         izin dönüşü işbaşı belgesi
 *  ?tur=kayit[&personel=…][&yil=…]  yıllık ücretli izin kayıt belgesi (Yönetmelik)
 *  ?tur=ucret&personel=…[&tarih=…]  ayrılışta kullanılmayan izin ücreti hesabı (md. 59)
 *  ?tur=toplu&id=…          toplu izin duyurusu ve tebliğ listesi
 */
export default async function LeavePrint({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const manager = MANAGERS.includes(s.role);
  const { data: self } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  const data = await loadLeaveData(supabase, today, { includeTerminated: true });
  const emp = new Map(data.emps.map((e) => [e.id, e]));
  const [{ data: privs }, { data: extra }] = await Promise.all([
    supabase.from("employee_private").select("employee_id, national_id"),
    supabase.from("employees").select("id, position_title, job_titles(name)"),
  ]);
  const tc = new Map((privs ?? []).map((p) => [p.employee_id as string, p.national_id as string | null]));
  const title = new Map((extra ?? []).map((x) => [x.id as string, ((x.job_titles as unknown as { name: string } | null)?.name ?? (x.position_title as string | null)) || ""]));
  const allowed = (empId: string) => manager || empId === self?.id;
  let pages: React.ReactNode[] = [];
  let label = "";

  if ((sp.tur === "form" || sp.tur === "isbasi") && sp.id) {
    const { data: r } = await supabase.from("leave_requests").select("id, employee_id, start_date, end_date, days, status, stage, note, travel_days, destination, chief_by, chief_at, decided_by, decided_at, decision_note, substitute_employee_id, created_at, recalled_at, recall_note, leave_types(code, name, paid)").eq("id", sp.id).maybeSingle();
    if (r && allowed(r.employee_id)) {
      const e = emp.get(r.employee_id)!;
      const t = r.leave_types as unknown as { code: string; name: string; paid: boolean };
      const yearly = t.code === "YILLIK";
      const l = data.ledgers.get(e.id);
      const counted = r.status === "approved" && yearly;
      const before = l ? (counted ? l.balance + Number(r.days) : l.balance) : null;
      const back = returnDate(r.end_date, data.hol, r.travel_days ?? 0);
      const sub = r.substitute_employee_id ? emp.get(r.substitute_employee_id) : null;
      const userIds = [r.chief_by, r.decided_by].filter(Boolean) as string[];
      const { data: people } = userIds.length ? await supabase.rpc("company_directory") : { data: [] };
      const pname = new Map(((people ?? []) as Array<{ user_id: string; display_name: string }>).map((p) => [p.user_id, p.display_name]));
      await logAccess(supabase, s.companyId, s.userId, "download", "leave_requests", r.id, sp.tur);
      label = `${e.first_name} ${e.last_name} · ${t.name}`;
      if (sp.tur === "form") {
        pages = [
          <Sheet key="f" title={yearly ? "YILLIK ÜCRETLİ İZİN TALEP VE ONAY FORMU" : `${t.name.replace(/\s*\(.*\)/, "").toLocaleUpperCase("tr")} TALEP VE ONAY FORMU`} company={s.companyName}>
            <Who e={e} tc={tc.get(e.id)} title={title.get(e.id)} l={l} />
            <h3 className="font-semibold mt-4 mb-1">İzin bilgileri</h3>
            <Grid rows={[
              ["İzin türü", `${t.name}${t.paid ? " (ücretli)" : " (ücretsiz)"}`],
              ["Başlangıç – bitiş", `${d(r.start_date)} – ${d(r.end_date)}`],
              ["İzin süresi", `${fmtDays(Number(r.days))} ${yearly ? "iş günü" : "gün"}`],
              ...(r.travel_days ? [["Yol izni (ücretsiz)", `${r.travel_days} gün${r.destination ? ` · ${r.destination}` : ""}`] as [string, string]] : []),
              ["İşe başlama tarihi", d(back)],
              ["Vekil", sub ? `${sub.first_name} ${sub.last_name}` : "—"],
              ...(yearly && before !== null ? [["Kalan izin (izin öncesi → sonrası)", `${fmtDays(before)} → ${fmtDays(before - Number(r.days))} gün`] as [string, string]] : []),
            ]} />
            <p className="mt-4 leading-relaxed">
              {yearly
                ? <>Yukarıda belirtilen tarihler arasında <b>{fmtDays(Number(r.days))} iş günü</b> yıllık ücretli iznimi kullanmak istiyorum.</>
                : <>Yukarıda belirtilen tarihler arasında <b>{t.name.toLocaleLowerCase("tr")}</b> kullanmak istiyorum.</>}
              {yearly && Number(r.days) < 10 && <> 4857 sayılı İş Kanunu&apos;nun 56. maddesi uyarınca yıllık ücretli iznimin, bir bölümü on günden az olmamak üzere bölümler hâlinde kullandırılmasını talep ederim.</>}
              {r.travel_days ? <> İznimi işyerinin bulunduğu yerden başka bir yerde ({r.destination ?? "………………"}) geçireceğimden, gidiş-dönüş için {r.travel_days} gün ücretsiz yol izni verilmesini talep ederim.</> : null}
              {" "}Gereğini saygılarımla arz ederim.
            </p>
            {r.note && <p className="mt-2 text-[12.5px]"><b>Açıklama:</b> {r.note}</p>}
            <p className="mt-2 text-[12.5px]">İzin süresince ulaşılabileceğim adres / telefon: …………………………………………………………………</p>
            <div className="mt-5 grid grid-cols-3 gap-6 text-center text-[12px]">
              <Sign label="Talep eden" name={`${e.first_name} ${e.last_name}`} date={d(r.created_at)} />
              <Sign label="Bölüm şefi (uygundur)" name={r.chief_by ? pname.get(r.chief_by) ?? "" : ""} date={r.chief_at ? d(r.chief_at) : undefined} />
              <Sign label="İnsan kaynakları (onay)" name={r.status === "approved" && r.decided_by ? pname.get(r.decided_by) ?? "" : ""} date={r.status === "approved" ? d(r.decided_at) : undefined} />
            </div>
            <div className="mt-5 rounded border border-[#C5D0DC] p-3 text-[12px]">
              <b>Durum:</b> {r.status === "approved" ? `Onaylandı (${d(r.decided_at)})` : r.status === "rejected" ? `Reddedildi${r.decision_note ? ` · ${r.decision_note}` : ""}` : r.status === "cancelled" ? "İptal edildi" : r.stage === "chief" ? "Şef onayı bekliyor" : "İK onayı bekliyor"}
              {r.recalled_at && <> · {d(r.recalled_at)} tarihinde izinden geri çağrıldı{r.recall_note ? ` (${r.recall_note})` : ""}</>}
              {yearly && <p className="mt-1 text-[#5A6878]">İzin ücreti izne çıkmadan önce peşin veya avans olarak ödenir (İş K. md. 57). İzin süresince ücret karşılığı başka bir işte çalışılamaz (md. 58).</p>}
            </div>
          </Sheet>,
        ];
      } else {
        pages = [
          <Sheet key="i" title="İZİN DÖNÜŞÜ İŞBAŞI BELGESİ" company={s.companyName}>
            <Who e={e} tc={tc.get(e.id)} title={title.get(e.id)} l={l} />
            <Grid rows={[["İzin türü", t.name], ["İzin tarihleri", `${d(r.start_date)} – ${d(r.end_date)} (${fmtDays(Number(r.days))} gün)`], ...(r.travel_days ? [["Yol izni", `${r.travel_days} gün`] as [string, string]] : []), ["Planlanan işbaşı", d(back)], ["Fiilî işbaşı tarihi / saati", "……/……/………   ……:……"]]} />
            <p className="mt-4 leading-relaxed">Yukarıda belirtilen iznimi kullanarak işbaşı yaptım. İzin süresince ücret karşılığı başka bir işte çalışmadığımı beyan ederim.</p>
            {l && <p className="mt-2 text-[12.5px]">Güncel kalan yıllık izin: <b>{fmtDays(l.balance)} gün</b></p>}
            <div className="mt-8 grid grid-cols-2 gap-10 text-center text-[12px]">
              <Sign label="İşbaşı yapan" name={`${e.first_name} ${e.last_name}`} />
              <Sign label="Bölüm şefi / İK" name="" />
            </div>
          </Sheet>,
        ];
      }
    }
  }

  if (sp.tur === "kayit") {
    const ids = sp.personel ? [sp.personel] : manager ? data.emps.filter((e) => e.status !== "terminated" && e.hire_date).map((e) => e.id) : self ? [self.id] : [];
    const year = sp.yil ? Number(sp.yil) : null;
    label = sp.personel ? `${emp.get(sp.personel)?.first_name ?? ""} ${emp.get(sp.personel)?.last_name ?? ""} · izin kayıt belgesi` : `İzin kayıt belgeleri${year ? ` · ${year}` : ""}`;
    pages = ids.filter(allowed).map((id) => emp.get(id)).filter((e): e is LeaveEmp => !!e && !!data.ledgers.get(e.id)).map((e) => <KayitSheet key={e.id} e={e} data={data} company={s.companyName} tc={tc.get(e.id)} title={title.get(e.id)} year={year} />);
    if (sp.personel) await logAccess(supabase, s.companyId, s.userId, "download", "leave_ledger", sp.personel, "kayıt belgesi");
  }

  if (sp.tur === "ucret" && sp.personel && ["owner", "accountant", "hr"].includes(s.role)) {
    const e = emp.get(sp.personel);
    const on = sp.tarih && /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih) ? sp.tarih : e?.termination_date ?? today;
    const data2 = on === today ? data : await loadLeaveData(supabase, on, { includeTerminated: true });
    const l = data2.ledgers.get(sp.personel);
    if (e && l) {
      const w = (await dailyWages(supabase, { ...data2, emps: [e] }, on)).get(e.id);
      const days = Math.max(0, l.balance);
      label = `${e.first_name} ${e.last_name} · izin ücreti`;
      await logAccess(supabase, s.companyId, s.userId, "download", "leave_payout", e.id, on);
      pages = [
        <Sheet key="u" title="KULLANILMAYAN YILLIK İZİN ÜCRETİ HESAP TABLOSU" company={s.companyName}>
          <Who e={e} tc={tc.get(e.id)} title={title.get(e.id)} l={l} />
          <form className="print:hidden my-3 flex gap-2 items-center text-sm"><input type="hidden" name="tur" value="ucret" /><input type="hidden" name="personel" value={e.id} /><label>Ayrılış tarihi <input type="date" name="tarih" defaultValue={on} className="h-9 rounded border border-[#C5D0DC] px-2" /></label><button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">Hesapla</button></form>
          <Grid rows={[["Ayrılış tarihi", d(on)], ["Hizmet yılı", `${l.completedYears} yıl`], ["Hak edilen toplam", `${fmtDays(l.earned)} gün`], ["Devir / düzeltme", `${fmtDays(l.adjust)} gün`], ["Kullanılan", `${fmtDays(l.used)} gün`], ["Ödenecek gün", `${fmtDays(days)} gün`]]} />
          <table className="w-full mt-4 text-[13px] border-collapse">
            <tbody>
              <tr><td className="border border-[#9AA7B5] px-2 py-1.5">Son brüt ücret (aylık)</td><td className="border border-[#9AA7B5] px-2 text-right num">{w ? formatTL(w.official * 30) : "Sözleşme ücreti yok"}</td></tr>
              <tr><td className="border border-[#9AA7B5] px-2 py-1.5">Günlük brüt ücret (aylık / 30)</td><td className="border border-[#9AA7B5] px-2 text-right num">{w ? formatTL(w.official) : "—"}</td></tr>
              <tr className="font-bold"><td className="border border-[#9AA7B5] px-2 py-1.5">Brüt izin ücreti ({fmtDays(days)} gün × günlük brüt)</td><td className="border border-[#9AA7B5] px-2 text-right num">{w ? formatTL(w.official * days) : "—"}</td></tr>
            </tbody>
          </table>
          <p className="text-[11.5px] text-[#5A6878] mt-3">İş K. md. 59: iş sözleşmesi herhangi bir nedenle sona erdiğinde, kullanılmayan yıllık izin süresine ait ücret, sözleşmenin sona erdiği tarihteki ücret üzerinden ödenir. Brüt tutardan SGK primi, gelir vergisi ve damga vergisi kesilir; bordroda &quot;izin ücreti&quot; olarak gösterilir. Zamanaşımı sözleşmenin bitiminden itibaren 5 yıldır.</p>
          {w && w.real > w.official + 1 && <div className="print:hidden mt-3 rounded bg-[#FFF4E0] text-[#8A5A00] p-3 text-sm">İç bilgi (yazdırılmaz): elden ödenen dâhil gerçek ücrete göre tutar <b>{formatTL(w.real * days)}</b>. Dava hâlinde mahkeme gerçek ücreti esas alır.</div>}
          <div className="mt-8 grid grid-cols-2 gap-10 text-center text-[12px]"><Sign label="Hazırlayan (İK / muhasebe)" name="" /><Sign label="Okudum, öğrendim" name={`${e.first_name} ${e.last_name}`} /></div>
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "toplu" && sp.id && manager) {
    const { data: c } = await supabase.from("collective_leaves").select("id, title, start_date, end_date, note").eq("id", sp.id).maybeSingle();
    if (c) {
      const list = (await supabase.from("leave_requests").select("employee_id, days").eq("collective_id", c.id)).data ?? [];
      label = c.title;
      const back = returnDate(c.end_date, data.hol);
      pages = [
        <Sheet key="t" title="TOPLU YILLIK İZİN DUYURUSU" company={s.companyName}>
          <p className="text-right">Tarih: {d(today)}</p>
          <p className="mt-3 leading-relaxed">Yıllık Ücretli İzin Yönetmeliği uyarınca, <b>{d(c.start_date)} – {d(c.end_date)}</b> tarihleri arasında toplu yıllık izin uygulanacaktır. Bu süre ({fmtDays(Number(list[0]?.days ?? 0))} iş günü) personelin yıllık ücretli izin hakkından düşülecektir. İşbaşı tarihi <b>{d(back)}</b>&apos;dir.</p>
          {c.note && <p className="mt-2">{c.note}</p>}
          <p className="mt-2">İzin ücretleri izin başlangıcından önce ödenecektir (md. 57). Duyurulur.</p>
          <h3 className="font-semibold mt-5 mb-1">Tebliğ listesi</h3>
          <table className="w-full text-[12.5px] border-collapse">
            <thead><tr className="bg-[#EEF3F9]">{["#", "Ad soyad", "Bölüm", "Kalan izin (sonrası)", "Tebliğ tarihi", "İmza"].map((h) => <th key={h} className="border border-[#9AA7B5] px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>{list.map((x, i) => { const e = emp.get(x.employee_id); return e ? <tr key={i}><td className="border border-[#9AA7B5] px-2 py-2">{i + 1}</td><td className="border border-[#9AA7B5] px-2">{e.first_name} {e.last_name}</td><td className="border border-[#9AA7B5] px-2">{e.dept}</td><td className="border border-[#9AA7B5] px-2 text-right">{fmtDays(data.ledgers.get(e.id)?.balance ?? 0)}</td><td className="border border-[#9AA7B5] px-2 w-24" /><td className="border border-[#9AA7B5] px-2 w-28" /></tr> : null; })}</tbody>
          </table>
          <div className="mt-8 text-right text-[12px]"><div className="inline-block w-60 text-center"><div className="h-12" /><div className="border-t border-black pt-1">İşveren / vekili</div></div></div>
        </Sheet>,
      ];
    }
  }

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[#14202E]">
      <style>{`@page { size: A4; margin: 12mm; } .sheet { break-after: page; } .sheet:last-child { break-after: auto; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 md:px-6 py-3 flex flex-wrap items-center gap-3">
        <span className="font-semibold">{label || "Belge bulunamadı veya yetkiniz yok"}{pages.length > 1 ? ` · ${pages.length} sayfa` : ""}</span>
        {pages.length > 0 && <PrintButton />}
      </div>
      <div className="max-w-[186mm] mx-auto py-6 print:py-0 px-3 print:px-0 flex flex-col gap-6 print:gap-0">{pages}</div>
    </main>
  );
}

function KayitSheet({ e, data, company, tc, title, year }: { e: LeaveEmp; data: LeaveData; company: string; tc?: string | null; title?: string; year: number | null }) {
  const l = data.ledgers.get(e.id)!;
  const used = data.rows.filter((r) => r.employee_id === e.id && r.status === "approved" && r.code === "YILLIK" && (!year || r.start_date.startsWith(String(year)))).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const c = "border border-[#9AA7B5] px-1.5 py-1";
  return (
    <Sheet title={`YILLIK ÜCRETLİ İZİN KAYIT BELGESİ${year ? ` · ${year}` : ""}`} company={company}>
      <Who e={e} tc={tc} title={title} l={l} />
      <h3 className="font-semibold mt-3 mb-1 text-[13px]">Hak edişler</h3>
      <table className="w-full text-[11.5px] border-collapse">
        <thead><tr className="bg-[#EEF3F9]">{["Hizmet yılı", "Hak ediş tarihi", "Önceki yıl çalışılmayan gün", "Yaş", "İzin süresi (iş günü)", "Kullanılan", "Kalan"].map((h) => <th key={h} className={`${c} text-left`}>{h}</th>)}</tr></thead>
        <tbody>
          {l.adjust !== 0 && <tr><td className={c} colSpan={4}>Devir / açılış bakiyesi</td><td className={`${c} text-right`}>{fmtDays(l.opening.days)}</td><td className={`${c} text-right`}>{fmtDays(l.opening.used)}</td><td className={`${c} text-right`}>{fmtDays(l.opening.left)}</td></tr>}
          {l.years.map((y) => <tr key={y.k}><td className={c}>{y.k}</td><td className={c}>{d(y.date)}</td><td className={`${c} text-right`}>{y.gapDays || "—"}</td><td className={`${c} text-right`}>{y.age ?? "—"}</td><td className={`${c} text-right`}>{y.days}</td><td className={`${c} text-right`}>{fmtDays(y.used)}</td><td className={`${c} text-right`}>{fmtDays(y.left)}</td></tr>)}
          <tr className="font-semibold"><td className={c} colSpan={4}>Toplam</td><td className={`${c} text-right`}>{fmtDays(l.earned + l.adjust)}</td><td className={`${c} text-right`}>{fmtDays(l.used)}</td><td className={`${c} text-right`}>{fmtDays(l.balance)}</td></tr>
        </tbody>
      </table>
      <h3 className="font-semibold mt-4 mb-1 text-[13px]">Kullanılan izinler</h3>
      <table className="w-full text-[11.5px] border-collapse">
        <thead><tr className="bg-[#EEF3F9]">{["#", "İzne başlama", "İzin bitişi", "İşe dönüş", "Gün", "Yol izni", "İşçinin imzası"].map((h) => <th key={h} className={`${c} text-left`}>{h}</th>)}</tr></thead>
        <tbody>
          {used.map((r, i) => <tr key={r.id}><td className={c}>{i + 1}</td><td className={c}>{d(r.start_date)}</td><td className={c}>{d(r.end_date)}</td><td className={c}>{d(returnDate(r.end_date, data.hol, r.travel_days))}</td><td className={`${c} text-right`}>{fmtDays(r.days)}</td><td className={`${c} text-right`}>{r.travel_days || "—"}</td><td className={`${c} w-28`} /></tr>)}
          {Array.from({ length: Math.max(0, 3 - used.length) }, (_, i) => <tr key={`b${i}`}>{Array.from({ length: 7 }, (_, j) => <td key={j} className={`${c} py-3`} />)}</tr>)}
        </tbody>
      </table>
      <p className="text-[10.5px] text-[#5A6878] mt-2">Yıllık Ücretli İzin Yönetmeliği uyarınca işveren, işyerinde çalışan her işçi için izin kayıt belgesi tutmak zorundadır. İzin süresine pazar ve resmi tatiller eklenmez; ücretsiz izin ve hizmete sayılmayan süreler hak ediş tarihini öteler.</p>
      <div className="mt-6 grid grid-cols-2 gap-10 text-center text-[12px]"><Sign label="İşveren / vekili" name="" /><Sign label="İşçi" name={`${e.first_name} ${e.last_name}`} /></div>
    </Sheet>
  );
}

function Sheet({ title, company, children }: { title: string; company: string; children: React.ReactNode }) {
  return (
    <section className="sheet bg-white border border-[#C5D0DC] print:border-0 rounded-lg print:rounded-none p-6 md:p-8 print:p-0 text-[13px]">
      <header className="flex justify-between items-center gap-3 border-b-2 border-[#0A3D73] pb-2 mb-3">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-10 h-10 object-contain" />
          <b>{company}</b>
        </div>
        <span className="font-bold text-[13.5px] text-right">{title}</span>
      </header>
      {children}
    </section>
  );
}
function Grid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <div className="grid sm:grid-cols-2 gap-x-6">{rows.map(([k, v]) => <div key={k} className="flex gap-3 py-1 border-b border-[#EEF2F6]"><span className="w-44 shrink-0 text-[#5A6878]">{k}</span><span className="font-semibold">{v}</span></div>)}</div>;
}
function Who({ e, tc, title, l }: { e: LeaveEmp; tc?: string | null; title?: string; l?: ReturnType<LeaveData["ledgers"]["get"]> }) {
  return <Grid rows={[["Adı soyadı", `${e.first_name} ${e.last_name}`], ["TC kimlik no", tc ?? "—"], ["Bölüm", e.dept], ["Görevi", title || "—"], ["İşe giriş tarihi", d(e.hire_date)], ["Sicil / kart no", e.card_no ?? "—"], ...(l && l.base !== e.hire_date ? [["Kıdem başlangıcı", d(l.base)] as [string, string]] : [])]} />;
}
function Sign({ label, name, date }: { label: string; name: string; date?: string }) {
  return <div><div className="text-[#5A6878]">{label}</div><div className="h-12" /><div className="border-t border-black pt-1 font-semibold">{name || " "}</div>{date && <div className="text-[#5A6878]">{date}</div>}</div>;
}
