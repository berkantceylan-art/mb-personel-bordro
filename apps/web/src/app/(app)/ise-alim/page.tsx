import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { EXPERIENCE_OPTIONS, SOURCE_LABEL, STAGES } from "@/lib/recruiting";
import { formatDate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addCandidate } from "./actions";

type Cand = { id: string; first_name: string; last_name: string; phone: string; stage: string; source: string; experience: string | null; score: number | null; created_at: string; stage_changed_at: string; interview_at: string | null; candidate_reply: string | null; posting_id: string | null; job_postings: unknown };

/** İşe alım panosu: adaylar aşamalara göre; şef yalnız kendi bölümünün ilanlarını görür */
export default async function RecruitingPage({ searchParams }: { searchParams: Promise<{ ilan?: string; q?: string; kapali?: string; silindi?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const hr = s.role !== "branch_manager";
  const supabase = await createClient();
  let q = supabase.from("candidates").select("id, first_name, last_name, phone, stage, source, experience, score, created_at, stage_changed_at, interview_at, candidate_reply, posting_id, job_postings(title)").order("created_at", { ascending: false }).limit(500);
  if (sp.ilan === "genel") q = q.is("posting_id", null); else if (sp.ilan) q = q.eq("posting_id", sp.ilan);
  const [{ data, error }, { data: posts }] = await Promise.all([q, supabase.from("job_postings").select("id, title, status").order("created_at", { ascending: false })]);
  if (error) return (<><PageHeader title="İşe alım" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261110000000_recruiting.sql</b> çalıştırılmalı.</p></Card></div></>);
  const term = (sp.q ?? "").toLocaleLowerCase("tr");
  const all = ((data ?? []) as Cand[]).filter((c) => !term || `${c.first_name} ${c.last_name} ${c.phone}`.toLocaleLowerCase("tr").includes(term));
  const showClosed = sp.kapali === "1";
  const cols = [...STAGES.map(([k, l]) => [k, l] as const), ...(showClosed ? ([["rejected", "Reddedildi"], ["withdrawn", "Aday çekildi"]] as const) : [])];
  const open = (posts ?? []).filter((p) => p.status === "open");
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = all.filter((c) => c.created_at.startsWith(month)).length;
  const hired = all.filter((c) => c.stage === "hired");
  const avgDays = hired.length ? Math.round(hired.reduce((a, c) => a + (Date.parse(c.stage_changed_at) - Date.parse(c.created_at)) / 86_400_000, 0) / hired.length) : null;
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";
  const qs = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(Object.entries({ ilan: sp.ilan, q: sp.q, kapali: sp.kapali, ...o }).filter(([, v]) => v) as Array<[string, string]>); const t = u.toString(); return t ? `?${t}` : ""; };

  return (
    <>
      <PageHeader title="İşe alım" subtitle={`${open.length} açık ilan · bu ay ${thisMonth} başvuru${avgDays !== null ? ` · ortalama işe alım ${avgDays} gün` : ""}`} actions={
        <div className="flex gap-2 flex-wrap">
          {hr && <Link href="/ise-alim/ilanlar" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">İlanlar</Link>}
          <a href="/kariyer" target="_blank" rel="noopener" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Kariyer sayfası ↗</a>
        </div>
      } />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        {sp.silindi && <p className="rounded-lg bg-[#E6F4EC] text-ok px-3 py-2 text-sm font-semibold">Aday verisi ve dosyaları kalıcı olarak silindi.</p>}
        <form className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-1 text-xs text-muted">İlan
            <select name="ilan" defaultValue={sp.ilan ?? ""} className={input}>
              <option value="">Tüm ilanlar</option><option value="genel">Genel başvurular</option>
              {(posts ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}{p.status !== "open" ? " (kapalı)" : ""}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Ara<input name="q" defaultValue={sp.q ?? ""} placeholder="Ad veya telefon" className={input} /></label>
          {showClosed && <input type="hidden" name="kapali" value="1" />}
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Uygula</button>
          <Link href={`/ise-alim${qs({ kapali: showClosed ? undefined : "1" })}`} className="h-11 px-3 inline-flex items-center text-sm font-semibold text-brand-700">{showClosed ? "Kapananları gizle" : "Reddedilenleri göster"}</Link>
        </form>

        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(220px, 1fr))`, minWidth: `${cols.length * 232}px` }}>
            {cols.map(([k, label]) => {
              const list = all.filter((c) => c.stage === k);
              return (
                <section key={k} className="rounded-xl bg-[#EAEFF5] p-2.5 flex flex-col gap-2 min-h-[240px]" aria-label={label}>
                  <div className="flex justify-between items-center px-1"><h2 className="text-sm font-bold text-[#33475B]">{label}</h2><span className="text-xs font-bold bg-white rounded-full px-2 py-0.5">{list.length}</span></div>
                  {list.map((c) => (
                    <Link key={c.id} href={`/ise-alim/${c.id}`} className="bg-white rounded-[10px] border border-[#D5DEE8] p-3 flex flex-col gap-1.5 hover:border-brand-600">
                      <span className="font-semibold text-sm text-ink">{c.first_name} {c.last_name === "-" ? "" : c.last_name}</span>
                      <span className="text-xs text-muted">{(c.job_postings as { title: string } | null)?.title ?? "Genel başvuru"}</span>
                      <span className="flex flex-wrap gap-1.5 text-[11px]">
                        <span className="bg-[#EEF3F9] rounded-full px-2 py-0.5">{SOURCE_LABEL[c.source] ?? c.source}</span>
                        {c.experience && <span className="bg-[#EEF3F9] rounded-full px-2 py-0.5">{c.experience}</span>}
                      </span>
                      <span className="text-xs text-[#33475B]">
                        {c.score ? <>Puan <b>{Number(c.score).toLocaleString("tr-TR")}</b> · </> : null}
                        {c.stage === "interview" && c.interview_at ? `Mülakat ${formatDate(c.interview_at)}${c.candidate_reply === "confirmed" ? " ✓" : c.candidate_reply === "reschedule" ? " · başka gün" : ""}` : formatDate(c.created_at)}
                      </span>
                    </Link>
                  ))}
                </section>
              );
            })}
          </div>
        </div>

        {hr && (
          <Card title="Aday ekle (telefonla / kapıdan gelen)">
            <form action={addCandidate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end text-sm">
              <label className="flex flex-col gap-1 text-muted">Ad<input name="first_name" required className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Soyad<input name="last_name" required className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">Cep telefonu<input name="phone" type="tel" required placeholder="05xx xxx xx xx" className={input} /></label>
              <label className="flex flex-col gap-1 text-muted">İlan<select name="posting_id" className={input}><option value="">Genel</option>{open.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-muted">Kaynak<select name="source" className={input}><option value="manual">Doğrudan</option><option value="iskur">İŞKUR</option><option value="other">Diğer</option></select></label>
              <label className="flex flex-col gap-1 text-muted">Deneyim<select name="experience" className={input}>{EXPERIENCE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-muted">Özgeçmiş<input name="cv" type="file" accept=".pdf,.doc,.docx,image/*" className={`${input} pt-2`} /></label>
              <label className="flex items-center gap-2 text-muted min-h-11"><input type="checkbox" name="kvkk" className="w-5 h-5" />Aday KVKK metnini onayladı</label>
              <label className="flex flex-col gap-1 text-muted sm:col-span-2 lg:col-span-3">Not<input name="about" className={input} /></label>
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit>
            </form>
          </Card>
        )}
        <p className="text-xs text-muted">KVKK: reddedilen adaylar 6 ay, aday havuzunda kalmayı kabul edenler 1 yıl sonra otomatik silinir. Aday kartından istendiği an kalıcı silinebilir.</p>
      </div>
    </>
  );
}
