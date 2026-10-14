import Link from "next/link";
import { Flash, PageHead } from "@/components/admin/ui";
import { aiDraftFromPlan, aiPlanMonth, savePlan } from "@/lib/growth-actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "İçerik takvimi" };

type Plan = { id: string; plan_date: string; channel: string; title: string; notes: string | null; status: string; post_id: string | null };
const CH: Record<string, [string, string]> = { blog: ["📝 Blog", "#2E86DE"], instagram: ["📸 Instagram", "#E1306C"], linkedin: ["💼 LinkedIn", "#0A66C2"], facebook: ["👍 Facebook", "#1877F2"], newsletter: ["✉️ Bülten", "#10A37F"], youtube: ["▶️ YouTube", "#FF0000"] };
const ST: Record<string, string> = { idea: "Fikir", draft: "Taslak", scheduled: "Planlandı", published: "Yayında" };
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** İçerik takvimi: blog ve sosyal medya planı; yapay zekâ ile aylık plan ve blog taslağı */
export default async function ContentCalendar({ searchParams }: { searchParams: Promise<{ ay?: string; ok?: string; hata?: string }> }) {
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const ym = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : now.toISOString().slice(0, 7);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_content_plan").select("*").gte("plan_date", `${ym}-01`).lte("plan_date", `${ym}-${String(days).padStart(2, "0")}`).order("plan_date");
  const plans = (data ?? []) as Plan[];
  const byDay = new Map<number, Plan[]>();
  for (const p of plans) { const d = Number(p.plan_date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), p]); }
  const monthName = first.toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <PageHead title="İçerik takvimi" lead="Blog ve sosyal medya planı. Yapay zekâ ayın planını önerir, blog fikrinden taslak yazı hazırlar; siz kontrol edip yayınlarsınız." />
      <Flash ok={sp.ok} hata={sp.hata ?? (error ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : undefined)} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/admin/icerik-takvimi?ay=${prev}`} className="rounded-full border border-gypsum bg-white px-3 py-1.5 text-sm">←</Link>
        <b className="display text-xl capitalize text-navy">{monthName}</b>
        <Link href={`/admin/icerik-takvimi?ay=${next}`} className="rounded-full border border-gypsum bg-white px-3 py-1.5 text-sm">→</Link>
        <form action={aiPlanMonth} className="ml-auto"><input type="hidden" name="ay" value={ym} /><button className="rounded-full bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white">✨ Yapay zekâ ile bu ayı planla</button></form>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {DAYS.map((d) => <div key={d} className="px-1 font-semibold text-slate">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <div key={d} className={`min-h-24 rounded-xl border p-1.5 ${`${ym}-${String(d).padStart(2, "0")}` === now.toISOString().slice(0, 10) ? "border-navy bg-porcelain" : "border-gypsum bg-white"}`}>
            <span className="font-semibold text-slate">{d}</span>
            <ul className="mt-1 grid gap-1">
              {(byDay.get(d) ?? []).map((p) => (
                <li key={p.id}>
                  <details className="rounded-lg px-1.5 py-1 text-[11px] leading-tight" style={{ background: `${CH[p.channel]?.[1]}14`, borderLeft: `3px solid ${CH[p.channel]?.[1]}` }}>
                    <summary className="cursor-pointer list-none"><b>{CH[p.channel]?.[0].split(" ")[0]}</b> {p.title}<span className="block text-slate">{ST[p.status]}</span></summary>
                    {p.notes && <p className="mt-1 text-slate">{p.notes}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.channel === "blog" && !p.post_id && <form action={aiDraftFromPlan}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="ay" value={ym} /><button className="font-semibold text-violet-700">✨ Taslak yaz</button></form>}
                      {p.post_id && <Link href={`/admin/blog/${p.post_id}`} className="font-semibold text-navy">Yazıyı aç</Link>}
                      {(["scheduled", "published"] as const).filter((s) => s !== p.status).map((s) => <form key={s} action={savePlan}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="ay" value={ym} /><input type="hidden" name="plan_date" value={p.plan_date} /><input type="hidden" name="channel" value={p.channel} /><input type="hidden" name="title" value={p.title} /><input type="hidden" name="notes" value={p.notes ?? ""} /><input type="hidden" name="status" value={s} /><button className="text-slate">→ {ST[s]}</button></form>)}
                      <form action={savePlan}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="ay" value={ym} /><input type="hidden" name="delete" value="1" /><button className="text-bad">Sil</button></form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <form action={savePlan} className="mt-6 grid gap-2 rounded-2xl border border-gypsum bg-white p-4 sm:grid-cols-[auto_auto_1fr_auto]">
        <input type="hidden" name="ay" value={ym} />
        <input type="date" name="plan_date" defaultValue={`${ym}-${String(Math.min(days, now.getUTCDate())).padStart(2, "0")}`} className="field" aria-label="Tarih" />
        <select name="channel" className="field" aria-label="Kanal">{Object.entries(CH).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <input name="title" required minLength={2} maxLength={200} placeholder="Başlık / fikir: ör. Zirkon mu E.max mı? Hekimler için karşılaştırma" className="field" />
        <button className="rounded-full bg-navy px-5 py-2 font-semibold text-white">Ekle</button>
        <textarea name="notes" rows={2} maxLength={4000} placeholder="Not (isteğe bağlı)" className="field sm:col-span-4" />
      </form>
    </>
  );
}
