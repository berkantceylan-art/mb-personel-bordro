import Link from "next/link";
import { formatTL } from "@mb/core";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { addDaysIso, fmtDays, type LeaveData } from "@/lib/annual-leave";
import { formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addPlan, createCollective, deletePlanRow, importOpening, planToLeave, saveDeptLimits, setPlanStatus } from "./actions";
import { dailyWages, liability, yearsSince } from "./load";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
const btn2 = "h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm";
const th = "py-2 px-2 font-semibold text-left";
const td = "py-2 px-2 border-t border-[#EEF2F6]";
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/* ================================================================ Bakiyeler */
export function Bakiye({ data, today, q, dept }: { data: LeaveData; today: string; q?: string; dept?: string }) {
  const needle = (q ?? "").toLocaleLowerCase("tr");
  const list = data.emps.filter((e) => (!dept || e.department_id === dept) && (!needle || `${e.first_name} ${e.last_name} ${e.card_no ?? ""}`.toLocaleLowerCase("tr").includes(needle)));
  return (
    <Card title={`Yıllık izin bakiyeleri · ${list.length} personel`} action={<a href={`/yillik-izin/excel?tur=bakiye${dept ? `&bolum=${dept}` : ""}`} className="text-sm font-semibold text-brand-700">Excel</a>}>
      <form className="flex flex-wrap gap-2"><input type="hidden" name="sekme" value="bakiye" />
        <input name="q" defaultValue={q} placeholder="Ad veya kart no" className={`${input} flex-1 min-w-40`} aria-label="Ara" />
        <select name="bolum" defaultValue={dept ?? ""} className={input} aria-label="Bölüm"><option value="">Tüm bölümler</option>{data.depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <button className={btn2}>Filtrele</button></form>
      {/* Telefonda kart görünümü */}
      <ul className="md:hidden flex flex-col gap-2">{list.map((e) => {
        const l = data.ledgers.get(e.id);
        return (
          <li key={e.id}><Link href={`/yillik-izin/${e.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <div className="flex-1 min-w-0"><div className="font-semibold truncate">{e.first_name} {e.last_name}</div><div className="text-xs text-muted">{e.dept} · {l ? `${l.completedYears} yıl · sonraki ${formatDate(l.next.date)} +${l.next.days}` : "işe giriş yok"}</div></div>
            <div className={`num text-xl font-bold ${l && l.balance < 0 ? "text-bad" : "text-brand-800"}`}>{l ? fmtDays(l.balance) : "—"}</div>
          </Link></li>
        );
      })}</ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Personel</th><th className={th}>Bölüm</th><th className={th}>Kıdem başlangıcı</th><th className={`${th} text-right`}>Kıdem</th><th className={`${th} text-right`}>Hak edilen</th><th className={`${th} text-right`}>Devir / düzeltme</th><th className={`${th} text-right`}>Kullanılan</th><th className={`${th} text-right`}>Kalan</th><th className={th}>En eski açık hak</th><th className={th}>Sonraki hak ediş</th></tr></thead>
          <tbody>{list.map((e) => {
            const l = data.ledgers.get(e.id);
            if (!l) return <tr key={e.id}><td className={td}>{e.first_name} {e.last_name}</td><td className={td} colSpan={9}>İşe giriş tarihi yok</td></tr>;
            const old = l.oldestOpen && l.oldestOpen !== "devir" && yearsSince(l.oldestOpen, today) >= 2;
            return (
              <tr key={e.id}>
                <td className={td}><Link href={`/yillik-izin/${e.id}`} className="font-semibold text-brand-700">{e.first_name} {e.last_name}</Link></td>
                <td className={td}>{e.dept}</td>
                <td className={`${td} num`}>{formatDate(l.base)}{e.leave_seniority_start ? " *" : ""}</td>
                <td className={`${td} num text-right`}>{l.completedYears} yıl</td>
                <td className={`${td} num text-right`}>{fmtDays(l.earned)}</td>
                <td className={`${td} num text-right`}>{l.adjust ? fmtDays(l.adjust) : "—"}</td>
                <td className={`${td} num text-right`}>{fmtDays(l.used)}</td>
                <td className={`${td} num text-right font-bold ${l.balance < 0 ? "text-bad" : ""}`}>{fmtDays(l.balance)}</td>
                <td className={`${td} num ${old ? "text-bad font-semibold" : "text-muted"}`}>{l.oldestOpen === "devir" ? "devir" : l.oldestOpen ? formatDate(l.oldestOpen) : "—"}</td>
                <td className={`${td} num text-muted`}>{formatDate(l.next.date)} · +{l.next.days}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Hak ediş: her tamamlanan hizmet yılı için 1–5 yıl 14, 5–15 yıl 20, 15+ yıl 26 iş günü; 18 yaş ve altı ile 50 yaş ve üstüne en az 20 gün (md. 53). Ücretsiz izin ve girilen kesintiler hak ediş tarihini öteler. Kullanılan izin en eski haktan düşülür. * Kıdem başlangıcı düzeltilmiş.</p>
    </Card>
  );
}

/* ================================================================ Plan ve toplu izin */
export async function Plan({ data, year, today }: { data: LeaveData; year: number; today: string }) {
  const supabase = await createClient();
  const [{ data: plans }, { data: cols }] = await Promise.all([
    supabase.from("leave_plans").select("id, employee_id, start_date, end_date, days, note, status, source, created_at").eq("year", year).order("start_date"),
    supabase.from("collective_leaves").select("id, title, start_date, end_date, department_ids, created_at").order("start_date", { ascending: false }).limit(20),
  ]);
  const P = (plans ?? []) as Array<{ id: string; employee_id: string; start_date: string; end_date: string; days: number; note: string | null; status: string; source: string }>;
  const name = new Map(data.emps.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const dept = new Map(data.emps.map((e) => [e.id, e.dept]));
  const prefs = P.filter((p) => p.status === "tercih");
  const ok = P.filter((p) => p.status === "onayli");
  // Plan kapsamı: kalan izni olup bu yıl için planı / kullanımı olmayanlar
  const usedThisYear = new Set(data.rows.filter((r) => r.code === "YILLIK" && r.start_date.startsWith(String(year))).map((r) => r.employee_id));
  const plannedIds = new Set(P.filter((p) => p.status !== "reddedildi").map((p) => p.employee_id));
  const unplanned = data.emps.filter((e) => (data.ledgers.get(e.id)?.balance ?? 0) >= 10 && !plannedIds.has(e.id) && !usedThisYear.has(e.id));
  const nav = (y: number) => `/yillik-izin?sekme=plan&yil=${y}`;
  return (
    <>
      <div className="flex items-center gap-2 text-sm"><Link href={nav(year - 1)} className={btn2}>‹ {year - 1}</Link><b className="px-2">{year} yıllık izin planı</b><Link href={nav(year + 1)} className={btn2}>{year + 1} ›</Link></div>
      <Card title={`Personel tercihleri · ${prefs.length} bekliyor`}>
        <p className="text-xs text-muted">Personel, telefonundaki İzin bölümünden tercih ettiği tarihleri bildirir. Yönetmelik gereği izin dönemini işveren belirler; tercihleri bölüm doluluğuna göre onaylayın.</p>
        <ul className="text-sm divide-y divide-[#EEF2F6]">{prefs.map((p) => (
          <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[200px]"><b>{name.get(p.employee_id)}</b> <span className="text-muted">· {dept.get(p.employee_id)}</span><br /><span className="num">{formatDate(p.start_date)} – {formatDate(p.end_date)} · {fmtDays(Number(p.days))} gün</span>{p.note ? <span className="text-muted"> · {p.note}</span> : null}</span>
            <form action={setPlanStatus}><input type="hidden" name="id" value={p.id} /><PendingSubmit name="status" value="onayli" className={btn}>Plana al</PendingSubmit></form>
            <form action={setPlanStatus}><input type="hidden" name="id" value={p.id} /><PendingSubmit name="status" value="reddedildi" className={`${btn2} text-bad`}>Reddet</PendingSubmit></form>
          </li>
        ))}{prefs.length === 0 && <li className="py-3 text-muted">Bekleyen tercih yok.</li>}</ul>
      </Card>
      <Card title={`Onaylı plan · ${ok.length} kayıt`}>
        <form action={addPlan} className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-end text-sm">
          <select name="employee_id" required className={input} aria-label="Personel"><option value="">Personel</option>{data.emps.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
          <label className="flex flex-col gap-1 text-muted text-xs">Başlangıç<input type="date" name="start" required className={input} /></label>
          <label className="flex flex-col gap-1 text-muted text-xs">Bitiş<input type="date" name="end" required className={input} /></label>
          <input name="note" placeholder="Not" className={input} aria-label="Not" />
          <PendingSubmit className={btn}>Plana ekle</PendingSubmit>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Gün</th><th className={th}>Kaynak</th><th className={th} /></tr></thead>
          <tbody>{ok.map((p) => (
            <tr key={p.id}><td className={td}>{name.get(p.employee_id)} <span className="text-muted">· {dept.get(p.employee_id)}</span></td><td className={`${td} num`}>{formatDate(p.start_date)} – {formatDate(p.end_date)}</td><td className={`${td} num text-right`}>{fmtDays(Number(p.days))}</td><td className={`${td} text-muted`}>{p.source === "employee" ? "personel tercihi" : "İK"}</td>
              <td className={`${td} text-right whitespace-nowrap`}><form action={planToLeave} className="inline"><input type="hidden" name="id" value={p.id} /><PendingSubmit className="h-8 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">İzin kaydı oluştur</PendingSubmit></form> <form action={deletePlanRow} className="inline"><input type="hidden" name="id" value={p.id} /><PendingSubmit className="h-8 px-2 rounded-lg border border-[#D5DEE8] text-xs text-bad">Sil</PendingSubmit></form></td></tr>
          ))}{ok.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">Plan yok.</td></tr>}</tbody>
        </table></div>
      </Card>
      {unplanned.length > 0 && (
        <Card title={`Planı olmayan · ${unplanned.length} kişi (kalan ≥ 10 gün)`}>
          <ul className="text-sm grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4">{unplanned.map((e) => <li key={e.id} className="py-1 flex justify-between gap-2 border-b border-[#EEF2F6]"><Link href={`/yillik-izin/${e.id}`} className="text-brand-700">{e.first_name} {e.last_name}</Link><span className="num text-muted">{fmtDays(data.ledgers.get(e.id)!.balance)} gün</span></li>)}</ul>
        </Card>
      )}
      <Card title="Toplu izin">
        <p className="text-xs text-muted">Seçilen bölümlerdeki (seçilmezse tüm şirket) aktif personele onaylı yıllık izin işlenir, bakiyeden düşülür ve okundu onaylı duyuru yayınlanır. O tarihlerde zaten izni olanlar atlanır.</p>
        <form action={createCollective} className="grid gap-2 sm:grid-cols-4 items-end text-sm">
          <input name="title" placeholder="Başlık (ör. Bayram toplu izni)" className={`${input} sm:col-span-2`} aria-label="Başlık" />
          <label className="flex flex-col gap-1 text-muted text-xs">Başlangıç<input type="date" name="start" required min={today} className={input} /></label>
          <label className="flex flex-col gap-1 text-muted text-xs">Bitiş<input type="date" name="end" required min={today} className={input} /></label>
          <fieldset className="sm:col-span-4 flex flex-wrap gap-x-4 gap-y-1 border border-line rounded-lg p-2"><legend className="px-1 text-xs text-muted">Bölümler</legend>{data.depts.map((d) => <label key={d.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="dept" value={d.id} className="w-4 h-4" />{d.name}</label>)}</fieldset>
          <input name="note" placeholder="Duyuruya eklenecek not" className={`${input} sm:col-span-3`} aria-label="Not" />
          <ConfirmSubmit label="Toplu izni işle" question="Seçilen personele toplu yıllık izin işlenecek ve duyuru gönderilecek. Devam edilsin mi?" yes="Evet, işle" className={btn} />
        </form>
        {(cols ?? []).length > 0 && <ul className="text-sm divide-y divide-[#EEF2F6]">{(cols ?? []).map((c) => <li key={c.id} className="py-2 flex flex-wrap justify-between gap-2"><span><b>{c.title}</b> · <span className="num">{formatDate(c.start_date)} – {formatDate(c.end_date)}</span></span><a href={`/yazdir/yillik-izin?tur=toplu&id=${c.id}`} target="_blank" rel="noopener" className="text-brand-700 font-semibold text-xs">Duyuru ve imza listesi</a></li>)}</ul>}
      </Card>
    </>
  );
}

/* ================================================================ Raporlar */
export async function Rapor({ data, year, today }: { data: LeaveData; year: number; today: string }) {
  const supabase = await createClient();
  const wages = await dailyWages(supabase, data, today);
  const li = liability(data, wages);
  const yearly = data.rows.filter((r) => r.status === "approved" && r.code === "YILLIK");
  // Aylık dağılım (bu yıl, iş günü bazında yaklaşık: talep günleri başlangıç ayına)
  const byMonth = Array.from({ length: 12 }, () => 0);
  const byDept = new Map<string, number[]>();
  const deptOf = new Map(data.emps.map((e) => [e.id, e.dept]));
  for (const r of yearly) {
    if (!r.start_date.startsWith(String(year))) continue;
    const m = Number(r.start_date.slice(5, 7)) - 1;
    byMonth[m]! += r.days;
    const d = deptOf.get(r.employee_id) ?? "—";
    if (!byDept.has(d)) byDept.set(d, Array.from({ length: 12 }, () => 0));
    byDept.get(d)![m]! += r.days;
  }
  const max = Math.max(1, ...byMonth);
  const ago = addDaysIso(today, -365);
  const idle = data.emps.filter((e) => (data.ledgers.get(e.id)?.completedYears ?? 0) >= 1 && !yearly.some((r) => r.employee_id === e.id && r.start_date >= ago));
  const piled = data.emps.filter((e) => { const l = data.ledgers.get(e.id); return l && l.oldestOpen && l.oldestOpen !== "devir" && yearsSince(l.oldestOpen, today) >= 2; });
  const soon = data.emps.filter((e) => { const l = data.ledgers.get(e.id); return l && l.next.date <= addDaysIso(today, 90); });
  const R = ({ title, desc, tur, extra, children }: { title: string; desc: string; tur: string; extra?: string; children?: React.ReactNode }) => (
    <Card title={title} action={<a href={`/yillik-izin/excel?tur=${tur}&yil=${year}${extra ?? ""}`} className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-sm font-semibold text-brand-700 grid place-items-center">Excel indir</a>}>
      <p className="text-xs text-muted">{desc}</p>{children}
    </Card>
  );
  return (
    <>
      <div className="flex items-center gap-2 text-sm"><Link href={`/yillik-izin?sekme=rapor&yil=${year - 1}`} className={btn2}>‹ {year - 1}</Link><b className="px-2">{year}</b><Link href={`/yillik-izin?sekme=rapor&yil=${year + 1}`} className={btn2}>{year + 1} ›</Link></div>
      <div className="grid gap-4 md:grid-cols-2">
        <R title="İzin yükümlülüğü" desc="Kullanılmayan iznin bugünkü brüt ücretle karşılığı (md. 59: ayrılışta son ücretten ödenir). Gerçek ücret elden ödemeyi de kapsar." tur="yukumluluk">
          <div className="grid grid-cols-3 gap-2 text-center"><div><div className="num text-xl font-bold">{fmtDays(li.days)}</div><div className="text-xs text-muted">gün</div></div><div><div className="num text-xl font-bold">{formatTL(li.official)}</div><div className="text-xs text-muted">resmi brüt</div></div><div><div className="num text-xl font-bold text-[#8A5A00]">{formatTL(li.real)}</div><div className="text-xs text-muted">gerçek brüt</div></div></div>
        </R>
        <R title={`Aylık dağılım · ${year}`} desc="Onaylı yıllık izin günlerinin aylara dağılımı; bölüm kırılımı Excel'de." tur="aylik">
          <div className="flex items-end gap-1 h-28">{byMonth.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center gap-1"><span className="num text-[10px] text-muted">{v ? fmtDays(v) : ""}</span><div className="w-full rounded-t bg-[#2E9D6A]" style={{ height: `${(v / max) * 80}px` }} /><span className="text-[10px] text-muted">{MONTHS[i]}</span></div>)}</div>
        </R>
        <R title="Bakiye raporu" desc="Personel bazında kıdem, hak edilen, devir, kullanılan ve kalan izin." tur="bakiye" />
        <R title="Yıl yıl izin defteri" desc="Her personelin her hak ediş yılı: hak ediş tarihi, yaş, gün, kesinti, kullanılan ve kalan (FIFO)." tur="defter" />
        <R title={`Biriken izin · ${piled.length} kişi`} desc="2 yıldan eski hak edişi kullanılmamış personel. Planlamaya alınması önerilir." tur="biriken">
          <ul className="text-sm">{piled.slice(0, 5).map((e) => <li key={e.id} className="flex justify-between"><span>{e.first_name} {e.last_name}</span><span className="num text-muted">{fmtDays(data.ledgers.get(e.id)!.balance)} gün</span></li>)}</ul>
        </R>
        <R title={`Hak edişi yaklaşan · ${soon.length} kişi`} desc="Önümüzdeki 90 günde yeni izin hakkı doğacak personel." tur="yaklasan" />
        <R title={`Son 12 ayda izin kullanmayan · ${idle.length} kişi`} desc="1 yılını doldurmuş, son 12 ayda hiç yıllık izin kullanmamış personel." tur="kullanmayan" />
        <R title="Plan ve gerçekleşen" desc="Onaylı plan günleri ile kullanılan yıllık izin karşılaştırması." tur="plan" />
        <R title="İzin hareketleri" desc="Seçili yılın tüm izin kayıtları (tüm türler): tarih, gün, durum, onaylayan aşama, yol izni." tur="hareket" />
      </div>
    </>
  );
}

/* ================================================================ Ayarlar */
export function Ayarlar({ data }: { data: LeaveData }) {
  const count = (id: string) => data.emps.filter((e) => e.department_id === id).length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Bölüm bazında eşzamanlı izin sınırı">
        <p className="text-xs text-muted">Bir bölümden aynı gün en fazla kaç kişinin izinde olabileceği. Yüzde ve kişi sınırından küçük olanı geçerlidir; boş bırakılırsa sınır yok. Sınırı aşan talep onay ekranında kırmızı uyarı verir.</p>
        <form action={saveDeptLimits} className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_70px_80px_80px] gap-2 text-xs text-muted font-semibold"><span>Bölüm</span><span className="text-right">Kişi</span><span>En çok %</span><span>En çok kişi</span></div>
          {data.depts.map((d) => (
            <div key={d.id} className="grid grid-cols-[1fr_70px_80px_80px] gap-2 items-center text-sm">
              <input type="hidden" name="dept" value={d.id} />
              <span>{d.name}</span><span className="num text-right text-muted">{count(d.id)}</span>
              <input name={`pct_${d.id}`} defaultValue={d.leave_max_pct ?? ""} inputMode="decimal" placeholder="%" className={input} aria-label={`${d.name} yüzde`} />
              <input name={`people_${d.id}`} defaultValue={d.leave_max_people ?? ""} inputMode="numeric" placeholder="kişi" className={input} aria-label={`${d.name} kişi`} />
            </div>
          ))}
          <PendingSubmit className={`${btn} self-start`}>Kaydet</PendingSubmit>
        </form>
      </Card>
      <Card title="Açılış bakiyesi aktarımı">
        <p className="text-xs text-muted">Sistem öncesi kullanılmış izinleri girmek için. Excel&apos;den iki sütunu kopyalayıp yapıştırın: <b>kart no veya TC</b> ; <b>gün</b> ; not (isteğe bağlı). Her satıra bir personel.</p>
        <form action={importOpening} className="flex flex-col gap-2 text-sm">
          <textarea name="rows" rows={7} placeholder={"1024;12;2025 sonu kalan\n12345678901;8"} className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 font-mono text-sm" aria-label="Satırlar" />
          <label className="flex items-center gap-2"><input type="radio" name="mode" value="kalan" defaultChecked className="w-4 h-4" />Girilen gün = bugünkü <b>kalan bakiye</b> (fark düzeltme olarak yazılır)</label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" value="ek" className="w-4 h-4" />Girilen gün bakiyeye <b>eklenir</b> (eksi değer düşer)</label>
          <ConfirmSubmit label="Aktar" question="Bakiyeler güncellenecek. Devam edilsin mi?" yes="Evet, aktar" className={`${btn} self-start`} />
        </form>
      </Card>
      <Card title="Uygulanan kurallar" className="lg:col-span-2">
        <ul className="text-sm list-disc pl-5 flex flex-col gap-1 text-[#33414F]">
          <li>Cumartesi iş günüdür; pazar ve resmi tatiller izinden sayılmaz, arife yarım gün sayılır (md. 56).</li>
          <li>Talep önce bölüm şefine, sonra İK&apos;ya düşer. Şef yoksa doğrudan İK&apos;ya gider. Son onayı sahip, İK veya muhasebe verir.</li>
          <li>İzni başka yerde geçirecek personele talebi hâlinde 4 güne kadar ücretsiz yol izni verilir; onayda otomatik ücretsiz izin kaydı açılır (md. 56).</li>
          <li>İzin bölünebilir; bölümlerden biri 10 günden az olamaz (md. 56). Onay ekranı uyarır.</li>
          <li>İzin ücreti izne çıkmadan önce peşin veya avans olarak ödenir (md. 57); izinde ücretli iş yasaktır (md. 58).</li>
          <li>Kullanılmayan izin ücreti yalnız iş sözleşmesi sona erince ödenir (md. 59); izin hakkından vazgeçilemez (md. 53).</li>
          <li>Ücretsiz izin ve girilen kesintiler hak ediş tarihini öteler; hastalık, doğum izni gibi md. 55&apos;te sayılan süreler çalışılmış sayılır.</li>
        </ul>
      </Card>
    </div>
  );
}
