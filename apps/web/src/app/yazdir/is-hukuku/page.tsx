import { redirect } from "next/navigation";
import { annualLeaveEntitlement } from "@mb/core";
import { PrintButton } from "@/components/PrintButton";
import { logAccess } from "@/lib/kvkk";
import { DECISION_LABEL } from "@/lib/labor";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/timekeeping";

export const dynamic = "force-dynamic";

type Emp = { id: string; first_name: string; last_name: string; hire_date: string | null; card_no: string | null; departments: { name: string } | null; job_titles?: { name: string } | null };
const EMP = "id, first_name, last_name, hire_date, card_no, departments(name)";
const d = (iso?: string | null) => (iso ? formatDate(iso.slice(0, 10)) : "…………");
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });

/**
 * İş Kanunu belgeleri: ?tur=disiplin&id=…  (olay tutanağı + savunma istem yazısı)
 *                      ?tur=degisiklik&id=… (md. 22 esaslı değişiklik bildirimi)
 *                      ?tur=izin-kayit&yil=2026[&personel=…] (yıllık izin kayıt belgesi)
 */
export default async function LaborPrint({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let pages: React.ReactNode[] = [];
  let label = "";

  if (sp.tur === "disiplin" && sp.id) {
    const { data: c } = await supabase.from("disciplinary_cases").select(`*, employees(${EMP})`).eq("id", sp.id).maybeSingle();
    if (c) {
      const e = c.employees as unknown as Emp;
      await logAccess(supabase, s.companyId, s.userId, "download", "disciplinary_cases", c.id, "tutanak yazdırıldı");
      label = `${e.first_name} ${e.last_name} · disiplin`;
      pages = [
        <Sheet key="t" title="OLAY TESPİT TUTANAĞI" company={s.companyName}>
          <Who e={e} />
          <Row k="Olay tarihi ve saati" v={dt(c.incident_at)} />
          <Row k="Konu" v={c.category} />
          <p className="mt-4 font-semibold">Olayın açıklaması</p>
          <p className="whitespace-pre-line border border-[#C5D0DC] rounded p-3 min-h-32">{c.description}</p>
          <p className="mt-4 text-[12.5px]">Yukarıda açıklanan olay tarafımızca görülmüş / tespit edilmiş olup işbu tutanak birlikte imza altına alınmıştır.</p>
          <Signs labels={(c.witnesses ? String(c.witnesses).split(/[,\n]/).map((x: string) => x.trim()).filter(Boolean) : []).concat(["Tutanağı düzenleyen"]).slice(0, 4)} />
        </Sheet>,
        <Sheet key="s" title="SAVUNMA İSTEM YAZISI" company={s.companyName}>
          <p className="text-right">Tarih: {d(c.defense_requested_at ?? todayIso())}</p>
          <p className="mt-2">Sayın <b>{e.first_name} {e.last_name}</b>,</p>
          <p className="mt-3 leading-relaxed">{dt(c.incident_at)} tarihinde meydana gelen ve aşağıda özetlenen olay nedeniyle, 4857 sayılı İş Kanunu’nun 19. maddesi ve iş sözleşmeniz gereği yazılı savunmanızın alınmasına ihtiyaç duyulmuştur.</p>
          <p className="whitespace-pre-line border border-[#C5D0DC] rounded p-3 mt-3"><b>{c.category}:</b> {c.description}</p>
          <p className="mt-3 leading-relaxed">Yazılı savunmanızı en geç <b>{d(c.defense_due)}</b> tarihine kadar İnsan Kaynaklarına teslim etmeniz ya da uygulama üzerinden göndermeniz gerekmektedir. Belirtilen süre içinde savunma vermemeniz hâlinde savunma hakkınızdan feragat etmiş sayılacağınızı ve mevcut bilgiler doğrultusunda değerlendirme yapılacağını bildiririz.</p>
          <div className="mt-8 grid grid-cols-2 gap-10 text-center text-[12.5px]">
            <div><div className="h-14" /><div className="border-t border-black pt-1">İşveren / vekili (kaşe, imza)</div></div>
            <div><div className="h-14" /><div className="border-t border-black pt-1">Tebellüğ eden: {e.first_name} {e.last_name}<br />Tarih: ……/……/………</div></div>
          </div>
          <p className="text-[11px] text-[#5A6878] mt-4">Tebellüğden kaçınılması hâlinde iki tanık huzurunda tutanak düzenlenir.</p>
          <div className="border-t-2 border-dashed border-[#9AA7B5] mt-8 pt-4">
            <p className="font-semibold">SAVUNMA</p>
            {c.defense_text ? <p className="whitespace-pre-line mt-2">{c.defense_text}<br /><span className="text-[11px] text-[#5A6878]">({d(c.defense_received_at)} tarihinde {c.defense_channel === "mobil" ? "uygulama üzerinden" : "yazılı"} alındı)</span></p> : <div className="h-48" />}
            <div className="mt-4 text-right text-[12.5px]">Ad soyad / imza: ………………………………</div>
          </div>
          {c.decision && <p className="mt-6 text-[12.5px]"><b>Karar:</b> {DECISION_LABEL[c.decision]}{c.wage_cut_days ? ` · ${c.wage_cut_days} gün ücret kesme (${c.wage_cut_period})` : ""}{c.decision_note ? ` · ${c.decision_note}` : ""} ({d(c.decided_at)})</p>}
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "degisiklik" && sp.id) {
    const { data: c } = await supabase.from("condition_changes").select(`*, employees(${EMP})`).eq("id", sp.id).maybeSingle();
    if (c) {
      const e = c.employees as unknown as Emp;
      label = `${e.first_name} ${e.last_name} · esaslı değişiklik`;
      pages = [
        <Sheet key="c" title="ÇALIŞMA KOŞULLARINDA DEĞİŞİKLİK BİLDİRİMİ" company={s.companyName}>
          <p className="text-right">Tarih: {d(c.notified_at)}</p>
          <Who e={e} />
          <p className="mt-3 leading-relaxed">4857 sayılı İş Kanunu’nun 22. maddesi uyarınca, çalışma koşullarınızda aşağıda belirtilen değişikliğin yapılması planlanmaktadır.</p>
          <Row k="Değişiklik türü" v={c.change_type} />
          <Row k="Yürürlük tarihi" v={d(c.effective_date)} />
          <p className="whitespace-pre-line border border-[#C5D0DC] rounded p-3 mt-3 min-h-24">{c.description}</p>
          <p className="mt-3 leading-relaxed">Bu değişikliği kabul edip etmediğinizi, bildirimin tarafınıza ulaştığı tarihten itibaren <b>altı iş günü içinde (en geç {d(c.response_due)})</b> yazılı olarak bildirmeniz gerekmektedir. Bu süre içinde yazılı olarak kabul etmediğiniz değişiklik sizi bağlamaz.</p>
          <div className="mt-6 grid grid-cols-2 gap-10 text-center text-[12.5px]">
            <div><div className="h-14" /><div className="border-t border-black pt-1">İşveren / vekili (kaşe, imza)</div></div>
            <div><div className="h-14" /><div className="border-t border-black pt-1">Tebellüğ eden: {e.first_name} {e.last_name}</div></div>
          </div>
          <div className="border-t-2 border-dashed border-[#9AA7B5] mt-8 pt-4">
            <p className="font-semibold">İŞÇİNİN BEYANI</p>
            <p className="mt-3">☐ Yukarıdaki değişikliği kabul ediyorum.&nbsp;&nbsp;&nbsp;&nbsp;☐ Yukarıdaki değişikliği kabul etmiyorum.</p>
            {c.responded_at && <p className="mt-2 text-[12.5px]">Uygulama üzerinden {d(c.responded_at)} tarihinde verilen yanıt: <b>{c.response === "accepted" ? "Kabul ediyorum" : "Kabul etmiyorum"}</b>{c.response_note ? ` · ${c.response_note}` : ""}</p>}
            <div className="mt-8 text-right text-[12.5px]">Tarih: ……/……/……… &nbsp;&nbsp; Ad soyad / imza: ………………………………</div>
          </div>
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "izin-kayit") {
    const year = Number(sp.yil) || new Date().getFullYear();
    let eq = supabase.from("employees").select(EMP).neq("status", "terminated").not("hire_date", "is", null).order("first_name");
    if (sp.personel) eq = eq.eq("id", sp.personel);
    const [{ data: emps }, leaves, { data: plans }, { data: privs }] = await Promise.all([
      eq,
      fetchAll<{ employee_id: string; start_date: string; end_date: string; days: number }>((a, b) => supabase.from("leave_requests").select("employee_id, start_date, end_date, days, leave_types!inner(code)").eq("status", "approved").eq("leave_types.code", "YILLIK").gte("start_date", `${year}-01-01`).lte("start_date", `${year}-12-31`).order("start_date").range(a, b)),
      supabase.from("leave_plans").select("employee_id, start_date, end_date, days").eq("year", year).order("start_date"),
      supabase.from("employee_private").select("employee_id, birth_date"),
    ]);
    const birth = new Map((privs ?? []).map((p) => [p.employee_id as string, p.birth_date as string | null]));
    label = `${year} yıllık izin kayıt belgeleri`;
    pages = ((emps ?? []) as unknown as Emp[]).map((e) => {
      const used = leaves.filter((l) => l.employee_id === e.id);
      const plan = (plans ?? []).filter((p) => p.employee_id === e.id);
      const ent = annualLeaveEntitlement(e.hire_date!, `${year}-12-31`, birth.get(e.id) ?? null);
      const rows = [...used.map((l) => ({ ...l, kind: "Kullanıldı" })), ...plan.filter((p) => !used.some((u) => u.start_date === p.start_date)).map((p) => ({ ...p, kind: "Planlandı" }))].sort((a, b) => a.start_date.localeCompare(b.start_date));
      return (
        <Sheet key={e.id} title={`YILLIK ÜCRETLİ İZİN KAYIT BELGESİ · ${year}`} company={s.companyName}>
          <Who e={e} />
          <Row k="Kıdem (yıl sonu itibarıyla)" v={`${ent.completedYears} yıl`} />
          <Row k="Yıllık izin süresi" v={`${ent.nextYearDays} iş günü (sonraki hak ediş ${d(ent.nextAnniversary)})`} />
          <table className="w-full text-[12.5px] mt-4 border-collapse">
            <thead><tr className="bg-[#EEF3F9]">{["#", "Durum", "Başlangıç", "Bitiş", "İşe dönüş", "Gün", "İşçi imzası"].map((h) => <th key={h} className="border border-[#9AA7B5] px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const back = new Date(Date.parse(r.end_date + "T12:00:00Z") + 86_400_000);
                if (back.getUTCDay() === 0) back.setUTCDate(back.getUTCDate() + 1);
                return <tr key={i}><td className="border border-[#9AA7B5] px-2 py-2">{i + 1}</td><td className="border border-[#9AA7B5] px-2">{r.kind}</td><td className="border border-[#9AA7B5] px-2">{d(r.start_date)}</td><td className="border border-[#9AA7B5] px-2">{d(r.end_date)}</td><td className="border border-[#9AA7B5] px-2">{d(back.toISOString())}</td><td className="border border-[#9AA7B5] px-2 text-right">{Number(r.days)}</td><td className="border border-[#9AA7B5] px-2 w-32" /></tr>;
              })}
              {Array.from({ length: Math.max(0, 4 - rows.length) }, (_, i) => <tr key={`b${i}`}>{Array.from({ length: 7 }, (_, j) => <td key={j} className="border border-[#9AA7B5] px-2 py-3" />)}</tr>)}
              <tr className="font-semibold"><td colSpan={5} className="border border-[#9AA7B5] px-2 py-1 text-right">Bu yıl kullanılan</td><td className="border border-[#9AA7B5] px-2 text-right">{used.reduce((a, l) => a + Number(l.days), 0)}</td><td className="border border-[#9AA7B5]" /></tr>
            </tbody>
          </table>
          <p className="text-[11px] text-[#5A6878] mt-3">Yıllık Ücretli İzin Yönetmeliği uyarınca işveren, işyerinde çalışan her işçi için izin kayıt belgesi tutmak zorundadır. Yıllık izin bölünerek kullanılabilir; bölümlerden biri 10 günden az olamaz.</p>
          <div className="mt-8 grid grid-cols-2 gap-10 text-center text-[12.5px]">
            <div><div className="h-12" /><div className="border-t border-black pt-1">İşveren / vekili</div></div>
            <div><div className="h-12" /><div className="border-t border-black pt-1">{e.first_name} {e.last_name}</div></div>
          </div>
        </Sheet>
      );
    });
  }

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[#14202E]">
      <style>{`@page { size: A4; margin: 14mm; } .sheet { break-after: page; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-6 py-3 flex flex-wrap items-center gap-4">
        <span className="font-semibold">{label || "Belge bulunamadı"}</span>
        {pages.length > 0 && <PrintButton />}
        <span className="text-xs text-[#5A6878]">Şablon metinlerdir; uygulamadan önce avukat / mali müşavirle gözden geçirin.</span>
      </div>
      <div className="max-w-[182mm] mx-auto py-6 print:py-0 flex flex-col gap-6 print:gap-0">{pages}</div>
    </main>
  );
}

function Sheet({ title, company, children }: { title: string; company: string; children: React.ReactNode }) {
  return (
    <section className="sheet bg-white border border-[#C5D0DC] print:border-0 rounded-lg print:rounded-none p-8 print:p-0 text-[13.5px]">
      <header className="flex justify-between items-center border-b-2 border-[#0A3D73] pb-2 mb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-10 h-10 object-contain" />
          <b>{company}</b>
        </div>
        <span className="font-bold text-[14px] text-right">{title}</span>
      </header>
      {children}
    </section>
  );
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex gap-3 py-1"><span className="w-48 shrink-0 text-[#5A6878]">{k}</span><span className="font-semibold">{v}</span></div>;
const Who = ({ e }: { e: Emp }) => (
  <>
    <Row k="Adı soyadı" v={`${e.first_name} ${e.last_name}`} />
    <Row k="Bölüm" v={e.departments?.name ?? "—"} />
    <Row k="İşe giriş tarihi" v={d(e.hire_date)} />
  </>
);
function Signs({ labels }: { labels: string[] }) {
  return (
    <div className="mt-10 grid gap-8 text-center text-[12.5px]" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
      {labels.map((l, i) => <div key={i}><div className="h-14" /><div className="border-t border-black pt-1">{l}</div></div>)}
    </div>
  );
}
