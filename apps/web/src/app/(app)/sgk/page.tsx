import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader, Stat } from "@/components/ui";
import { CIKIS_NEDENI, DEFAULT_URLS, EKSIK_GUN, GOREV, IS_KOLU, SGK_LINKS, SIGORTA_KOLU } from "@/lib/sgk/codes";
import { cikisRows, girisRows } from "@/lib/sgk/data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cancelJob, createRobotToken, markManual, revokeRobotToken, robotLoginJob, robotXmlJob, saveAccount, saveCompanySgk, saveEmployeeSgk, sendCikisAction, sendGirisAction, testConnection, viziteApproveAction, viziteFetchAction } from "./actions";

const TABS = [["ozet", "Özet"], ["giris", "İşe giriş"], ["cikis", "İşten ayrılış"], ["vizite", "Vizite (raporlar)"], ["robot", "SGK Robotu"], ["gecmis", "İşlem geçmişi"], ["ayarlar", "Ayarlar"]] as const;
const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
const btn2 = "h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm";
const KIND: Record<string, string> = { "ise-giris": "İşe giriş", "isten-cikis": "İşten ayrılış", "vizite-oku": "Vizite rapor okuma", "vizite-onay": "Vizite çalışmadı bildirimi", ayar: "Ayar", "robot-toplu-giris": "Robot · toplu giriş", "robot-toplu-cikis": "Robot · toplu çıkış", "robot-is-kazasi": "Robot · iş kazası", "robot-giris-yap": "Robot · SGK girişi" };
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** SGK işlemleri: işe giriş / işten ayrılış bildirgesi, vizite, robot, geçmiş ve hesap ayarları */
export default async function SgkPage({ searchParams }: { searchParams: Promise<{ sekme?: string; gun?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "accountant"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.sekme)?.[0] ?? "ozet") as (typeof TABS)[number][0];
  const supabase = await createClient();
  const today = todayIso();
  const [{ data: acc, error }, { data: comp }, { data: txs }] = await Promise.all([
    supabase.from("sgk_accounts").select("id, label, isyeri_sicil, kullanici_adi, isyeri_kodu, environment, has_sistem, has_isyeri, has_ws, giris_wsdl, cikis_wsdl, vizite_url, last_test_at, last_test_result, updated_at").limit(1).maybeSingle(),
    supabase.from("companies").select("name, sgk_registration_no, csgb_iskolu, sgk_araci_no").limit(1).maybeSingle(),
    supabase.from("sgk_transactions").select("employee_id, kind, status, reference, created_at").in("kind", ["ise-giris", "isten-cikis"]).eq("status", "basarili"),
  ]);
  if (error) return (<><PageHeader title="SGK işlemleri" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261120000000_sgk.sql</b> çalıştırılmalı.</p></Card></div></>);
  const done = (kind: string) => new Set((txs ?? []).filter((t) => t.kind === kind).map((t) => t.employee_id));
  const [{ data: newEmps }, { data: leftEmps }] = await Promise.all([
    supabase.from("employees").select("id, hire_date").neq("status", "terminated").gte("hire_date", addDays(today, -60)).order("hire_date"),
    supabase.from("employees").select("id, termination_date").not("termination_date", "is", null).gte("termination_date", addDays(today, -60)).order("termination_date"),
  ]);
  const girisIds = (newEmps ?? []).filter((e) => !done("ise-giris").has(e.id)).map((e) => e.id);
  const cikisIds = (leftEmps ?? []).filter((e) => !done("isten-cikis").has(e.id)).map((e) => e.id);
  const { count: pendingReports } = await supabase.from("sgk_reports").select("id", { count: "exact", head: true }).is("onay_at", null);
  const envBadge = acc ? <span className={`text-xs font-bold px-2 py-1 rounded-full ${acc.environment === "canli" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{acc.environment === "canli" ? "CANLI ORTAM" : "TEST ORTAMI"}</span> : null;
  return (
    <>
      <PageHeader title="SGK işlemleri" subtitle={`${comp?.name ?? ""} · işyeri sicil ${comp?.sgk_registration_no ?? "girilmemiş"}`} actions={envBadge} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1240px]">
        <nav className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Bölümler">{TABS.map(([k, l]) => <Link key={k} href={`/sgk?sekme=${k}`} aria-current={tab === k ? "page" : undefined} className={`shrink-0 h-10 px-3.5 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}</Link>)}</nav>
        {!acc && tab !== "ayarlar" && <div className="rounded-xl bg-[#FFF4E0] text-[#8A5A00] p-3 text-sm">SGK hesabı tanımlı değil. {s.role === "owner" ? <Link href="/sgk?sekme=ayarlar" className="font-semibold underline">Ayarlar</Link> : "Şirket sahibinin Ayarlar sekmesinden"} kullanıcı adı ve şifreleri girmesi gerekiyor. XML indirme ve robot şifresiz de kullanılabilir.</div>}
        {tab === "ozet" && <Ozet girisIds={girisIds} cikisIds={cikisIds} pendingReports={pendingReports ?? 0} acc={acc} />}
        {tab === "giris" && <Giris ids={girisIds} />}
        {tab === "cikis" && <Cikis ids={cikisIds} />}
        {tab === "vizite" && <Vizite hasWs={!!acc?.has_ws} day={sp.gun} />}
        {tab === "robot" && <Robot owner={s.role === "owner"} />}
        {tab === "gecmis" && <Gecmis />}
        {tab === "ayarlar" && <Ayarlar owner={s.role === "owner"} acc={acc} comp={comp} />}
      </div>
    </>
  );
}

type Acc = { has_sistem: boolean; has_isyeri: boolean; has_ws: boolean; environment: string; last_test_at: string | null } | null;
async function Ozet({ girisIds, cikisIds, pendingReports, acc }: { girisIds: string[]; cikisIds: string[]; pendingReports: number; acc: Acc }) {
  const supabase = await createClient();
  const today = todayIso();
  const [g, c] = await Promise.all([girisRows(supabase, girisIds), cikisRows(supabase, cikisIds)]);
  const lateG = g.filter((r) => r.ISEGIRISTARIHI && r.ISEGIRISTARIHI <= addDays(today, 1));
  const lateC = c.filter((r) => r.ISTENCIKISTARIHI && addDays(r.ISTENCIKISTARIHI, 10) <= addDays(today, 3));
  return (
    <>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Bekleyen işe giriş" value={String(g.length)} sub={lateG.length ? `${lateG.length} acil (işe başlamadan 1 gün önce)` : "son 60 gün"} href="/sgk?sekme=giris" />
        <Stat label="Bekleyen işten ayrılış" value={String(c.length)} sub="çıkıştan itibaren 10 gün" href="/sgk?sekme=cikis" />
        <Stat label="Onay bekleyen rapor" value={String(pendingReports)} sub="vizite" href="/sgk?sekme=vizite" />
        <Stat label="Web servis" value={acc ? (acc.has_sistem && acc.has_isyeri ? "Hazır" : "Şifre eksik") : "Tanımsız"} sub={acc?.last_test_at ? `son test ${formatDate(acc.last_test_at.slice(0, 10))}` : "test edilmedi"} href="/sgk?sekme=ayarlar" />
      </div>
      {(lateG.length > 0 || lateC.length > 0) && <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm flex flex-col gap-1">
        {lateG.map((r) => <p key={r.employeeId}>⚠ {r.name}: işe giriş {formatDate(r.ISEGIRISTARIHI)} · bildirge en geç bir gün önce verilmelidir (5510 md. 8).</p>)}
        {lateC.map((r) => <p key={r.employeeId}>⚠ {r.name}: çıkış {formatDate(r.ISTENCIKISTARIHI)} · son gün {formatDate(addDays(r.ISTENCIKISTARIHI, 10))}.</p>)}
      </div>}
      <Card title="Hızlı erişim">
        <div className="flex flex-wrap gap-2">{([["tekilGiris", "İşe giriş / çıkış (tekil)"], ["topluGiris", "Toplu giriş / çıkış (XML)"], ["ebildirge", "e-Bildirge V2 (APHB)"], ["vizite", "Vizite"], ["isveren", "Tüm işveren uygulamaları"]] as const).map(([k, l]) => <a key={k} href={SGK_LINKS[k]} target="_blank" rel="noopener" className={btn2 + " grid place-items-center"}>{l} ↗</a>)}</div>
        <p className="text-xs text-muted">SGK Robotu eklentisi kuruluysa, &quot;SGK Robotu&quot; sekmesinden görev oluşturup bu ekranlara otomatik giriş yaptırabilirsiniz.</p>
      </Card>
    </>
  );
}

function Problems({ list }: { list: string[] }) { return list.length ? <div className="text-xs text-bad">{list.join(" · ")}</div> : <div className="text-xs text-ok">Hazır</div>; }

async function Giris({ ids }: { ids: string[] }) {
  const supabase = await createClient();
  const rows = await girisRows(supabase, ids);
  return (
    <>
      <Card title={`İşe giriş bildirgesi bekleyenler · ${rows.length}`}>
        <p className="text-xs text-muted">Son 60 günde işe giren ve SGK bildirgesi kaydı olmayan personel. Bildirge işe başlamadan en geç bir gün önce verilir.</p>
        <form className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.employeeId} className="rounded-xl border border-line p-3 flex flex-wrap gap-3 items-start text-sm">
              <input type="checkbox" name="id" value={r.employeeId} defaultChecked={!r.problems.length} className="w-5 h-5 mt-0.5" aria-label={`${r.name} seç`} />
              <div className="flex-1 min-w-[220px]"><b>{r.name}</b> <span className="text-muted">· TC {r.TCKNO ? `${r.TCKNO.slice(0, 3)}•••••${r.TCKNO.slice(-3)}` : "—"} · giriş {r.ISEGIRISTARIHI ? formatDate(r.ISEGIRISTARIHI) : "—"}</span>
                <div className="text-xs text-muted">Meslek {r.MESLEKKODU || "—"} · görev {GOREV[String(r.GOREVKODU)]} · öğrenim kodu {r.OGRENIMKODU} · sigorta kolu {r.SIGORTAKOLU} · engelli {r.OZURLUKODU}</div>
                <Problems list={r.problems} />
              </div>
              <Link href={`/personel/${r.employeeId}`} className="text-xs font-semibold text-brand-700">Personel kartı</Link>
            </li>
          ))}{rows.length === 0 && <li className="text-sm text-ok font-semibold">Bekleyen işe giriş bildirgesi yok.</li>}</ul>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3">
              <span className="text-sm text-muted">Seçilenleri:</span>
              <button formAction={sendGirisAction} className={btn}>SGK&apos;ya gönder (web servis)</button>
              <button formAction={robotXmlJob} name="kind" value="toplu-giris" className={btn2}>Robotla toplu yükle</button>
              <button formAction={markManual} name="kind" value="ise-giris" className={btn2}>SGK&apos;da elle bildirdim</button>
              <input name="reference" placeholder="Referans no (elle bildirimde)" className={`${input} w-56`} aria-label="Referans" />
              <a href={`/sgk/xml?tur=giris&ids=${rows.map((r) => r.employeeId).join(",")}`} className="text-sm font-semibold text-brand-700">Tümü için XML indir</a>
            </div>
          )}
        </form>
      </Card>
      <SgkFields ids={ids} />
    </>
  );
}

async function SgkFields({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("id, first_name, last_name, sgk_occupation_code, sgk_duty_code, sgk_insurance_branch, ex_convict").in("id", ids);
  return (
    <Card title="Personel SGK bilgileri">
      <p className="text-xs text-muted">Meslek kodu SGK meslek listesinden (ör. diş protez teknisyeni için SGK listesinde arayın; biçim 9999.99). Engellilik ve öğrenim personel özlük bilgisinden alınır.</p>
      <ul className="text-sm divide-y divide-[#EEF2F6]">{(data ?? []).map((e) => (
        <li key={e.id} className="py-2"><form action={saveEmployeeSgk} className="grid gap-2 sm:grid-cols-[1.2fr_.8fr_1fr_1fr_auto_auto] items-center">
          <input type="hidden" name="employee_id" value={e.id} /><b>{e.first_name} {e.last_name}</b>
          <input name="sgk_occupation_code" defaultValue={e.sgk_occupation_code ?? ""} placeholder="Meslek kodu" className={input} aria-label="Meslek kodu" />
          <select name="sgk_duty_code" defaultValue={e.sgk_duty_code ?? 2} className={input} aria-label="Görev kodu">{Object.entries(GOREV).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="sgk_insurance_branch" defaultValue={e.sgk_insurance_branch ?? 0} className={input} aria-label="Sigorta kolu">{Object.entries(SIGORTA_KOLU).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="ex_convict" defaultChecked={e.ex_convict} />Eski hükümlü</label>
          <PendingSubmit className={btn2}>Kaydet</PendingSubmit>
        </form></li>
      ))}</ul>
    </Card>
  );
}

async function Cikis({ ids }: { ids: string[] }) {
  const supabase = await createClient();
  const rows = await cikisRows(supabase, ids);
  const num = "h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm w-full";
  return (
    <Card title={`İşten ayrılış bildirgesi bekleyenler · ${rows.length}`}>
      <p className="text-xs text-muted">Son 60 günde ayrılan ve bildirge kaydı olmayan personel. Bildirge çıkıştan itibaren 10 gün içinde verilir. Ücretler bordrodan önerilir; düzeltebilirsiniz.</p>
      <form className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.employeeId} className="rounded-xl border border-line p-3 flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-3 items-center"><input type="checkbox" name="id" value={r.employeeId} defaultChecked={!r.problems.length} className="w-5 h-5" aria-label="Seç" /><b className="flex-1">{r.name}</b><span className="text-muted">çıkış {r.ISTENCIKISTARIHI ? formatDate(r.ISTENCIKISTARIHI) : "—"} · son gün {r.ISTENCIKISTARIHI ? formatDate(addDays(r.ISTENCIKISTARIHI, 10)) : "—"}</span></div>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="sm:col-span-2 text-xs text-muted flex flex-col gap-1">Çıkış nedeni<select name={`cikis_${r.employeeId}`} defaultValue={r.ISTENAYRILISNEDENI || ""} className={num}><option value="">Seçin</option>{Object.entries(CIKIS_NEDENI).map(([k, l]) => <option key={k} value={k}>{k.padStart(2, "0")} · {l}</option>)}</select></label>
              <label className="text-xs text-muted flex flex-col gap-1">Bu dönem ücret<input name={`ucret_${r.employeeId}`} defaultValue={r.BULUNDUGUMUZDONEM.HAKEDILENUCRET || ""} inputMode="decimal" className={num} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Prim / ikramiye<input name={`prim_${r.employeeId}`} defaultValue={r.BULUNDUGUMUZDONEM.PRIMIKRAMIYE || ""} inputMode="decimal" className={num} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Eksik gün<input name={`eksik_${r.employeeId}`} defaultValue={r.BULUNDUGUMUZDONEM.EKSIKGUNSAYISI} inputMode="numeric" className={num} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Eksik gün nedeni<select name={`neden_${r.employeeId}`} defaultValue={r.BULUNDUGUMUZDONEM.EKSIKGUNNEDENI} className={num}>{Object.entries(EKSIK_GUN).map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</select></label>
              <label className="text-xs text-muted flex flex-col gap-1">Önceki dönem ücret<input name={`pucret_${r.employeeId}`} defaultValue={r.ONCEKIDONEM?.HAKEDILENUCRET || ""} inputMode="decimal" className={num} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Önceki dönem eksik gün<input name={`peksik_${r.employeeId}`} defaultValue={r.ONCEKIDONEM?.EKSIKGUNSAYISI ?? ""} inputMode="numeric" className={num} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Belge türü<input name={`belge_${r.employeeId}`} defaultValue={r.BULUNDUGUMUZDONEM.BELGETURU} inputMode="numeric" className={num} /></label>
            </div>
            <Problems list={r.problems} />
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-ok font-semibold">Bekleyen işten ayrılış bildirgesi yok.</p> : (
          <div className="flex flex-wrap gap-2 items-center rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3">
            <button formAction={sendCikisAction} className={btn}>SGK&apos;ya gönder (web servis)</button>
            <button formAction={robotXmlJob} name="kind" value="toplu-cikis" className={btn2}>Robotla toplu yükle</button>
            <button formAction={markManual} name="kind" value="isten-cikis" className={btn2}>SGK&apos;da elle bildirdim</button>
            <input name="reference" placeholder="Referans no" className={`${input} w-48`} aria-label="Referans" />
            <a href={`/sgk/xml?tur=cikis&ids=${rows.map((r) => r.employeeId).join(",")}`} className="text-sm font-semibold text-brand-700">XML indir</a>
          </div>
        )}
      </form>
    </Card>
  );
}

async function Vizite({ hasWs, day }: { hasWs: boolean; day?: string }) {
  const supabase = await createClient();
  const { data: reps } = await supabase.from("sgk_reports").select("*").order("poliklinik_tar", { ascending: false }).limit(100);
  const pending = (reps ?? []).filter((r) => !r.onay_at);
  return (
    <>
      <Card title="SGK'dan rapor al">
        {!hasWs && <p className="text-sm rounded-lg bg-warn-bg text-warn px-3 py-2">Vizite web servis şifresi girilmemiş. SGK Vizite uygulamasında &quot;Web servis şifresi&quot; alıp Ayarlar&apos;a girin.</p>}
        <form action={viziteFetchAction} className="flex flex-wrap gap-2 items-end text-sm">
          <label className="text-xs text-muted flex flex-col gap-1">Bu tarihten önceki poliklinik tarihli raporlar<input type="date" name="date" defaultValue={day ?? todayIso()} className={`${input} w-48`} /></label>
          <PendingSubmit className={btn}>Raporları getir</PendingSubmit>
        </form>
        <p className="text-xs text-muted">Her gün sabah otomatik de çekilir. Onayladığınız rapor &quot;çalışmadı bildirimi&quot; olarak SGK&apos;ya gider ve rapor izni puantaja işlenir.</p>
      </Card>
      <Card title={`Onay bekleyen raporlar · ${pending.length}`}>
        <ul className="flex flex-col gap-2">{pending.map((r) => (
          <li key={r.id} className="rounded-xl border border-line p-3 text-sm flex flex-wrap gap-2 items-center">
            <span className="flex-1 min-w-[220px]"><b>{r.ad_soyad}</b>{!r.employee_id && <span className="text-xs text-bad"> · personel eşleşmedi</span>}<span className="block text-xs text-muted">{r.vaka_adi ?? r.vaka} · {r.baslangic ? formatDate(r.baslangic) : "—"} – {r.bitis ? formatDate(r.bitis) : "—"} · işbaşı {r.ise_baslama ? formatDate(r.ise_baslama) : "—"} · {r.tesis ?? ""}</span></span>
            <form action={viziteApproveAction} className="flex gap-2 items-center"><input type="hidden" name="id" value={r.id} />
              <select name="nitelik" className="h-9 rounded-lg border border-[#D5DEE8] px-2 text-sm" aria-label="Nitelik durumu"><option value="0">Çalışmadı (0)</option><option value="1">Nitelik 1</option></select>
              <PendingSubmit className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Onayla, SGK&apos;ya bildir</PendingSubmit>
            </form>
          </li>
        ))}{pending.length === 0 && <li className="text-sm text-muted">Onay bekleyen rapor yok.</li>}</ul>
        <p className="text-xs text-muted">Nitelik durumu değerleri SGK kılavuzunda 0 / 1 olarak tanımlı; ilk kullanımda test ortamında anlamını doğrulayın.</p>
      </Card>
      {(reps ?? []).some((r) => r.onay_at) && <Card title="Onaylananlar"><ul className="text-sm divide-y divide-[#EEF2F6]">{(reps ?? []).filter((r) => r.onay_at).slice(0, 30).map((r) => <li key={r.id} className="py-1.5 flex justify-between gap-2"><span>{r.ad_soyad} · {r.baslangic ? formatDate(r.baslangic) : ""}–{r.bitis ? formatDate(r.bitis) : ""}</span><span className="text-xs text-muted">{formatDate(String(r.onay_at).slice(0, 10))}{r.leave_request_id ? " · izne işlendi" : ""}</span></li>)}</ul></Card>}
    </>
  );
}

async function Robot({ owner }: { owner: boolean }) {
  const supabase = await createClient();
  const [{ data: jobs }, { data: tokens }] = await Promise.all([
    supabase.from("sgk_robot_jobs").select("id, kind, title, status, reference, result_note, created_at, done_at").order("created_at", { ascending: false }).limit(40),
    owner ? supabase.from("sgk_robot_tokens").select("id, label, created_at, last_used_at, revoked_at").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const ST: Record<string, string> = { bekliyor: "Bekliyor", calisiyor: "Çalışıyor", tamamlandi: "Tamamlandı", iptal: "İptal", hata: "Hata" };
  return (
    <>
      <Card title="SGK Robotu nasıl çalışır?">
        <ol className="text-sm list-decimal pl-5 flex flex-col gap-1">
          <li>Eklentiyi indirin: <a href="/sgk/eklenti" className="font-semibold text-brand-700">mb-sgk-robotu.zip</a>. Zip&apos;i bir klasöre açın.</li>
          <li>Chrome&apos;da <b>chrome://extensions</b> adresini açın, sağ üstten <b>Geliştirici modu</b>nu açın, <b>Paketlenmemiş öğe yükle</b> ile açtığınız klasörü seçin.</li>
          <li>Aşağıdan bir <b>robot anahtarı</b> oluşturun (yalnız sahip) ve eklentinin penceresine yapıştırın.</li>
          <li>Yazılımda görev oluşturun (toplu giriş/çıkış, iş kazası, SGK girişi). Eklentide <b>Başlat</b>&apos;a basın.</li>
          <li>Robot SGK ekranını açar, kullanıcı adı ve şifreleri doldurur, formu doldurur veya XML dosyasını seçer. <b>Güvenlik kodunu siz girer, &quot;Gönder&quot;e siz basarsınız.</b> Sonra referans numarasını yazıp &quot;Tamamlandı&quot;ya basın; sonuç yazılıma işlenir.</li>
        </ol>
        <p className="text-xs text-muted">Şifreler eklentiye yalnız görev başladığında, anahtarınızla ve şifreli bağlantıyla gelir; tarayıcı kapanınca silinir. Anahtarı kaybederseniz iptal edin.</p>
      </Card>
      <Card title="Görev oluştur">
        <form action={robotLoginJob} className="flex flex-wrap gap-2 items-end text-sm">
          <select name="target" className={`${input} w-72`} aria-label="Hedef"><option value="tekilGiris">İşe giriş / çıkış uygulaması</option><option value="topluGiris">Toplu giriş / çıkış (XML)</option><option value="ebildirge">e-Bildirge V2 (APHB)</option><option value="vizite">Vizite</option><option value="isveren">İşveren uygulamaları</option></select>
          <PendingSubmit className={btn}>SGK&apos;ya robotla giriş yap</PendingSubmit>
        </form>
        <p className="text-xs text-muted">Toplu giriş/çıkış görevleri İşe giriş ve İşten ayrılış sekmelerinden, iş kazası görevi İSG → İş kazası ekranından oluşturulur.</p>
      </Card>
      <Card title="Görevler">
        <ul className="text-sm divide-y divide-[#EEF2F6]">{(jobs ?? []).map((j) => (
          <li key={j.id} className="py-2 flex flex-wrap gap-2 items-center"><span className="flex-1 min-w-[220px]"><b>{j.title}</b><span className="block text-xs text-muted">{new Date(j.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}{j.reference ? ` · ref ${j.reference}` : ""}{j.result_note ? ` · ${j.result_note}` : ""}</span></span><span className="text-xs font-semibold">{ST[j.status]}</span>
            {["bekliyor", "calisiyor"].includes(j.status) && <form action={cancelJob}><input type="hidden" name="id" value={j.id} /><PendingSubmit className="text-xs text-bad">İptal</PendingSubmit></form>}</li>
        ))}{(jobs ?? []).length === 0 && <li className="py-2 text-muted">Görev yok.</li>}</ul>
      </Card>
      {owner && (
        <Card title="Robot anahtarları">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(tokens ?? []).map((t) => <li key={t.id} className="py-1.5 flex justify-between gap-2"><span>{t.label} <span className="text-xs text-muted">· {formatDate(String(t.created_at).slice(0, 10))}{t.last_used_at ? ` · son kullanım ${formatDate(String(t.last_used_at).slice(0, 10))}` : ""}</span></span>{t.revoked_at ? <span className="text-xs text-muted">iptal</span> : <form action={revokeRobotToken}><input type="hidden" name="id" value={t.id} /><ConfirmSubmit label="İptal et" /></form>}</li>)}</ul>
          <form action={createRobotToken} className="flex gap-2"><input name="label" placeholder="Bilgisayar adı (ör. Muhasebe PC)" className={`${input} max-w-xs`} aria-label="Etiket" /><PendingSubmit className={btn}>Anahtar oluştur</PendingSubmit></form>
        </Card>
      )}
    </>
  );
}

async function Gecmis() {
  const supabase = await createClient();
  const [{ data }, { data: emps }] = await Promise.all([
    supabase.from("sgk_transactions").select("id, kind, employee_id, environment, status, reference, message, pdf_path, created_at").order("created_at", { ascending: false }).limit(150),
    supabase.from("employees").select("id, first_name, last_name"),
  ]);
  const name = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const paths = (data ?? []).map((x) => x.pdf_path).filter(Boolean) as string[];
  const { data: urls } = paths.length ? await supabase.storage.from("documents").createSignedUrls(paths, 600) : { data: [] };
  const link = new Map(((urls ?? []) as Array<{ path: string | null; signedUrl: string }>).map((u) => [u.path ?? "", u.signedUrl]));
  return (
    <Card title="İşlem geçmişi">
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
        <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Zaman</th><th className="py-2 px-2">İşlem</th><th className="py-2 px-2">Personel</th><th className="py-2 px-2">Durum</th><th className="py-2 px-2">Referans</th><th className="py-2 px-2">Mesaj</th></tr></thead>
        <tbody>{(data ?? []).map((x) => (
          <tr key={x.id} className="border-t border-[#EEF2F6] align-top"><td className="py-1.5 px-2 whitespace-nowrap text-xs">{new Date(x.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}{x.environment === "test" ? " · test" : ""}</td><td className="py-1.5 px-2">{KIND[x.kind] ?? x.kind}</td><td className="py-1.5 px-2">{x.employee_id ? name.get(x.employee_id) : "—"}</td>
            <td className="py-1.5 px-2"><span className={`text-xs font-semibold ${x.status === "basarili" ? "text-ok" : x.status === "hata" ? "text-bad" : "text-muted"}`}>{x.status === "basarili" ? "Başarılı" : x.status === "hata" ? "Hata" : x.status === "robot" ? "Robot" : "Bekliyor"}</span></td>
            <td className="py-1.5 px-2 num">{x.reference ?? ""}{x.pdf_path && link.get(x.pdf_path) ? <> · <a href={link.get(x.pdf_path)} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold">PDF</a></> : null}</td><td className="py-1.5 px-2 text-xs">{x.message}</td></tr>
        ))}{(data ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">İşlem yok.</td></tr>}</tbody>
      </table></div>
    </Card>
  );
}

function Ayarlar({ owner, acc, comp }: { owner: boolean; acc: Record<string, unknown> | null; comp: { sgk_registration_no: string | null; csgb_iskolu: number | null; sgk_araci_no: number | null } | null }) {
  const env = (acc?.environment as "test" | "canli") ?? "test";
  const Chip = ({ ok }: { ok: boolean }) => <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ok ? "bg-ok-bg text-ok" : "bg-[#EEF2F6] text-muted"}`}>{ok ? "Kayıtlı (şifreli)" : "Girilmedi"}</span>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="SGK işyeri hesabı">
        {!owner ? <p className="text-sm text-muted">Hesap bilgilerini yalnız şirket sahibi değiştirebilir.{acc ? ` Kayıtlı hesap: ${String(acc.kullanici_adi).slice(0, 3)}•••••${String(acc.kullanici_adi).slice(-2)} · işyeri kodu ${acc.isyeri_kodu}` : ""}</p> : (
          <form action={saveAccount} className="grid gap-2 sm:grid-cols-2 text-sm" autoComplete="off">
            <label className="text-xs text-muted flex flex-col gap-1 sm:col-span-2">İşyeri sicil no (26 hane)<input name="isyeri_sicil" required defaultValue={String(acc?.isyeri_sicil ?? comp?.sgk_registration_no ?? "")} inputMode="numeric" className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">Kullanıcı adı (11 hane TC)<input name="kullanici_adi" required defaultValue={String(acc?.kullanici_adi ?? "")} inputMode="numeric" className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">İşyeri kodu<input name="isyeri_kodu" required defaultValue={String(acc?.isyeri_kodu ?? "")} inputMode="numeric" className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">Sistem şifresi <Chip ok={!!acc?.has_sistem} /><input type="password" name="sistem_sifre" autoComplete="new-password" placeholder={acc?.has_sistem ? "değiştirmek için yazın" : ""} className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">İşyeri şifresi <Chip ok={!!acc?.has_isyeri} /><input type="password" name="isyeri_sifre" autoComplete="new-password" placeholder={acc?.has_isyeri ? "değiştirmek için yazın" : ""} className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">Vizite web servis şifresi <Chip ok={!!acc?.has_ws} /><input type="password" name="ws_sifre" autoComplete="new-password" placeholder={acc?.has_ws ? "değiştirmek için yazın" : ""} className={input} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">Ortam<select name="environment" defaultValue={env} className={input}><option value="test">Test ortamı (önce bununla deneyin)</option><option value="canli">Canlı ortam (gerçek bildirim)</option></select></label>
            <details className="sm:col-span-2 text-xs"><summary className="cursor-pointer text-brand-700 font-semibold">Gelişmiş: servis adresleri</summary>
              <div className="grid gap-2 mt-2">
                <input name="giris_wsdl" defaultValue={String(acc?.giris_wsdl ?? "")} placeholder={DEFAULT_URLS[env].giris} className={input} aria-label="İşe giriş WSDL" />
                <input name="cikis_wsdl" defaultValue={String(acc?.cikis_wsdl ?? "")} placeholder={DEFAULT_URLS[env].cikis} className={input} aria-label="İşten çıkış WSDL" />
                <input name="vizite_url" defaultValue={String(acc?.vizite_url ?? "")} placeholder={DEFAULT_URLS[env].vizite} className={input} aria-label="Vizite adresi" />
                <p className="text-muted">Boş bırakılırsa varsayılan adresler kullanılır. SGK adres değiştirirse buradan güncelleyin.</p>
              </div>
              <label className="flex items-center gap-2 mt-2"><input type="checkbox" name="clear_ws_sifre" />Vizite şifresini sil</label>
            </details>
            <PendingSubmit className={`${btn} justify-self-start`}>Kaydet</PendingSubmit>
          </form>
        )}
        <p className="text-xs text-muted">Şifreler sunucuda AES-256 ile şifrelenir, ekranda ve telefonda gösterilmez; yalnız SGK&apos;ya gönderilirken çözülür. Her kullanım işlem geçmişine yazılır. Öneri: SGK&apos;da yalnız bildirge yetkili ayrı bir işyeri kullanıcısı açın. Test ortamı için işyeri sicilinizin test ortamına indirilmesi gerekir (SGK: entegretescil@sgk.gov.tr).</p>
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Bağlantı testi">
          <form action={testConnection}><PendingSubmit className={btn}>Bağlantıyı test et</PendingSubmit></form>
          {acc?.last_test_at ? <><p className="text-xs text-muted">Son test: {new Date(String(acc.last_test_at)).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p><pre className="text-xs whitespace-pre-wrap bg-[#F6F8FA] border border-line rounded-lg p-2 max-h-60 overflow-auto">{String(acc.last_test_result ?? "")}</pre></> : <p className="text-xs text-muted">Henüz test edilmedi. Test, SGK servis tanımlarını okuyup metodları listeler; bildirim göndermez.</p>}
        </Card>
        <Card title="İşyeri SGK bilgileri">
          <form action={saveCompanySgk} className="grid gap-2 sm:grid-cols-2 text-sm">
            <label className="text-xs text-muted flex flex-col gap-1 sm:col-span-2">ÇSGB iş kolu<select name="csgb_iskolu" defaultValue={comp?.csgb_iskolu ?? ""} className={input}><option value="">Seçin</option>{Object.entries(IS_KOLU).map(([k, l]) => <option key={k} value={k}>{k.padStart(2, "0")} · {l}</option>)}</select></label>
            <label className="text-xs text-muted flex flex-col gap-1">Aracı no<input name="sgk_araci_no" defaultValue={comp?.sgk_araci_no ?? 0} inputMode="numeric" className={input} /></label>
            <PendingSubmit className={`${btn2} self-end`}>Kaydet</PendingSubmit>
          </form>
        </Card>
      </div>
    </div>
  );
}
