import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader, Stat } from "@/components/ui";
import { STAGE_LABEL, addDaysIso, deptPeak, fmtDays, loadLeaveData, returnDate, type LeaveData } from "@/lib/annual-leave";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { decideBulk, decideRequest } from "./actions";
import { dailyWages, liability, yearsSince } from "./load";
import { Ayarlar, Bakiye, Plan, Rapor } from "./parts";
import { Takvim } from "./Takvim";

const TABS = [
  ["ozet", "Özet", false], ["onay", "Onay", false], ["takvim", "Takvim", false], ["bakiye", "Bakiyeler", false],
  ["plan", "Plan ve toplu izin", true], ["rapor", "Raporlar", true], ["ayarlar", "Ayarlar", true],
] as const;
type Tab = (typeof TABS)[number][0];
type SP = { sekme?: string; ay?: string; bolum?: string; yil?: string; q?: string };
const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
const btn2 = "h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm";

/** Yıllık izin yönetimi: onay, takvim, bakiye, plan, rapor ve belgeler */
export default async function AnnualLeavePage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const hr = s.role !== "branch_manager";
  const sp = await searchParams;
  const tabs = TABS.filter(([, , hrOnly]) => hr || !hrOnly);
  const tab = (tabs.find(([k]) => k === sp.sekme)?.[0] ?? "ozet") as Tab;
  const today = todayIso();
  const supabase = await createClient();
  let data: LeaveData;
  try { data = await loadLeaveData(supabase, today); } catch (e) {
    return (<><PageHeader title="Yıllık izin" /><div className="p-6"><Card><p className="text-sm">Veri okunamadı: {(e as Error).message}. Supabase&apos;de <b>20261118000000_annual_leave.sql</b> çalıştırıldığından emin olun.</p></Card></div></>);
  }
  const pending = data.rows.filter((r) => r.status === "pending");
  return (
    <>
      <PageHeader title="Yıllık izin" subtitle={`${pending.length} onay bekleyen · bugün ${data.rows.filter((r) => r.status === "approved" && r.code !== "SAATLIK" && r.start_date <= today && r.end_date >= today).length} kişi izinde`}
        actions={<Link href="/izin" className={btn2}>Tüm izin kayıtları</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1280px]">
        <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Bölümler">
          {tabs.map(([k, l]) => (
            <Link key={k} href={`/yillik-izin?sekme=${k}`} aria-current={tab === k ? "page" : undefined} className={`shrink-0 h-10 px-3.5 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>
              {l}{k === "onay" && pending.length > 0 && <span className="ml-1.5 inline-grid place-items-center min-w-5 h-5 px-1 rounded-full bg-[#00A6D6] text-white text-[11px]">{pending.length}</span>}
            </Link>
          ))}
        </nav>
        {tab === "ozet" && <Ozet data={data} today={today} hr={hr} />}
        {tab === "onay" && <Onay data={data} today={today} role={s.role} />}
        {tab === "takvim" && <Takvim data={data} month={sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : today.slice(0, 7)} dept={sp.bolum} today={today} />}
        {tab === "bakiye" && <Bakiye data={data} today={today} q={sp.q} dept={sp.bolum} />}
        {tab === "plan" && hr && <Plan data={data} year={Number(sp.yil) || Number(today.slice(0, 4))} today={today} />}
        {tab === "rapor" && hr && <Rapor data={data} year={Number(sp.yil) || Number(today.slice(0, 4))} today={today} />}
        {tab === "ayarlar" && hr && <Ayarlar data={data} />}
      </div>
    </>
  );
}

/* ================================================================ Özet */
async function Ozet({ data, today, hr }: { data: LeaveData; today: string; hr: boolean }) {
  const supabase = await createClient();
  const name = new Map(data.emps.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const deptOf = new Map(data.emps.map((e) => [e.id, e.dept]));
  const approved = data.rows.filter((r) => r.status === "approved" && r.code !== "SAATLIK");
  const onLeave = approved.filter((r) => r.start_date <= today && r.end_date >= today);
  const week = addDaysIso(today, 7);
  const starting = approved.filter((r) => r.start_date > today && r.start_date <= week).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const returning = approved.filter((r) => r.end_date >= today && r.end_date < week && !data.rows.some((x) => x.parent_id === r.id)).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const pend = data.rows.filter((r) => r.status === "pending");
  const soon = data.emps.map((e) => ({ e, l: data.ledgers.get(e.id) })).filter((x) => x.l && x.l.next.date <= addDaysIso(today, 30)).sort((a, b) => a.l!.next.date.localeCompare(b.l!.next.date));
  const piled = data.emps.map((e) => ({ e, l: data.ledgers.get(e.id)! })).filter((x) => x.l && x.l.oldestOpen && (x.l.oldestOpen === "devir" ? x.l.opening.left > 0 && x.l.balance >= 28 : yearsSince(x.l.oldestOpen, today) >= 2)).sort((a, b) => b.l.balance - a.l.balance);
  const noOpening = data.emps.filter((e) => { const l = data.ledgers.get(e.id); return l && l.completedYears >= 2 && l.used === 0 && l.adjust === 0; });
  const wages = hr ? await dailyWages(supabase, data, today) : new Map();
  const li = liability(data, wages);
  // İzindeyken kart okutma (md. 58): son 30 gün
  const since = addDaysIso(today, -30);
  const yearly = approved.filter((r) => r.code === "YILLIK" && r.end_date >= since && r.start_date <= today);
  let worked: Array<{ id: string; day: string }> = [];
  if (yearly.length) {
    const { data: p } = await supabase.from("attendance_punches").select("employee_id, punched_at").in("employee_id", [...new Set(yearly.map((r) => r.employee_id))]).gte("punched_at", `${since}T00:00:00`).limit(2000);
    const seen = new Set<string>();
    for (const x of p ?? []) {
      const day = String(x.punched_at).slice(0, 10);
      const k = `${x.employee_id}|${day}`;
      if (!seen.has(k) && yearly.some((r) => r.employee_id === x.employee_id && r.start_date <= day && r.end_date >= day && new Date(day + "T12:00:00Z").getUTCDay() !== 0)) { seen.add(k); worked.push({ id: x.employee_id as string, day }); }
    }
    worked = worked.slice(0, 10);
  }
  const deptLoad = data.depts.map((d) => ({ d, ...deptPeak(data, d.id, today, today) })).filter((x) => x.headcount > 0);
  const L = ({ items }: { items: Array<{ k: string; l: React.ReactNode; r: React.ReactNode; href?: string }> }) => (
    <ul className="text-sm divide-y divide-[#EEF2F6]">{items.map((x) => <li key={x.k} className="py-2 flex justify-between gap-3">{x.href ? <Link href={x.href} className="text-brand-700 font-semibold">{x.l}</Link> : <span>{x.l}</span>}<span className="text-muted text-right num">{x.r}</span></li>)}</ul>
  );
  return (
    <>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Onay bekleyen" value={String(pend.length)} sub={`şef ${pend.filter((r) => r.stage === "chief").length} · İK ${pend.filter((r) => r.stage !== "chief").length}`} href="/yillik-izin?sekme=onay" />
        <Stat label="Bugün izinde" value={`${new Set(onLeave.map((r) => r.employee_id)).size} kişi`} sub={`7 gün içinde ${starting.length} çıkış, ${returning.length} dönüş`} href="/yillik-izin?sekme=takvim" />
        <Stat label="Toplam kalan izin" value={`${fmtDays(li.days)} gün`} sub={`${data.emps.length} personel`} href="/yillik-izin?sekme=bakiye" />
        {hr ? <Stat label="İzin yükümlülüğü" value={formatTL(li.real)} sub={`resmi ücrete göre ${formatTL(li.official)}${li.missing ? ` · ${li.missing} kişinin ücreti yok` : ""}`} href="/yillik-izin?sekme=rapor" />
          : <Stat label="2+ yıllık birikmiş" value={`${piled.length} kişi`} />}
      </div>
      {noOpening.length > 0 && hr && <p className="text-sm rounded-xl bg-[#FFF4E0] text-[#8A5A00] p-3">⚠ {noOpening.length} personelin (2+ yıl kıdemli) geçmiş izin kullanımı girilmemiş; kalanları olduğundan yüksek görünür. <Link href="/yillik-izin?sekme=ayarlar" className="font-semibold underline">Açılış bakiyesini aktarın</Link>.</p>}
      {worked.length > 0 && <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm"><b>Yıllık izindeyken kart okutma (md. 58: izinde ücretli iş yasağı; izin kullanılmamış sayılabilir):</b> {worked.map((w) => `${name.get(w.id)} ${formatDate(w.day)}`).join(" · ")}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Bugün izinde">
          <L items={onLeave.slice(0, 12).map((r) => ({ k: r.id, l: name.get(r.employee_id) ?? "?", r: `${r.name} · dönüş ${formatDate(returnDate(r.end_date, data.hol))}`, href: `/yillik-izin/${r.employee_id}` }))} />
          {onLeave.length === 0 && <p className="text-sm text-muted">Bugün izinde kimse yok.</p>}
        </Card>
        <Card title="7 gün içinde izne çıkacaklar">
          <L items={starting.slice(0, 12).map((r) => ({ k: r.id, l: name.get(r.employee_id) ?? "?", r: `${formatDate(r.start_date)} · ${fmtDays(r.days)} gün`, href: `/yillik-izin/${r.employee_id}` }))} />
          {starting.length === 0 ? <p className="text-sm text-muted">Yok.</p> : hr && <p className="text-xs text-muted">İzin ücreti izne çıkmadan önce peşin veya avans olarak ödenir (md. 57).</p>}
        </Card>
        <Card title="7 gün içinde işe dönecekler">
          <L items={returning.slice(0, 12).map((r) => ({ k: r.id, l: name.get(r.employee_id) ?? "?", r: `işbaşı ${formatDate(returnDate(r.end_date, data.hol, r.travel_days))}`, href: `/yillik-izin/${r.employee_id}` }))} />
          {returning.length === 0 && <p className="text-sm text-muted">Yok.</p>}
        </Card>
        <Card title="30 gün içinde hak edecekler">
          <L items={soon.slice(0, 12).map(({ e, l }) => ({ k: e.id, l: `${e.first_name} ${e.last_name}`, r: `${formatDate(l!.next.date)} · +${l!.next.days} gün`, href: `/yillik-izin/${e.id}` }))} />
          {soon.length === 0 && <p className="text-sm text-muted">Yok.</p>}
        </Card>
        <Card title="Biriken izin (2 yıldan eski hak)">
          <L items={piled.slice(0, 12).map(({ e, l }) => ({ k: e.id, l: `${e.first_name} ${e.last_name}`, r: `${fmtDays(l.balance)} gün · ${l.oldestOpen === "devir" ? "devirden" : `${formatDate(l.oldestOpen!)}'den beri`}`, href: `/yillik-izin/${e.id}` }))} />
          {piled.length === 0 ? <p className="text-sm text-muted">Yok.</p> : <p className="text-xs text-muted">Kullanılmayan izin, ayrılışta son ücretten ödenir (md. 59). Planlamaya alın.</p>}
        </Card>
        <Card title="Bölüm doluluğu (bugün)">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{deptLoad.map((x) => (
            <li key={x.d.id} className="py-2 flex items-center gap-3"><span className="flex-1">{x.d.name}</span>
              <span className={`num font-semibold ${x.limit !== null && x.peak > x.limit ? "text-bad" : ""}`}>{x.peak}{x.limit !== null ? ` / ${x.limit}` : ""}</span>
              <span className="w-20 h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><span className={`block h-full ${x.limit !== null && x.peak > x.limit ? "bg-bad" : "bg-[#1A7F52]"}`} style={{ width: `${Math.min(100, x.limit ? (x.peak / x.limit) * 100 : (x.peak / Math.max(1, x.headcount)) * 100)}%` }} /></span></li>
          ))}</ul>
          <p className="text-xs text-muted">İzinde / bölüm sınırı. Sınırlar Ayarlar sekmesinden bölüm bazında girilir.</p>
        </Card>
      </div>
      {pend.length > 0 && <p className="text-xs text-muted">{pend.slice(0, 3).map((r) => `${name.get(r.employee_id)} (${deptOf.get(r.employee_id)})`).join(", ")}{pend.length > 3 ? ` ve ${pend.length - 3} talep daha` : ""} onay bekliyor.</p>}
    </>
  );
}

/* ================================================================ Onay */
async function Onay({ data, today, role }: { data: LeaveData; today: string; role: string }) {
  const hr = role !== "branch_manager";
  const emp = new Map(data.emps.map((e) => [e.id, e]));
  const pend = data.rows.filter((r) => r.status === "pending").sort((a, b) => a.start_date.localeCompare(b.start_date));
  const supabase = await createClient();
  const { data: extra } = pend.length ? await supabase.from("leave_requests").select("id, destination, document_path, chief_at").in("id", pend.map((r) => r.id)) : { data: [] };
  const ex = new Map((extra ?? []).map((x) => [x.id as string, x]));
  return (
    <>
      <p className="text-sm text-muted">Talep önce bölüm şefine, şef onayından sonra İK&apos;ya düşer. {hr ? "İK, şef onayını beklemeden de karar verebilir." : "Onayınızla talep İK onayına gönderilir."}</p>
      {pend.length === 0 && <Card><p className="text-sm text-muted">Onay bekleyen talep yok.</p></Card>}
      {pend.length > 1 && (
        <form id="bulk" action={decideBulk} className="flex flex-wrap gap-2 items-center rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3 text-sm">
          <span className="text-muted">Seçilenleri:</span>
          <PendingSubmit name="status" value="approved" className={btn}>Onayla</PendingSubmit>
          <PendingSubmit name="status" value="rejected" className={btn2}>Reddet</PendingSubmit>
        </form>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {pend.map((r) => {
          const e = emp.get(r.employee_id);
          const l = data.ledgers.get(r.employee_id);
          const yearly = r.code === "YILLIK";
          const after = l ? l.balance - (yearly ? r.days : 0) : null;
          const pk = deptPeak(data, e?.department_id ?? null, r.start_date, r.end_date, r.id);
          const over = pk.limit !== null && pk.peak + 1 > pk.limit;
          const tenOk = !yearly || r.days >= 10 || data.rows.some((x) => x.employee_id === r.employee_id && x.code === "YILLIK" && x.id !== r.id && x.days >= 10 && x.start_date >= addDaysIso(today, -365));
          const canAct = hr || r.stage === "chief";
          const mates = data.emps.filter((x) => x.department_id === e?.department_id && x.id !== r.employee_id);
          const x = ex.get(r.id);
          return (
            <Card key={r.id} title={`${e?.first_name ?? "?"} ${e?.last_name ?? ""}`} action={<span className={`text-xs font-semibold px-2 py-1 rounded-full ${r.stage === "chief" ? "bg-[#FFF4E0] text-[#8A5A00]" : "bg-[#E7F1FB] text-brand-700"}`}>{STAGE_LABEL[r.stage ?? "hr"]}</span>}>
              <div className="flex items-start gap-3 text-sm">
                {canAct && <input type="checkbox" name="id" value={r.id} form="bulk" aria-label="Seç" className="w-5 h-5 mt-0.5" />}
                <div className="flex-1 flex flex-col gap-1">
                  <div><b>{r.name}</b> · {e?.dept}</div>
                  <div className="num">{formatDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""} · <b>{fmtDays(r.days)} gün</b> · işbaşı {formatDate(returnDate(r.end_date, data.hol, r.travel_days))}</div>
                  {r.travel_days > 0 && <div className="text-muted">+ {r.travel_days} gün ücretsiz yol izni{x?.destination ? ` (${x.destination})` : ""}</div>}
                  {r.note && <div className="text-muted">“{r.note}”</div>}
                  {x?.document_path && <div className="text-muted">Belge eklendi</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {yearly && l && <span className={`px-2 py-1 rounded-md ${after! < 0 ? "bg-[#FDECEA] text-[#9B1C1C]" : "bg-[#E6F4EC] text-[#1A7F52]"}`}>Bakiye {fmtDays(l.balance)} → {fmtDays(after!)}{after! < 0 ? " (avans izin)" : ""}</span>}
                <span className={`px-2 py-1 rounded-md ${over ? "bg-[#FDECEA] text-[#9B1C1C] font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>Bölümde aynı anda {pk.peak + 1}{pk.limit !== null ? ` / sınır ${pk.limit}` : ""} kişi{pk.who.length ? ` (${pk.who.slice(0, 3).join(", ")}${pk.who.length > 3 ? "…" : ""} · ${formatDate(pk.peakDay)})` : ""}</span>
                {!tenOk && <span className="px-2 py-1 rounded-md bg-[#FFF4E0] text-[#8A5A00]">Bölünmüş izin: son 1 yılda 10 günlük bölüm yok (md. 56)</span>}
                {l && yearly && l.completedYears === 0 && <span className="px-2 py-1 rounded-md bg-[#FFF4E0] text-[#8A5A00]">Henüz 1 yılını doldurmadı (ilk hak ediş {formatDate(l.next.date)})</span>}
              </div>
              {canAct ? (
                <form action={decideRequest} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select name="substitute" className={input} aria-label="Vekil" defaultValue=""><option value="">Vekil (isteğe bağlı)</option>{mates.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}</select>
                    <input name="note" placeholder="Not (ret gerekçesi vb.)" className={input} aria-label="Not" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <PendingSubmit name="status" value="approved" className={btn}>{hr ? "Onayla" : "Şef onayı ver"}</PendingSubmit>
                    <PendingSubmit name="status" value="rejected" className={`${btn2} text-bad`}>Reddet</PendingSubmit>
                  </div>
                </form>
              ) : <p className="text-xs text-muted">Şef onayı verildi{x?.chief_at ? ` (${formatDate(String(x.chief_at).slice(0, 10))})` : ""}; İK kararı bekleniyor.</p>}
              <div className="flex gap-3 text-xs"><Link href={`/yillik-izin/${r.employee_id}`} className="text-brand-700 font-semibold">İzin defteri</Link><a href={`/yazdir/yillik-izin?tur=form&id=${r.id}`} target="_blank" rel="noopener" className="text-brand-700 font-semibold">Talep formu</a></div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
