import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { SITE_URL } from "@/lib/handoff";
import { waLink } from "@/lib/wa";
import { SURVEY, svLang } from "@/lib/survey-text";
import { markSurveysSent, saveSurveySettings, sendSurvey } from "@/lib/quality-actions";
import { QNav } from "../QNav";

export const dynamic = "force-dynamic";

type R = { id: string; token: string; score: number | null; comment: string | null; sent_at: string | null; answered_at: string | null; created_at: string; complaint_id: string | null; lab_customers: { name: string; phone: string | null; doc_lang: string | null } | null; jobs: { id: string; no: number; patient: string | null } | null };
const STARS = ["", "😞", "🙁", "😐", "🙂", "😍"];

/** Memnuniyet anketi: teslimden birkaç gün sonra tek soru; düşük puan şikâyet açar */
export default async function SurveyPage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const tab = sp.sekme === "yanit" ? "yanit" : sp.sekme === "gonderilen" ? "gonderilen" : "gonderilecek";
  const supabase = await createClient();
  let q = supabase.from("srv_responses").select("id, token, score, comment, sent_at, answered_at, created_at, complaint_id, lab_customers(name, phone, doc_lang), jobs(id, no, patient)").order("created_at", { ascending: false }).limit(300);
  q = tab === "yanit" ? q.not("answered_at", "is", null) : tab === "gonderilen" ? q.not("sent_at", "is", null).is("answered_at", null) : q.is("sent_at", null).is("answered_at", null);
  const [{ data }, { data: st }, { data: stats }] = await Promise.all([
    q,
    supabase.from("srv_settings").select("enabled, delay_days, min_days_between").maybeSingle(),
    supabase.from("srv_responses").select("score").not("score", "is", null).gte("answered_at", new Date(Date.now() - 90 * 86400000).toISOString()).limit(5000),
  ]);
  const rows = (data ?? []) as unknown as R[];
  const scores = ((stats ?? []) as { score: number }[]).map((x) => x.score);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null;
  const dist = [1, 2, 3, 4, 5].map((n) => scores.filter((x) => x === n).length);
  const promoters = scores.filter((x) => x === 5).length, detractors = scores.filter((x) => x <= 3).length;
  const nps = scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null;
  const canSet = (s.modules.production ?? 0) >= 3 || (s.modules.lab ?? 0) >= 3 || (s.modules.sales ?? 0) >= 3;

  return (
    <>
      <PageHeader title="Memnuniyet anketi" subtitle="Teslimden birkaç gün sonra hekime tek soruluk anket; 1-2 puan otomatik şikâyet kaydı açar" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1200px]">
        <QNav at="/kalite/anket" />
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 content-start">
            {[["Ortalama (90 gün)", avg ? `${avg} / 5` : "—"], ["Yanıt", scores.length], ["NPS benzeri skor", nps !== null ? nps : "—"], ["Düşük puan (1-2)", dist[0]! + dist[1]!]].map(([l, v]) => <div key={l as string} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>)}
            <div className="col-span-2 md:col-span-4 rounded-[16px] border border-line bg-white p-4 flex items-end gap-3 h-32">{dist.map((n, i) => <div key={i} className="flex-1 flex flex-col items-center gap-1"><span className="text-xs">{n}</span><div className="w-full rounded-t bg-brand-600" style={{ height: `${Math.max(2, (n / Math.max(1, ...dist)) * 70)}px` }} /><span>{STARS[i + 1]}</span></div>)}</div>
          </div>
          <Card title="Ayarlar">
            <form action={saveSurveySettings} className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={st?.enabled ?? false} disabled={!canSet} /> Anket açık (her sabah liste hazırlanır)</label>
              <label className="flex items-center gap-2">Teslimden <input name="delay" type="number" min={0} max={30} defaultValue={st?.delay_days ?? 3} className="h-9 w-16 rounded-[8px] border border-line px-2" disabled={!canSet} /> gün sonra</label>
              <label className="flex items-center gap-2">Aynı hekime en sık <input name="between" type="number" min={0} max={180} defaultValue={st?.min_days_between ?? 14} className="h-9 w-16 rounded-[8px] border border-line px-2" disabled={!canSet} /> günde bir</label>
              {canSet && <PendingSubmit className="h-9 px-3 rounded-[8px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>}
              <p className="text-xs text-muted">WhatsApp otomatik gönderilemediği için liste hazırlanır; her satırdaki düğmeyle tek tıkla gönderirsiniz. Portal kullanan hekim anketi portalda da görür.</p>
            </form>
          </Card>
        </div>
        <div className="flex gap-1">{[["gonderilecek", "Gönderilecek"], ["gonderilen", "Yanıt bekleyen"], ["yanit", "Yanıtlar"]].map(([k, l]) => <Link key={k} href={`/kalite/anket?sekme=${k}`} className={`h-9 px-3 inline-flex items-center rounded-[10px] text-sm font-semibold ${tab === k ? "bg-ink text-white" : "border border-line bg-white"}`}>{l}</Link>)}</div>
        <section className="rounded-[18px] border border-line bg-white">
          <ul className="divide-y divide-[#EEF2F6]">
            {rows.map((r) => {
              const lang = svLang(r.lab_customers?.doc_lang);
              const link = `${SITE_URL}/${lang}/anket/${r.token}`;
              const wa = waLink(r.lab_customers?.phone, SURVEY[lang].wa(r.lab_customers?.name ?? "", link));
              return (
                <li key={r.id} className="p-3 flex flex-wrap gap-3 items-center text-sm">
                  <span className="flex-1 min-w-[220px]"><b>{r.lab_customers?.name}</b> · {r.jobs ? <Link href={`/isler/${r.jobs.id}`} className="text-brand-700">İş #{r.jobs.no}</Link> : null} {r.jobs?.patient}</span>
                  {r.answered_at ? (
                    <><span className={`font-display text-lg font-bold ${(r.score ?? 0) <= 2 ? "text-bad" : (r.score ?? 0) >= 4 ? "text-ok" : ""}`}>{STARS[r.score ?? 0]} {r.score}/5</span>{r.comment && <span className="w-full text-muted">“{r.comment}”</span>}{r.complaint_id && <Link href={`/kalite?sikayet=${r.complaint_id}`} className="text-xs font-semibold text-bad">Şikâyet kaydı</Link>}<span className="text-xs text-muted">{formatDate(r.answered_at.slice(0, 10))}</span></>
                  ) : (
                    <>
                      <span className="text-xs text-muted">{r.sent_at ? `Gönderildi ${formatDate(r.sent_at.slice(0, 10))}` : `Hazır ${formatDate(r.created_at.slice(0, 10))}`}</span>
                      {wa ? <form action={sendSurvey}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="url" value={wa} /><button className="h-9 px-3 rounded-[8px] border border-[#25D366] text-[#128C7E] font-semibold">WhatsApp&apos;la {r.sent_at ? "tekrar " : ""}gönder</button></form> : <span className="text-xs text-muted">telefon yok</span>}
                      <a href={link} target="_blank" rel="noreferrer" className="text-xs text-brand-700">Bağlantı</a>
                      {!r.sent_at && <form action={markSurveysSent}><input type="hidden" name="id" value={r.id} /><PendingSubmit className="text-xs text-muted font-semibold">Gönderildi say</PendingSubmit></form>}
                    </>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && <li className="p-6 text-center text-sm text-muted">{tab === "gonderilecek" ? (st?.enabled ? "Gönderilecek anket yok; teslim edilen işler için her sabah eklenir." : "Anket kapalı. Ayarlardan açın.") : "Kayıt yok."}</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
