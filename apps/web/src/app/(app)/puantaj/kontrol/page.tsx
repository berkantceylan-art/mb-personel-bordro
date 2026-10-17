import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, getSession, periodLabel } from "@/lib/session";
import { ISSUE, syncAttMonth } from "@/lib/att-control";
import { bulkFixAtt, closeAttMonth, fixAttDay, reopenAttMonth, resyncAtt, saveAttSettings } from "@/lib/att-control-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Puantaj kontrol merkezi" };

type Row = {
  employee_id: string; work_date: string; shift_code: string | null; shift_start: string | null; shift_end: string | null; status: string; leave_code: string | null;
  first_in: string | null; last_out: string | null; worked_min: number; late_min: number; early_min: number; overtime_min: number; punch_count: number;
  issues: string[]; state: string; resolution: string | null; computed_at: string;
  employees: { first_name: string; last_name: string; department_id: string | null; departments: { name: string } | null } | null;
};

const WD = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const dLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)} ${WD[new Date(d + "T12:00:00Z").getUTCDay()]}`;
const hm = (ts: string | null) => (ts ? ts.slice(11, 16) : "—");
const dur = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "—");
const STATE: Record<string, [string, "red" | "green" | "blue" | "gray"]> = { open: ["Açık", "red"], fixed: ["Düzeltildi", "green"], accepted: ["Kabul edildi", "blue"], ok: ["Sorunsuz", "gray"] };
const RES: Record<string, string> = { forgot_card: "kart unuttu", shift_fill: "vardiyaya göre", overtime: "mesai onaya", leave: "izinli", absent: "devamsız", accept: "kabul", shift_change: "vardiya değişti" };
const btn = "h-8 px-2.5 rounded-lg text-xs font-semibold border";

export default async function AttControlPage({ searchParams }: { searchParams: Promise<{ ay?: string; tarih?: string; hata?: string; durum?: string; bolum?: string; q?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : currentPeriod();
  const durum = sp.durum ?? "open";
  const [py, pm] = period.split("-").map(Number) as [number, number];
  const from = `${period}-01`;
  const to = pm === 12 ? `${py + 1}-01-01` : `${py}-${String(pm + 1).padStart(2, "0")}-01`;
  const sb = await createClient();
  const canAdmin = s.role === "owner" || s.role === "hr";

  // İlk açılışta ya da 60 dk'dan eski hesapta otomatik yeniden hesapla (PDKS aktarımı sonrası güncel kalsın)
  const [{ data: last, error: e0 }, { data: closed }] = await Promise.all([
    sb.from("att_days").select("computed_at").gte("work_date", from).lt("work_date", to).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("att_months").select("closed_at").eq("period", period).maybeSingle(),
  ]);
  let syncErr: string | null = e0 ? e0.message : null;
  if (!e0 && !closed && (!last || Date.now() - Date.parse(last.computed_at as string) > 60 * 60 * 1000)) {
    try { await syncAttMonth(sb, s.companyId, period); } catch (e) { syncErr = (e as Error).message; }
  }

  let q = sb.from("att_days")
    .select("employee_id, work_date, shift_code, shift_start, shift_end, status, leave_code, first_in, last_out, worked_min, late_min, early_min, overtime_min, punch_count, issues, state, resolution, computed_at, employees(first_name, last_name, department_id, departments(name))")
    .gte("work_date", from).lt("work_date", to)
    .order("work_date", { ascending: false }).limit(2000);
  if (durum === "open") q = q.eq("state", "open");
  else if (durum === "done") q = q.in("state", ["fixed", "accepted"]);
  else q = q.neq("state", "ok");
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.tarih ?? "")) q = q.eq("work_date", sp.tarih!);
  if (sp.hata && ISSUE[sp.hata]) q = q.contains("issues", [sp.hata]);
  const [{ data, error }, { data: leaveTypes }, { data: shifts }, { data: depts }, { data: set }, { data: allOpen }] = await Promise.all([
    q,
    sb.from("leave_types").select("id, name, code").order("name"),
    sb.from("shifts").select("id, code, name, start_time, end_time").eq("active", true).order("code"),
    sb.from("departments").select("id, name").order("name"),
    sb.from("att_settings").select("forgot_free").maybeSingle(),
    sb.from("att_days").select("work_date, issues").eq("state", "open").gte("work_date", from).lt("work_date", to).limit(5000),
  ]);
  const norm = (v: string) => v.toLocaleLowerCase("tr");
  const rows = ((data ?? []) as unknown as Row[]).filter((r) =>
    (!sp.bolum || r.employees?.department_id === sp.bolum) &&
    (!sp.q || norm(`${r.employees?.first_name ?? ""} ${r.employees?.last_name ?? ""}`).includes(norm(sp.q))));
  const open = (allOpen ?? []) as { work_date: string; issues: string[] }[];
  const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 86_400_000).toISOString().slice(0, 10);
  const byIssue = new Map<string, number>();
  for (const r of open) for (const i of r.issues) byIssue.set(i, (byIssue.get(i) ?? 0) + 1);
  const forgotFree = (set as { forgot_free?: number } | null)?.forgot_free ?? 2;
  const missingSql = /att_days|schema cache|does not exist/.test(error?.message ?? syncErr ?? "");
  const link = (o: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const m = { ay: period, durum, hata: sp.hata, bolum: sp.bolum, q: sp.q, tarih: sp.tarih, ...o };
    for (const [k, v] of Object.entries(m)) if (v) u.set(k, v);
    return `/puantaj/kontrol?${u.toString()}`;
  };
  const shown = rows.slice(0, 300);

  return (
    <>
      <PageHeader title="Puantaj kontrol merkezi" subtitle="Hatalı, eksik ve gelmeyen personelin günleri burada düzeltilir; düzeltme puantaja ve bordroya kendiliğinden yansır."
        actions={<span className="flex flex-wrap gap-4 text-sm font-semibold"><Link href={`/puantaj/kontrol/rapor?ay=${period}`} className="text-brand-700">Aylık hata raporu</Link><Link href="/puantaj" className="text-brand-700">Puantaj</Link><Link href="/fazla-mesai" className="text-brand-700">Fazla mesai onayı</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {missingSql && <Notice tone="bad">Supabase&apos;de mbdental-puantaj-kontrol.sql çalıştırılmalı.</Notice>}
        {!missingSql && syncErr && <Notice tone="bad">Hesaplama hatası: {syncErr}</Notice>}

        <section className="rounded-[20px] p-5 text-white bg-gradient-to-br from-[#06213f] via-[#0a3d73] to-[#13649f] flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <form className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-white/70">Dönem<input type="month" name="ay" defaultValue={period} className="h-10 rounded-lg px-3 text-ink" /></label>
              <input type="hidden" name="durum" value={durum} />
              <button className="h-10 px-4 rounded-lg bg-white/15 font-semibold text-sm">Göster</button>
            </form>
            <span className="text-sm text-white/70">{periodLabel(period)}{closed ? " · ay kapalı" : ""}{last ? ` · son hesap ${new Date(last.computed_at as string).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : ""}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {!closed && <form action={resyncAtt}><input type="hidden" name="period" value={period} /><PendingSubmit className="h-10 px-4 rounded-lg bg-white/15 font-semibold text-sm">Yeniden hesapla</PendingSubmit></form>}
              {canAdmin && !closed && <form action={closeAttMonth}><input type="hidden" name="period" value={period} /><ConfirmSubmit label="Ayı kapat" question={open.length ? `${open.length} açık gün var; ay kapanmaz. Yine de dene?` : "Ay kapatılsın mı?"} className="h-10 px-4 rounded-lg bg-white text-brand-800 font-semibold text-sm" /></form>}
              {s.role === "owner" && closed && <form action={reopenAttMonth}><input type="hidden" name="period" value={period} /><ConfirmSubmit label="Ayı aç" className="h-10 px-4 rounded-lg bg-white text-brand-800 font-semibold text-sm" /></form>}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Açık hatalı gün" value={open.length} warn={open.length > 0} href={link({ durum: "open", hata: undefined, tarih: undefined })} />
            <Stat label="Dünkü açık" value={open.filter((r) => r.work_date === yesterday).length} href={link({ durum: "open", tarih: yesterday, hata: undefined })} />
            <Stat label="Eksik okutma" value={(byIssue.get("MISSING_OUT") ?? 0) + (byIssue.get("MISSING_IN") ?? 0)} href={link({ durum: "open", hata: "MISSING_OUT" })} />
            <Stat label="Gelmeyen" value={byIssue.get("ABSENT") ?? 0} href={link({ durum: "open", hata: "ABSENT" })} />
            <Stat label="İşlenmemiş fazla mesai" value={byIssue.get("OVERTIME") ?? 0} href={link({ durum: "open", hata: "OVERTIME" })} />
          </div>
        </section>

        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="ay" value={period} />
          <input name="q" defaultValue={sp.q} placeholder="Personel ara" className={`${inputCls} w-52 h-10`} />
          <select name="durum" defaultValue={durum} className={`${selectCls} w-44 h-10`}><option value="open">Açık hatalar</option><option value="done">Düzeltilen / kabul</option><option value="all">Tümü</option></select>
          <select name="hata" defaultValue={sp.hata ?? ""} className={`${selectCls} w-52 h-10`}><option value="">Tüm hata türleri</option>{Object.entries(ISSUE).map(([k, v]) => <option key={k} value={k}>{v.label}{byIssue.get(k) ? ` (${byIssue.get(k)})` : ""}</option>)}</select>
          <select name="bolum" defaultValue={sp.bolum ?? ""} className={`${selectCls} w-44 h-10`}><option value="">Tüm bölümler</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <input type="date" name="tarih" defaultValue={sp.tarih} className={`${inputCls} w-40 h-10`} />
          <button className={`${btnSecondary} h-10`}>Filtrele</button>
          {(sp.q || sp.hata || sp.bolum || sp.tarih) && <Link href={link({ q: undefined, hata: undefined, bolum: undefined, tarih: undefined })} className="text-sm font-semibold text-muted">Temizle</Link>}
          <span className="ml-auto text-sm text-muted">{rows.length} gün{rows.length > shown.length ? ` (ilk ${shown.length})` : ""}</span>
        </form>

        {durum === "open" && shown.length > 0 && !closed && (
          <form id="toplu" action={bulkFixAtt} className="rounded-[14px] border border-line bg-[#F8FAFC] p-3 flex flex-wrap items-center gap-2 text-sm">
            <b className="text-brand-800">Seçilenlere toplu işlem:</b>
            <select name="action" className={`${selectCls} w-56 h-9`}>
              <option value="accept">Olduğu gibi kabul et</option>
              <option value="forgot_card">Kart unuttu (vardiya saatiyle)</option>
              <option value="shift_fill">Vardiyasına göre işle</option>
              <option value="overtime">Mesai işle (onaya)</option>
              <option value="absent">Devamsız onayla</option>
            </select>
            <input name="reason" placeholder="Sebep" maxLength={300} className={`${inputCls} w-64 h-9`} />
            <PendingSubmit className="h-9 px-4 rounded-lg bg-brand-700 text-white font-semibold">Uygula</PendingSubmit>
            <span className="text-xs text-muted">Satırlardaki kutuları işaretleyin.</span>
          </form>
        )}

        <div className="flex flex-col gap-2">
          {shown.map((r) => {
            const name = r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "?";
            const missing = r.issues.includes("MISSING_IN") || r.issues.includes("MISSING_OUT");
            const key = `${r.employee_id}|${r.work_date}`;
            const editable = !closed && (r.state === "open");
            return (
              <article key={key} className={`rounded-[14px] border bg-white p-3 flex flex-col gap-2 ${r.state === "open" ? "border-[#F3C7C7]" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {editable && durum === "open" && <input type="checkbox" name="sel" value={key} form="toplu" className="w-4 h-4" aria-label="Seç" />}
                  <span className="font-semibold">{name}</span>
                  <span className="text-xs text-muted">{r.employees?.departments?.name ?? "Bölümsüz"}</span>
                  <span className="num text-sm">{dLabel(r.work_date)}</span>
                  <span className="text-xs text-muted">{r.shift_code ? `Vardiya ${r.shift_code} ${r.shift_start?.slice(0, 5) ?? ""}–${r.shift_end?.slice(0, 5) ?? ""}` : "Vardiya yok"}</span>
                  <span className="num text-xs">Giriş <b>{hm(r.first_in)}</b> · Çıkış <b>{hm(r.last_out)}</b> · Net {dur(r.worked_min)}{r.late_min ? ` · geç ${r.late_min} dk` : ""}{r.early_min ? ` · erken ${r.early_min} dk` : ""}{r.overtime_min ? ` · FM ${dur(r.overtime_min)}` : ""}</span>
                  <span className="flex flex-wrap gap-1">{r.issues.map((i) => <Chip key={i} tone={ISSUE[i]?.tone ?? "gray"}>{ISSUE[i]?.label ?? i}</Chip>)}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs"><Chip tone={STATE[r.state]?.[1]}>{STATE[r.state]?.[0]}</Chip>{r.resolution && <span className="text-muted">{RES[r.resolution] ?? r.resolution}</span>}<Link href={`/puantaj/${r.employee_id}/${r.work_date}`} className="text-brand-700 font-semibold">Okutmalar</Link></span>
                </div>
                {editable && (
                  <form action={fixAttDay} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="employee_id" value={r.employee_id} />
                    <input type="hidden" name="date" value={r.work_date} />
                    <input name="reason" placeholder="Sebep (ör. kartını unuttu)" maxLength={300} className="h-8 rounded-lg border border-[#D5DEE8] px-2 text-xs w-52" />
                    {missing && (
                      <>
                        {r.issues.includes("MISSING_IN") && <input type="time" name="time_in" title="Giriş saati (boşsa vardiya başlangıcı)" className="h-8 rounded-lg border border-[#D5DEE8] px-1 text-xs" />}
                        {r.issues.includes("MISSING_OUT") && <input type="time" name="time_out" title="Çıkış saati (boşsa vardiya bitişi)" className="h-8 rounded-lg border border-[#D5DEE8] px-1 text-xs" />}
                        <PendingSubmit name="action" value="forgot_card" className={`${btn} bg-brand-700 text-white border-brand-700`}>Kart unuttu</PendingSubmit>
                      </>
                    )}
                    {(missing || r.issues.includes("ABSENT")) && <PendingSubmit name="action" value="shift_fill" className={`${btn} border-brand-600 text-brand-700`}>Vardiyasına göre işle</PendingSubmit>}
                    {r.issues.includes("OVERTIME") && (
                      <>
                        <input name="ot_hours" inputMode="decimal" placeholder={`${(r.overtime_min / 60).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sa`} title="Saat (boşsa hesaplanan)" className="h-8 w-16 rounded-lg border border-[#D5DEE8] px-1 text-xs text-right" />
                        <PendingSubmit name="action" value="overtime" className={`${btn} bg-[#0F766E] text-white border-[#0F766E]`}>Mesai işle</PendingSubmit>
                      </>
                    )}
                    {(r.issues.includes("ABSENT") || r.issues.includes("LEAVE_PRESENT") || missing) && (
                      <>
                        <select name="leave_type" className="h-8 rounded-lg border border-[#D5DEE8] px-1 text-xs max-w-[150px]" aria-label="İzin türü"><option value="">İzin türü…</option>{(leaveTypes ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                        <PendingSubmit name="action" value="leave" className={`${btn} border-line`}>İzinli say</PendingSubmit>
                      </>
                    )}
                    {r.issues.includes("ABSENT") && <PendingSubmit name="action" value="absent" className={`${btn} border-[#F3C7C7] text-bad`}>Devamsız onayla</PendingSubmit>}
                    <select name="shift_id" className="h-8 rounded-lg border border-[#D5DEE8] px-1 text-xs max-w-[140px]" aria-label="Vardiya"><option value="">Vardiya…</option><option value="off">Hafta tatili</option>{(shifts ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {String(x.start_time).slice(0, 5)}–{String(x.end_time).slice(0, 5)}</option>)}</select>
                    <PendingSubmit name="action" value="shift_change" className={`${btn} border-line`}>Vardiya değiştir</PendingSubmit>
                    <PendingSubmit name="action" value="accept" className={`${btn} border-line text-muted`}>Kabul et</PendingSubmit>
                  </form>
                )}
                {!closed && (r.state === "fixed" || r.state === "accepted") && (
                  <form action={fixAttDay} className="flex"><input type="hidden" name="employee_id" value={r.employee_id} /><input type="hidden" name="date" value={r.work_date} /><input type="hidden" name="action" value="reopen" /><PendingSubmit className="text-xs font-semibold text-muted underline">Yeniden aç</PendingSubmit></form>
                )}
              </article>
            );
          })}
          {!shown.length && !missingSql && <div className="rounded-[14px] border border-line bg-white p-8 text-center text-muted">{durum === "open" ? "Açık hatalı gün yok." : "Kayıt yok."}</div>}
        </div>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[14px] border border-line bg-white p-4 text-sm flex flex-col gap-2">
            <h2 className="font-display font-bold text-brand-800">Nasıl çalışır?</h2>
            <ul className="list-disc pl-5 flex flex-col gap-1 text-muted">
              <li><b>Kart unuttu:</b> eksik giriş / çıkışı vardiya saatiyle (ya da yazdığınız saatle) işler. Personel başına ayda {forgotFree} hak; bölüm şefinin aştığı kayıt İK / şube müdürü onayına gider.</li>
              <li><b>Vardiyasına göre işle:</b> giriş ve çıkışı vardiya saatlerinden yazar (hak sayılmaz).</li>
              <li><b>Mesai işle:</b> fazla mesaiyi hesaplanan süreyle onaya gönderir; Fazla mesai ekranında onaylanınca bordroya geçer.</li>
              <li><b>İzinli say / Devamsız onayla / Kabul et:</b> günü kapatır; devamsızlık eksik gün olarak puantaja yansır.</li>
              <li>Orijinal okutmalar silinmez; her düzeltme kim, ne zaman, neden bilgisiyle kaydedilir. Açık hatalı gün varken ay kapatılamaz.</li>
            </ul>
          </div>
          {canAdmin && (
            <form action={saveAttSettings} className="rounded-[14px] border border-line bg-white p-4 text-sm flex flex-col gap-3">
              <h2 className="font-display font-bold text-brand-800">Ayarlar</h2>
              <label className="flex items-center gap-3">Kart unuttu aylık hakkı<input type="number" name="forgot_free" min={0} max={31} defaultValue={forgotFree} className={`${inputCls} w-24 h-10 text-right`} /></label>
              <p className="text-xs text-muted">Personelin kendi “okutmayı unuttum” bildirimi de bu hak içindeyse otomatik onaylanır; aşınca yöneticinin onayına düşer.</p>
              <PendingSubmit className="h-10 px-4 rounded-lg bg-brand-700 text-white font-semibold self-start">Kaydet</PendingSubmit>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, warn, href }: { label: string; value: number; warn?: boolean; href: string }) {
  return (
    <Link href={href} className="rounded-xl bg-white/10 hover:bg-white/15 px-4 py-3">
      <div className="text-xs text-white/70">{label}</div>
      <div className={`font-display text-2xl font-bold ${warn ? "text-amber-300" : ""}`}>{value}</div>
    </Link>
  );
}
