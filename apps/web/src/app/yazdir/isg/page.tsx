import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { HAZARD_LABEL } from "@/lib/compliance";
import { TRAINING_KIND, level5x5, levelFK } from "@/lib/isg";
import { isgBase } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const d = (iso?: string | null) => (iso ? formatDate(String(iso).slice(0, 10)) : "……/……/………");
const c = "border border-[#9AA7B5] px-1.5 py-1 align-top";

/**
 * İSG belgeleri: ?tur=tutanak&id=oturum · belge&id=oturum (Ek-2 temel eğitim belgesi) · risk&id · kurul&id · kaza&id · defter
 */
export default async function IsgPrint({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const base = await isgBase(supabase);
  let pages: React.ReactNode[] = [];
  let label = "";
  const empNames = async (ids: string[]) => {
    if (!ids.length) return new Map<string, { name: string; dept: string; tc: string | null; title: string }>();
    const [{ data: e }, { data: p }] = await Promise.all([
      supabase.from("employees").select("id, first_name, last_name, position_title, departments(name)").in("id", ids),
      supabase.from("employee_private").select("employee_id, national_id").in("employee_id", ids),
    ]);
    const tc = new Map((p ?? []).map((x) => [x.employee_id as string, x.national_id as string | null]));
    return new Map((e ?? []).map((x) => [x.id as string, { name: `${x.first_name} ${x.last_name}`, dept: (x.departments as unknown as { name: string } | null)?.name ?? "", tc: tc.get(x.id) ?? null, title: (x.position_title as string | null) ?? "" }]));
  };

  if ((sp.tur === "tutanak" || sp.tur === "belge") && sp.id) {
    const { data: x } = await supabase.from("training_sessions").select("*, compliance_types(name)").eq("id", sp.id).maybeSingle();
    if (x) {
      const ids = x.employee_ids as string[];
      const people = await empNames(ids);
      const { data: recs } = await supabase.from("training_records").select("employee_id, exam_score").eq("session_id", x.id);
      const score = new Map((recs ?? []).map((r) => [r.employee_id as string, r.exam_score as number | null]));
      const tname = (x.compliance_types as unknown as { name: string } | null)?.name ?? "";
      label = `${tname} · ${d(x.held_on)}`;
      if (sp.tur === "tutanak") {
        pages = [
          <Sheet key="t" title="EĞİTİM KATILIM TUTANAĞI" company={base.company}>
            <Grid rows={[["Eğitim", `${tname} (${TRAINING_KIND[x.training_kind]})`], ["Tarih / saat", `${d(x.held_on)}${x.start_time ? ` · ${String(x.start_time).slice(0, 5)}–${String(x.end_time ?? "").slice(0, 5)}` : ""}`], ["Süre", `${Number(x.lesson_hours)} ders saati`], ["Yöntem", x.method === "yuz-yuze" ? "Yüz yüze" : x.method === "uzaktan" ? "Uzaktan" : "Karma"], ["Yer", x.location ?? "—"], ["Eğitici", `${x.trainer_name}${x.trainer_title ? ` · ${x.trainer_title}` : ""}`], ["Tehlike sınıfı", HAZARD_LABEL[base.hazard]], ["NACE", base.nace ?? "—"]]} />
            {(x.topics as string[]).length > 0 && <><h3 className="font-semibold mt-3 mb-1 text-[13px]">Konu başlıkları</h3><ul className="text-[12px] list-disc pl-5 columns-2">{(x.topics as string[]).map((t) => <li key={t}>{t}</li>)}</ul></>}
            <table className="w-full text-[11.5px] border-collapse mt-3">
              <thead><tr className="bg-[#EEF3F9]">{["#", "Ad soyad", "TC kimlik no", "Bölüm", ...(x.exam ? ["Sınav"] : []), "İmza"].map((h) => <th key={h} className={`${c} text-left`}>{h}</th>)}</tr></thead>
              <tbody>{ids.map((id, i) => { const p = people.get(id); return <tr key={id}><td className={c}>{i + 1}</td><td className={c}>{p?.name}</td><td className={c}>{p?.tc ?? ""}</td><td className={c}>{p?.dept}</td>{x.exam && <td className={`${c} text-right`}>{score.get(id) ?? ""}</td>}<td className={`${c} w-28 h-7`} /></tr>; })}</tbody>
            </table>
            <p className="text-[10.5px] text-[#5A6878] mt-2">Çalışanların İş Sağlığı ve Güvenliği Eğitimlerinin Usul ve Esasları Hakkında Yönetmelik (RG 02.04.2026/33212) uyarınca düzenlenmiştir. Bir ders saati 45 dakika ders ve 15 dakika aradan oluşur. Eğitim süresi çalışma süresinden sayılır; maliyeti çalışana yansıtılamaz.</p>
            <div className="mt-6 grid grid-cols-2 gap-10 text-center text-[12px]"><Sign label="Eğitici" name={x.trainer_name} /><Sign label="İşveren / vekili" name="" /></div>
          </Sheet>,
        ];
      } else {
        pages = ids.filter((id) => (score.get(id) ?? 100) >= 60).map((id) => {
          const p = people.get(id);
          return (
            <Sheet key={id} title="TEMEL İŞ SAĞLIĞI VE GÜVENLİĞİ EĞİTİMİ BELGESİ" company={base.company}>
              <p className="text-center text-[12px] text-[#5A6878] mb-3">(Yönetmelik Ek-2)</p>
              <Grid rows={[["Adı soyadı", p?.name ?? ""], ["TC kimlik no", p?.tc ?? "—"], ["Görevi / bölümü", [p?.title, p?.dept].filter(Boolean).join(" · ") || "—"], ["İşyeri tehlike sınıfı", HAZARD_LABEL[base.hazard]], ["Eğitim tarihi", d(x.held_on)], ["Eğitim süresi", `${Number(x.lesson_hours)} ders saati`], ["Eğitim yöntemi", x.method === "yuz-yuze" ? "Yüz yüze" : x.method === "uzaktan" ? "Uzaktan" : "Karma"], ...(score.get(id) !== null && score.get(id) !== undefined ? [["Sınav puanı", String(score.get(id))] as [string, string]] : [])]} />
              <p className="mt-4 leading-relaxed text-[13px]">Yukarıda bilgileri bulunan çalışan, işyerinde temel iş sağlığı ve güvenliği eğitimini başarıyla tamamlamıştır.</p>
              {(x.topics as string[]).length > 0 && <ul className="text-[11px] list-disc pl-5 columns-2 mt-2">{(x.topics as string[]).map((t) => <li key={t}>{t}</li>)}</ul>}
              <div className="mt-10 grid grid-cols-2 gap-10 text-center text-[12px]"><Sign label="Eğitici" name={`${x.trainer_name}${x.trainer_title ? ` (${x.trainer_title})` : ""}`} /><Sign label="İşveren / vekili" name="" /></div>
            </Sheet>
          );
        });
      }
    }
  }

  if (sp.tur === "risk" && sp.id) {
    const [{ data: a }, { data: items }] = await Promise.all([
      supabase.from("risk_assessments").select("*").eq("id", sp.id).maybeSingle(),
      supabase.from("risk_items").select("*").eq("assessment_id", sp.id).order("sort").order("area"),
    ]);
    if (a) {
      const fk = a.method === "fine-kinney";
      label = a.title;
      pages = [
        <Sheet key="r" title="RİSK DEĞERLENDİRMESİ RAPORU" company={base.company} landscape>
          <Grid rows={[["Başlık", a.title], ["Tarih", d(a.done_on)], ["Geçerlilik", d(a.valid_until)], ["Yöntem", fk ? "Fine-Kinney" : "5×5 matris"], ["Tehlike sınıfı / NACE", `${HAZARD_LABEL[base.hazard]} · ${base.nace ?? "—"}`]]} />
          <table className="w-full text-[10px] border-collapse mt-3">
            <thead><tr className="bg-[#EEF3F9]">{["#", "Bölüm / faaliyet", "Tehlike", "Risk", "Etkilenen", fk ? "O" : "O", ...(fk ? ["F"] : []), "Ş", "Skor", "Mevcut önlem", "Alınacak önlem", "Sorumlu", "Termin", "Kalan"].map((h, i) => <th key={i} className={`${c} text-left`}>{h}</th>)}</tr></thead>
            <tbody>{(items ?? []).map((it, i) => { const sc = Number(it.p) * Number(it.s) * (fk ? Number(it.f ?? 1) : 1); const [l] = fk ? levelFK(sc) : level5x5(sc); const r = it.rp && it.rs ? Number(it.rp) * Number(it.rs) * (fk ? Number(it.rf ?? 1) : 1) : null; return (
              <tr key={it.id}><td className={c}>{i + 1}</td><td className={c}>{it.area}{it.activity ? ` / ${it.activity}` : ""}</td><td className={c}>{it.hazard}</td><td className={c}>{it.risk}</td><td className={c}>{it.affected}</td><td className={c}>{Number(it.p)}</td>{fk && <td className={c}>{Number(it.f ?? 1)}</td>}<td className={c}>{Number(it.s)}</td><td className={c}><b>{sc}</b><br />{l}</td><td className={c}>{it.existing_controls}</td><td className={c}>{it.actions}</td><td className={c}>{it.responsible}</td><td className={c}>{it.due_date ? d(it.due_date) : ""}</td><td className={c}>{r ?? ""}</td></tr>
            ); })}</tbody>
          </table>
          <h3 className="font-semibold mt-4 mb-1 text-[12px]">Risk değerlendirmesi ekibi</h3>
          <div className="grid grid-cols-5 gap-4 text-center text-[11px]">{((a.team as Array<{ name: string; role: string }>) ?? []).map((t, i) => <Sign key={i} label={t.role} name={t.name} />)}</div>
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "kurul" && sp.id) {
    const { data: m } = await supabase.from("committee_meetings").select("*").eq("id", sp.id).maybeSingle();
    if (m) {
      label = `${m.meeting_no}. kurul toplantısı`;
      const dec = (m.decisions as Array<{ text: string; responsible?: string; due?: string | null }>) ?? [];
      pages = [
        <Sheet key="k" title="İSG KURULU TOPLANTI TUTANAĞI" company={base.company}>
          <Grid rows={[["Toplantı no", String(m.meeting_no)], ["Tarih", d(m.held_on)]]} />
          <h3 className="font-semibold mt-3 mb-1 text-[13px]">Gündem</h3>
          <ol className="text-[12.5px] list-decimal pl-5">{(m.agenda as string[]).map((a, i) => <li key={i}>{a}</li>)}</ol>
          {m.notes && <><h3 className="font-semibold mt-3 mb-1 text-[13px]">Görüşmeler</h3><p className="whitespace-pre-line text-[12.5px]">{m.notes}</p></>}
          <h3 className="font-semibold mt-3 mb-1 text-[13px]">Kararlar</h3>
          <table className="w-full text-[12px] border-collapse"><thead><tr className="bg-[#EEF3F9]">{["#", "Karar", "Sorumlu", "Termin"].map((h) => <th key={h} className={`${c} text-left`}>{h}</th>)}</tr></thead><tbody>{dec.map((x, i) => <tr key={i}><td className={c}>{i + 1}</td><td className={c}>{x.text}</td><td className={c}>{x.responsible}</td><td className={c}>{x.due ? d(x.due) : ""}</td></tr>)}</tbody></table>
          <h3 className="font-semibold mt-4 mb-1 text-[13px]">Katılanlar</h3>
          <div className="grid grid-cols-3 gap-6 text-center text-[11px]">{(m.attendees as string[]).map((a, i) => <Sign key={i} label={a.replace(/^.*\((.*)\)$/, "$1")} name={a.replace(/\s*\(.*\)$/, "")} />)}</div>
          <p className="text-[10.5px] text-[#5A6878] mt-3">İş Sağlığı ve Güvenliği Kurulları Hakkında Yönetmelik uyarınca kararlar işyerinde duyurulur.</p>
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "kaza" && sp.id) {
    const { data: x } = await supabase.from("safety_incidents").select("*").eq("id", sp.id).maybeSingle();
    if (x) {
      const p = x.employee_id ? (await empNames([x.employee_id])).get(x.employee_id) : null;
      label = `${p?.name ?? ""} · ${x.kind === "KAZA" ? "iş kazası" : x.kind === "RAMAK_KALA" ? "ramak kala" : "meslek hastalığı"}`;
      pages = [
        <Sheet key="z" title={x.kind === "RAMAK_KALA" ? "RAMAK KALA OLAY RAPORU" : x.kind === "KAZA" ? "İŞ KAZASI ARAŞTIRMA RAPORU" : "MESLEK HASTALIĞI KAYDI"} company={base.company}>
          <h3 className="font-semibold mb-1 text-[13px]">Kazazede</h3>
          <Grid rows={[["Adı soyadı", p?.name ?? "—"], ["TC kimlik no", p?.tc ?? "—"], ["Bölüm / görev", [p?.dept, p?.title].filter(Boolean).join(" · ") || "—"]]} />
          <h3 className="font-semibold mt-3 mb-1 text-[13px]">Olay</h3>
          <Grid rows={[["Tarih ve saat", new Date(x.occurred_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })], ["Yer", x.location ?? "—"], ["Yaralanan uzuv", x.body_part ?? "—"], ["Yaralanma türü", x.injury_type ?? x.injury ?? "—"], ["Sevk edilen kurum", x.hospital ?? "—"], ["İstirahat", x.report_days ? `${x.report_days} gün` : "—"], ["Tanıklar", x.witnesses ?? "—"], ["İşyeri sicil / NACE", base.nace ?? "—"]]} />
          <p className="mt-3 whitespace-pre-line border border-[#C5D0DC] rounded p-3 text-[12.5px] min-h-20"><b>Olayın oluşu:</b> {x.description}</p>
          <p className="mt-2 text-[12.5px]"><b>İlk müdahale:</b> {x.actions_taken ?? "—"}</p>
          <p className="mt-2 text-[12.5px]"><b>Kök neden:</b> {x.root_cause ?? "………………………………………………"}</p>
          <p className="mt-2 text-[12.5px]"><b>Düzeltici / önleyici faaliyet:</b> {x.corrective_actions ?? "………………………………………………"}</p>
          {x.kind !== "RAMAK_KALA" && <div className="mt-3 rounded border border-[#C5D0DC] p-3 text-[12px]"><b>SGK bildirimi</b> (5510 s. Kanun md. 13: olaydan sonraki 3 iş günü içinde, İş Kazası ve Meslek Hastalığı E-Bildirim uygulamasından): {x.sgk_notified_on ? `${d(x.sgk_notified_on)} tarihinde yapıldı${x.sgk_ref ? ` · ref. ${x.sgk_ref}` : ""}` : "henüz yapılmadı"}. Çalışan işe dönmeden önce ilave eğitim alır (Eğitim Yönetmeliği 2026).</div>}
          <div className="mt-8 grid grid-cols-3 gap-6 text-center text-[11.5px]"><Sign label="Kazazede" name={p?.name ?? ""} /><Sign label="İş güvenliği uzmanı" name="" /><Sign label="İşveren / vekili" name="" /></div>
        </Sheet>,
      ];
    }
  }

  if (sp.tur === "defter") {
    const { data: list } = await supabase.from("isg_findings").select("*").neq("status", "kapandi").order("found_on");
    label = "Açık tespit ve öneriler";
    pages = [
      <Sheet key="d" title="AÇIK TESPİT VE ÖNERİLER" company={base.company} landscape>
        <p className="text-[12px] mb-2">Tarih: {d(todayIso())}</p>
        <table className="w-full text-[11px] border-collapse"><thead><tr className="bg-[#EEF3F9]">{["#", "Tarih", "Defter s.", "Alan", "Tespit", "Öneri", "Önem", "Sorumlu", "Termin", "Durum"].map((h) => <th key={h} className={`${c} text-left`}>{h}</th>)}</tr></thead>
          <tbody>{(list ?? []).map((x, i) => <tr key={x.id}><td className={c}>{i + 1}</td><td className={c}>{d(x.found_on)}</td><td className={c}>{x.book_page}</td><td className={c}>{x.area}</td><td className={c}>{x.description}</td><td className={c}>{x.recommendation}</td><td className={c}>{x.level}</td><td className={c}>{x.responsible}</td><td className={c}>{x.due_date ? d(x.due_date) : ""}</td><td className={c}>{x.status === "acik" ? "Açık" : "İşlemde"}</td></tr>)}</tbody></table>
      </Sheet>,
    ];
  }

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[#14202E]">
      <style>{`@page { size: A4 ${pages.length && (sp.tur === "risk" || sp.tur === "defter") ? "landscape" : "portrait"}; margin: 10mm; } .sheet { break-after: page; } .sheet:last-child { break-after: auto; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 md:px-6 py-3 flex flex-wrap items-center gap-3">
        <span className="font-semibold">{label || "Belge bulunamadı"}{pages.length > 1 ? ` · ${pages.length} sayfa` : ""}</span>
        {pages.length > 0 && <PrintButton />}
      </div>
      <div className={`${sp.tur === "risk" || sp.tur === "defter" ? "max-w-[277mm]" : "max-w-[190mm]"} mx-auto py-6 print:py-0 px-3 print:px-0 flex flex-col gap-6 print:gap-0`}>{pages}</div>
    </main>
  );
}

function Sheet({ title, company, children, landscape }: { title: string; company: string; children: React.ReactNode; landscape?: boolean }) {
  return (
    <section className={`sheet bg-white border border-[#C5D0DC] print:border-0 rounded-lg print:rounded-none p-6 md:p-8 print:p-0 text-[13px] ${landscape ? "" : ""}`}>
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
  return <div className="grid sm:grid-cols-2 gap-x-6">{rows.map(([k, v]) => <div key={k} className="flex gap-3 py-1 border-b border-[#EEF2F6]"><span className="w-40 shrink-0 text-[#5A6878]">{k}</span><span className="font-semibold">{v}</span></div>)}</div>;
}
function Sign({ label, name }: { label: string; name: string }) {
  return <div><div className="text-[#5A6878]">{label}</div><div className="h-10" /><div className="border-t border-black pt-1 font-semibold">{name || " "}</div></div>;
}
