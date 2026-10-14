import { Flash, PageHead } from "@/components/admin/ui";
import { saveAiCheck, saveAiPrompt } from "@/lib/growth-actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Yapay zekâ görünürlüğü" };

type Prompt = { id: string; prompt: string; locale: string; is_active: boolean; sort: number };
type Check = { id: string; prompt_id: string; engine: string; checked_on: string; mentioned: boolean; cited: boolean; position: number | null; cited_url: string | null; competitors: string | null; note: string | null };
const ENGINES: Array<[string, string, (q: string) => string]> = [
  ["chatgpt", "ChatGPT", (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`],
  ["perplexity", "Perplexity", (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`],
  ["gemini", "Gemini", () => "https://gemini.google.com/app"],
  ["claude", "Claude", (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`],
  ["copilot", "Copilot", (q) => `https://www.bing.com/search?showconv=1&q=${encodeURIComponent(q)}`],
  ["google_ai", "Google (yapay zekâ özeti)", (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`],
];

/** Yapay zekâ görünürlük testi: sabit sorular, her ay her motorda MB Dental geçiyor mu, kaynak gösteriliyor mu */
export default async function AiVisibility({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const [{ data: ps, error }, { data: cs }] = await Promise.all([
    supabase.from("cms_ai_prompts").select("*").order("sort"),
    supabase.from("cms_ai_checks").select("*").order("checked_on", { ascending: false }).limit(2000),
  ]);
  const prompts = (ps ?? []) as Prompt[];
  const checks = (cs ?? []) as Check[];
  const latest = new Map<string, Check>();
  for (const c of checks) if (!latest.has(`${c.prompt_id}|${c.engine}`)) latest.set(`${c.prompt_id}|${c.engine}`, c);
  const last90 = checks.filter((c) => Date.now() - new Date(c.checked_on).getTime() < 90 * 86400000);
  const score = last90.length ? Math.round((last90.filter((c) => c.mentioned).length / last90.length) * 100) : null;
  const cited = last90.length ? Math.round((last90.filter((c) => c.cited).length / last90.length) * 100) : null;
  const byEngine = ENGINES.map(([k, l]) => { const xs = last90.filter((c) => c.engine === k); return [l, xs.length, xs.filter((c) => c.mentioned).length] as const; });
  const comp = new Map<string, number>();
  for (const c of last90) for (const x of (c.competitors ?? "").split(",").map((s) => s.trim()).filter(Boolean)) comp.set(x, (comp.get(x) ?? 0) + 1);
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

  return (
    <>
      <PageHead title="Yapay zekâ görünürlüğü" lead="Hekimlerin soracağı sorular, her ay ChatGPT, Perplexity, Gemini, Claude ve Copilot'ta denenir: MB Dental cevapta geçiyor mu, siteye bağlantı veriliyor mu?" />
      <Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270201000000_site_growth_seo.sql çalıştırılmalı." : undefined)} />
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-navy p-5 text-white"><span className="text-xs uppercase tracking-wider text-white/60">Cevapta geçme</span><b className="mt-1 block text-4xl num">{score === null ? "—" : `%${score}`}</b><span className="text-xs text-white/60">son 90 gün · {last90.length} test</span></div>
        <div className="rounded-2xl border border-gypsum bg-white p-5"><span className="text-xs text-slate">Kaynak / bağlantı gösterme</span><b className="mt-1 block text-4xl num text-navy">{cited === null ? "—" : `%${cited}`}</b></div>
        <div className="rounded-2xl border border-gypsum bg-white p-5 md:col-span-2"><span className="text-xs text-slate">Motorlara göre (geçti / test)</span>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{byEngine.map(([l, n, m]) => <li key={l} className="flex justify-between"><span>{l}</span><b className="num">{n ? `${m}/${n}` : "—"}</b></li>)}</ul>
        </div>
      </section>
      {comp.size > 0 && <p className="mb-6 rounded-xl bg-porcelain px-4 py-3 text-sm text-slate"><b className="text-navy">Cevaplarda adı geçen rakipler:</b> {[...comp.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(", ")}</p>}

      <div className="grid gap-4">
        {prompts.map((p) => (
          <section key={p.id} className="rounded-2xl border border-gypsum bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-porcelain px-1.5 text-[11px] font-bold uppercase text-slate">{p.locale}</span>
              <b className="flex-1 text-navy">{p.prompt}</b>
              <form action={saveAiPrompt}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="delete" value="1" /><button className="text-xs text-bad">Kaldır</button></form>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {ENGINES.map(([k, l, url]) => {
                const c = latest.get(`${p.id}|${k}`);
                const tone = !c ? "border-gypsum bg-white" : c.cited ? "border-emerald-300 bg-emerald-50" : c.mentioned ? "border-amber-300 bg-amber-50" : "border-rose-200 bg-rose-50";
                return (
                  <details key={k} className={`rounded-xl border p-2.5 text-sm ${tone}`}>
                    <summary className="cursor-pointer list-none">
                      <b className="block">{l}</b>
                      <span className="text-xs text-slate">{!c ? "denenmedi" : `${c.cited ? "✅ kaynak" : c.mentioned ? "🟡 geçti" : "❌ yok"}${c.position ? ` · ${c.position}. sırada` : ""} · ${c.checked_on.split("-").reverse().join(".")}`}</span>
                    </summary>
                    <a href={url(p.prompt)} target="_blank" rel="noreferrer" className="mt-2 block text-xs font-semibold text-smile-ink">Soruyu {l}&apos;de aç ↗</a>
                    <form action={saveAiCheck} className="mt-2 grid gap-1.5">
                      <input type="hidden" name="prompt_id" value={p.id} /><input type="hidden" name="engine" value={k} />
                      <select name="result" className="field text-xs" aria-label="Sonuç"><option value="cited">Geçti + siteye bağlantı</option><option value="yes">Geçti (bağlantısız)</option><option value="no">Geçmedi</option></select>
                      <input name="position" type="number" min={1} max={50} placeholder="Kaçıncı sırada" className="field text-xs" />
                      <input name="competitors" placeholder="Adı geçen rakipler (virgülle)" className="field text-xs" />
                      <input name="checked_on" type="date" defaultValue={today} className="field text-xs" />
                      <button className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white">Kaydet</button>
                    </form>
                  </details>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <form action={saveAiPrompt} className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-gypsum bg-white p-4">
        <input name="prompt" required minLength={5} maxLength={300} placeholder="Yeni soru: ör. “Antalya'da implant üstü zirkon yapan laboratuvar”" className="field min-w-[260px] flex-1" />
        <select name="locale" className="field w-24"><option value="tr">TR</option><option value="en">EN</option><option value="fr">FR</option></select>
        <button className="rounded-full bg-navy px-5 py-2 font-semibold text-white">Soru ekle</button>
      </form>
      <p className="mt-4 text-xs text-slate">Yapay zekâ servisleri gösterim sayısı paylaşmadığı için ölçüm elle yapılır: ayda bir her soruyu açın, sonucu işaretleyin. Kontrol merkezindeki “yapay zekânın siteyi okuması” sayısı da otomatik ölçümdür.</p>
    </>
  );
}
