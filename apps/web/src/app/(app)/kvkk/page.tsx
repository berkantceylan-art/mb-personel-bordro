import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { CHECKLIST, DATA_INVENTORY, REQUEST_TYPES } from "@/lib/kvkk";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { runDisposal, saveBreach, saveNotice, saveRequest, seedKvkk, toggleCheck } from "./actions";

const TABS = [["durum", "Uyum durumu"], ["metin", "Metinler ve onaylar"], ["basvuru", "Başvurular"], ["erisim", "Erişim kaydı"], ["imha", "Saklama ve imha"], ["envanter", "Veri envanteri"], ["ihlal", "Veri ihlali"]] as const;
const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm w-full";
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, [string, string]> = { open: ["Yeni", "bg-[#FFF4E0] text-[#7A4F00]"], in_progress: ["İnceleniyor", "bg-[#E7F1FB] text-brand-700"], answered: ["Yanıtlandı", "bg-[#E6F4EC] text-ok"], rejected: ["Reddedildi", "bg-[#EEF2F6] text-muted"] };
const ACTION: Record<string, string> = { view: "görüntüledi", reveal: "gizli alanı açtı", download: "indirdi", export: "dışa aktardı" };
const ENTITY: Record<string, string> = { employee: "Personel kartı", candidate: "Aday", document: "Belge", report: "Rapor", payroll: "Bordro" };

/** KVKK merkezi */
export default async function KvkkPage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.sekme)?.[0] ?? "durum") as (typeof TABS)[number][0];
  const supabase = await createClient();
  const today = todayIso();
  const [{ data: notices, error }, { data: consents }, { data: reqs }, { data: checks }, { data: emps }, { data: disposals }] = await Promise.all([
    supabase.from("kvkk_notices").select("*").eq("active", true).order("audience").order("kind"),
    supabase.from("kvkk_consents").select("notice_id, employee_id, granted, revoked_at, version, created_at").is("revoked_at", null),
    supabase.from("kvkk_requests").select("*").order("received_at", { ascending: false }),
    supabase.from("kvkk_checklist").select("key, done_at"),
    supabase.from("employees").select("id, first_name, last_name, user_id").neq("status", "terminated"),
    supabase.from("kvkk_disposals").select("*").order("done_at", { ascending: false }).limit(30),
  ]);
  if (error) return (<><PageHeader title="KVKK" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261115000000_kvkk.sql</b> çalıştırılmalı.</p></Card></div></>);
  const empNotice = (notices ?? []).find((n) => n.audience === "employee" && n.kind === "aydinlatma");
  const acked = new Set((consents ?? []).filter((c) => c.notice_id === empNotice?.id).map((c) => c.employee_id));
  const withApp = (emps ?? []).filter((e) => e.user_id);
  const done = new Set((checks ?? []).filter((c) => c.done_at).map((c) => c.key));
  const openReq = (reqs ?? []).filter((r) => r.status === "open" || r.status === "in_progress");
  const late = openReq.filter((r) => r.due_on < today);
  const lastDisposal = disposals?.[0];

  return (
    <>
      <PageHeader title="KVKK uyumu" subtitle="Aydınlatma ve onaylar · başvurular · erişim kaydı · saklama ve imha · envanter · ihlal" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1150px]">
        <nav className="flex flex-wrap gap-1.5" aria-label="KVKK bölümleri">
          {TABS.map(([k, l]) => <Link key={k} href={`/kvkk?sekme=${k}`} aria-current={tab === k ? "page" : undefined} className={`h-10 px-3.5 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}{k === "basvuru" && openReq.length ? ` · ${openReq.length}` : ""}</Link>)}
        </nav>

        {(notices ?? []).length === 0 && (
          <Card title="Başlangıç">
            <p className="text-sm">Çalışan ve aday aydınlatma metinleri, açık rıza metinleri ve saklama süreleri için örnek içerik oluşturun. Metinler şirket bilgilerinizle doldurulur; yayından önce avukatınızla gözden geçirin.</p>
            <form action={seedKvkk}><PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Örnek metinleri oluştur</PendingSubmit></form>
          </Card>
        )}

        {tab === "durum" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([["Aydınlatma onayı", `${acked.size} / ${withApp.length}`, withApp.length > acked.size, "uygulamayı kullananlar"], ["Açık başvuru", String(openReq.length), late.length > 0, late.length ? `${late.length} tanesi süresi geçti` : "30 gün içinde yanıt"], ["Son periyodik imha", lastDisposal ? formatDate(lastDisposal.done_at.slice(0, 10)) : "yapılmadı", !lastDisposal || Date.parse(lastDisposal.done_at) < Date.now() - 183 * 86_400_000, "en geç 6 ayda bir"], ["Kontrol listesi", `${done.size} / ${CHECKLIST.length}`, done.size < CHECKLIST.length, "tamamlanan madde"]] as const).map(([l, v, w, sub]) => (
                <div key={l} className={`rounded-xl border p-3 ${w ? "border-[#F2C94C] bg-[#FFF4E0]" : "border-line bg-white"}`}><div className="text-xs text-muted">{l}</div><div className="num text-xl font-bold text-brand-800">{v}</div><div className="text-[11px] text-muted">{sub}</div></div>
              ))}
            </div>
            <Card title="Uyum kontrol listesi">
              <ul className="divide-y divide-[#EEF2F6]">
                {CHECKLIST.map((c) => (
                  <li key={c.key} className="py-2.5 flex gap-3 items-start">
                    <form action={toggleCheck}><input type="hidden" name="key" value={c.key} /><input type="hidden" name="on" value={done.has(c.key) ? "0" : "1"} />
                      <button aria-label={done.has(c.key) ? `${c.title}: geri al` : `${c.title}: tamamlandı`} className={`w-7 h-7 rounded-md border-2 grid place-items-center ${done.has(c.key) ? "bg-[#1A7F52] border-[#1A7F52] text-white" : "border-[#9FB3C8] bg-white"}`}>{done.has(c.key) ? "✓" : ""}</button>
                    </form>
                    <div><div className="text-sm font-semibold">{c.title}</div><div className="text-xs text-muted">{c.hint}</div></div>
                  </li>
                ))}
              </ul>
            </Card>
            <p className="text-xs text-muted">Bu modül KVKK yükümlülüklerini takip etmenize yardım eder; hukuki danışmanlığın yerine geçmez.</p>
          </>
        )}

        {tab === "metin" && (
          <>
            {(notices ?? []).map((n) => {
              const cs = (consents ?? []).filter((c) => c.notice_id === n.id && c.granted);
              return (
                <Card key={n.id} title={`${n.title} · sürüm ${n.version}`}>
                  <div className="text-xs text-muted">{n.audience === "employee" ? "Çalışanlar" : n.audience === "candidate" ? "Adaylar (kariyer sayfası)" : "Ziyaretçiler"} · {n.kind === "aydinlatma" ? "Aydınlatma (okundu onayı)" : "Açık rıza (geri alınabilir)"} · {formatDate(n.published_at.slice(0, 10))}{n.audience === "employee" ? ` · ${cs.length} kişi ${n.kind === "aydinlatma" ? "okudu" : "rıza verdi"}` : ""}</div>
                  <form action={saveNotice} className="flex flex-col gap-2">
                    <input type="hidden" name="id" value={n.id} />
                    <input name="title" defaultValue={n.title} className={input} aria-label="Başlık" />
                    <textarea name="body" rows={n.kind === "aydinlatma" ? 12 : 4} defaultValue={n.body} className={`${input} h-auto py-2 leading-relaxed`} aria-label="Metin" />
                    <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold self-start">Yeni sürüm olarak yayınla</PendingSubmit>
                  </form>
                  {n.audience === "employee" && n.kind === "aydinlatma" && withApp.length > acked.size && <p className="text-xs text-[#7A4F00]">Okumayanlar: {withApp.filter((e) => !acked.has(e.id)).map((e) => `${e.first_name} ${e.last_name}`).slice(0, 30).join(", ")}{withApp.length - acked.size > 30 ? "…" : ""}. Mobil uygulama ana sayfasında onay uyarısı görürler.</p>}
                </Card>
              );
            })}
          </>
        )}

        {tab === "basvuru" && (
          <>
            {(reqs ?? []).map((r) => {
              const [l, cls] = STATUS[r.status] ?? STATUS.open!;
              const left = Math.round((Date.parse(r.due_on) - Date.parse(today)) / 86_400_000);
              return (
                <Card key={r.id} title={`${r.requester_name} · ${REQUEST_TYPES[r.request_type] ?? r.request_type}`}>
                  <div className="flex flex-wrap gap-2 items-center text-xs"><span className={`font-semibold rounded-full px-2 py-0.5 ${cls}`}>{l}</span><span className="text-muted">alındı {formatDate(r.received_at.slice(0, 10))} · iletişim {r.requester_contact}</span>{(r.status === "open" || r.status === "in_progress") && <span className={left < 0 ? "text-bad font-semibold" : left <= 7 ? "text-[#B54708] font-semibold" : "text-muted"}>{left < 0 ? `${-left} gün gecikti` : `son gün ${formatDate(r.due_on)} (${left} gün)`}</span>}</div>
                  <p className="text-sm whitespace-pre-line bg-[#F5F7FA] rounded-lg p-3">{r.details}</p>
                  <form action={saveRequest} className="flex flex-col gap-2 text-sm">
                    <input type="hidden" name="id" value={r.id} />
                    <textarea name="response" rows={3} defaultValue={r.response ?? ""} placeholder="Yanıt (başvurana iletilecek metin)" className={`${input} h-auto py-2`} aria-label="Yanıt" />
                    <div className="flex flex-wrap gap-2"><select name="status" defaultValue={r.status} className={`${input} w-44`} aria-label="Durum">{Object.entries(STATUS).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}</select><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit></div>
                  </form>
                </Card>
              );
            })}
            {(reqs ?? []).length === 0 && <Card><p className="text-sm text-muted">Başvuru yok. Çalışanlar mobil uygulamadan, adaylar ve eski çalışanlar herkese açık başvuru formundan (/kvkk-basvuru) başvurabilir.</p></Card>}
            <Card title="Başvuru ekle (e-posta, dilekçe, noter vb.)">
              <form action={saveRequest} className="grid gap-2 sm:grid-cols-2 text-sm">
                <input name="requester_name" required placeholder="Başvuran ad soyad" className={input} />
                <input name="requester_contact" placeholder="İletişim (telefon / e-posta / adres)" className={input} />
                <select name="requester_type" className={input} aria-label="Başvuran"><option value="calisan">Çalışan</option><option value="eski_calisan">Eski çalışan</option><option value="aday">Aday</option><option value="diger">Diğer</option></select>
                <select name="request_type" className={input} aria-label="Talep türü">{Object.entries(REQUEST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label className="flex flex-col gap-1 text-muted">Alındığı tarih<input name="received_at" type="date" defaultValue={today} className={input} /></label>
                <textarea name="details" required rows={2} placeholder="Talep" className={`${input} h-auto py-2 sm:col-span-2`} />
                <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold justify-self-start">Ekle</PendingSubmit>
              </form>
            </Card>
          </>
        )}

        {tab === "erisim" && <AccessLog />}

        {tab === "imha" && <Retention disposals={disposals ?? []} owner={s.role === "owner"} />}

        {tab === "envanter" && (
          <Card title="Kişisel veri işleme envanteri (VERBİS için başlangıç)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr className="text-left text-xs text-muted">{["Veri kategorisi", "Örnek veriler", "İlgili kişi", "Amaç", "Hukuki sebep", "Aktarılan alıcılar"].map((h) => <th key={h} className="py-2 px-2 border-b border-line">{h}</th>)}</tr></thead>
                <tbody>{DATA_INVENTORY.map((d) => <tr key={d.category} className="border-b border-[#EEF2F6] align-top"><td className="py-2 px-2 font-semibold">{d.category}{d.special && <span className="block text-[10px] text-bad">özel nitelikli</span>}</td><td className="py-2 px-2">{d.examples}</td><td className="py-2 px-2">{d.subjects}</td><td className="py-2 px-2">{d.purpose}</td><td className="py-2 px-2">{d.basis}</td><td className="py-2 px-2">{d.recipients}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Teknik tedbirler: rol bazlı yetki (şef yalnız kendi bölümü), ücret bilgisine yalnız sahip/muhasebe erişimi, şifreli bağlantı (HTTPS), veritabanı satır düzeyi güvenlik, değişiklik kaydı (audit), hassas veri erişim kaydı, TC/IBAN maskeleme, otomatik imha. İdari tedbirler: gizlilik taahhütleri, KVKK eğitimi, periyodik imha.</p>
          </Card>
        )}

        {tab === "ihlal" && <Breaches />}
      </div>
    </>
  );
}

async function AccessLog() {
  const supabase = await createClient();
  const [{ data }, { data: dir }] = await Promise.all([
    supabase.from("kvkk_access_log").select("*").order("at", { ascending: false }).limit(300),
    supabase.rpc("company_directory"),
  ]);
  const names = new Map(((dir ?? []) as Array<{ user_id: string; display_name: string }>).map((d) => [d.user_id, d.display_name]));
  const { data: emps } = await supabase.from("employees").select("id, first_name, last_name");
  const en = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  return (
    <Card title="Hassas veri erişim kaydı (son 300)">
      <p className="text-xs text-muted">Personel kartı görüntüleme, TC/IBAN açma, belge indirme, rapor dışa aktarma ve aday görüntüleme kaydedilir. Kayıtlar 2 yıl saklanır. İK kendi kayıtlarını göremez; yalnız şirket sahibi tümünü görür.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Zaman</th><th className="py-2 px-2">Kullanıcı</th><th className="py-2 px-2">İşlem</th><th className="py-2 px-2">Kayıt</th><th className="py-2 px-2">Ayrıntı</th></tr></thead>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.id} className={`border-t border-[#EEF2F6] ${r.action === "reveal" || r.action === "export" ? "bg-[#FFFBF2]" : ""}`}><td className="py-1.5 px-2 whitespace-nowrap">{dt(r.at)}</td><td className="py-1.5 px-2">{names.get(r.user_id) ?? "—"}</td><td className="py-1.5 px-2">{ACTION[r.action] ?? r.action}</td><td className="py-1.5 px-2">{ENTITY[r.entity] ?? r.entity}{r.entity === "employee" || r.entity === "document" ? ` · ${en.get(r.entity_id) ?? ""}` : r.entity === "report" ? ` · ${r.entity_id}` : ""}</td><td className="py-1.5 px-2 text-muted">{r.detail ?? ""}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

async function Retention({ disposals, owner }: { disposals: Array<{ id: string; category: string; method: string; record_count: number; detail: string | null; done_at: string }>; owner: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("kvkk_retention").select("*").order("sort");
  const auto = new Set(["Puantaj (PDKS)", "Özlük dosyası", "Bordro ve ücret", "Sağlık ve İSG", "İletişim ve duyurular", "Erişim kayıtları (log)", "Aday başvuruları"]);
  return (
    <>
      <Card title="Saklama ve imha politikası">
        <p className="text-xs text-muted">Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hâle Getirilmesi Hakkında Yönetmelik: süresi dolan veriler en geç 6 ayda bir yapılan periyodik imha ile yok edilir ve işlem 3 yıl saklanan bir tutanakla kayıt altına alınır. Aday başvuruları her gün otomatik silinir.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Kategori</th><th className="py-2 px-2">Veriler</th><th className="py-2 px-2">Dayanak</th><th className="py-2 px-2">Süre</th><th className="py-2 px-2">Yöntem</th><th className="py-2 px-2"></th></tr></thead>
            <tbody>{(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-[#EEF2F6] align-top"><td className="py-2 px-2 font-semibold">{r.category}</td><td className="py-2 px-2">{r.data}</td><td className="py-2 px-2 text-xs">{r.legal_basis}</td><td className="py-2 px-2">{r.retention}</td><td className="py-2 px-2">{r.action}</td>
                <td className="py-2 px-2">{owner && auto.has(r.category) && <form action={runDisposal}><input type="hidden" name="category" value={r.category} /><ConfirmSubmit label="İmhayı çalıştır" question="Süresi dolan kayıtlar kalıcı olarak silinecek / anonimleştirilecek. Devam?" yes="Evet, imha et" className="text-xs font-semibold text-bad whitespace-nowrap" /></form>}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {!owner && <p className="text-xs text-muted">İmhayı yalnız şirket sahibi çalıştırabilir.</p>}
      </Card>
      <Card title="İmha tutanakları">
        {disposals.length === 0 ? <p className="text-sm text-muted">Henüz imha yapılmadı.</p> : <ul className="text-sm divide-y divide-[#EEF2F6]">{disposals.map((d) => <li key={d.id} className="py-2"><b>{d.category}</b> · {d.method} · {d.record_count} kayıt · {dt(d.done_at)}<div className="text-xs text-muted">{d.detail}</div></li>)}</ul>}
      </Card>
    </>
  );
}

async function Breaches() {
  const supabase = await createClient();
  const { data } = await supabase.from("kvkk_breaches").select("*").order("occurred_at", { ascending: false });
  return (
    <>
      <Card title="Veri ihlali kayıtları">
        <p className="text-xs text-muted">KVKK md. 12/5: veri ihlali öğrenildikten sonra en geç 72 saat içinde Kurul&apos;a (ihlalbildirim.kvkk.gov.tr) ve makul sürede ilgili kişilere bildirilir. Bildirim yapılmasa da her ihlal kayıt altına alınmalıdır.</p>
        {(data ?? []).length === 0 && <p className="text-sm text-muted">Kayıtlı ihlal yok.</p>}
        <ul className="text-sm divide-y divide-[#EEF2F6]">{(data ?? []).map((b) => {
          const overdue = !b.board_notified_at && Date.parse(b.detected_at) < Date.now() - 72 * 3600_000;
          return <li key={b.id} className="py-2"><b>{dt(b.occurred_at)}</b> · {b.description}<div className="text-xs text-muted">{b.data_categories ?? ""}{b.affected_count ? ` · ${b.affected_count} kişi` : ""}{b.measures ? ` · tedbir: ${b.measures}` : ""}</div><div className={`text-xs ${overdue ? "text-bad font-semibold" : "text-muted"}`}>{b.board_notified_at ? `Kurul'a bildirildi: ${dt(b.board_notified_at)}` : overdue ? "72 saatlik bildirim süresi geçti!" : "Kurul'a bildirim bekleniyor"}</div></li>;
        })}</ul>
      </Card>
      <Card title="İhlal kaydet">
        <form action={saveBreach} className="grid gap-2 sm:grid-cols-2 text-sm">
          <label className="flex flex-col gap-1 text-muted">Olay zamanı<input type="datetime-local" name="occurred_at" required className={input} /></label>
          <label className="flex flex-col gap-1 text-muted">Kurul&apos;a bildirim zamanı<input type="datetime-local" name="board_notified_at" className={input} /></label>
          <textarea name="description" required rows={2} placeholder="Ne oldu? (ör. bordro listesi yanlış kişiye e-postayla gönderildi)" className={`${input} h-auto py-2 sm:col-span-2`} />
          <input name="data_categories" placeholder="Etkilenen veriler" className={input} />
          <input name="affected_count" type="number" min={0} placeholder="Etkilenen kişi sayısı" className={input} />
          <input name="measures" placeholder="Alınan tedbirler" className={`${input} sm:col-span-2`} />
          <PendingSubmit className="h-10 px-4 rounded-[10px] bg-[#B42318] text-white font-semibold justify-self-start">Kaydet</PendingSubmit>
        </form>
      </Card>
    </>
  );
}
